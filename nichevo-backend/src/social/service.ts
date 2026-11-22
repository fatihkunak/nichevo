// Sosyal tarama iş mantığı: önbellek, takip listesi, profil anlık görüntüleri, trendler, asistan özeti.
// Sürücü (Playwright) enjekte edilir; testlerde sahte sürücü kullanılır.
import type pg from "pg";

import { aggregateHashtags, engagement } from "../../../shared/social-core";
import { cleanQuery, jitter, sleep } from "./parse.js";
import {
  SocialError,
  type HashtagInfo,
  type Platform,
  type PostMode,
  type SocialAccount,
  type SocialDriver,
  type SocialPost,
  type SocialProfile,
  type TrendData,
} from "./types.js";

export const SEARCH_TTL_MS = 30 * 60_000;
export const TREND_TTL_MS = 60 * 60_000;
export const MAX_WATCH_PER_USER = 25;

export { aggregateHashtags };

export type SearchKind = "posts" | "accounts" | "hashtags";

export interface Cached<T> {
  data: T;
  cached: boolean;
  fetchedAt: string;
}

interface WatchRow {
  id: string;
  user_id: string;
  platform: Platform;
  handle: string;
  display_name: string;
  created_at: Date;
  last_checked_at: Date | null;
  last_error: string | null;
}

export class SocialService {
  constructor(
    private pool: pg.Pool,
    readonly driver: SocialDriver,
    private now: () => number = Date.now,
  ) {}

  private async cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<Cached<T>> {
    const { rows } = await this.pool.query<{ payload: T; fetched_at: Date }>("SELECT payload, fetched_at FROM social_cache WHERE key = $1", [key]);
    const hit = rows[0];
    if (hit && this.now() - hit.fetched_at.getTime() < ttlMs) {
      return { data: hit.payload, cached: true, fetchedAt: hit.fetched_at.toISOString() };
    }
    const data = await fn();
    const at = new Date(this.now());
    await this.pool.query(
      `INSERT INTO social_cache (key, payload, fetched_at) VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (key) DO UPDATE SET payload = EXCLUDED.payload, fetched_at = EXCLUDED.fetched_at`,
      [key, JSON.stringify(data), at],
    );
    return { data, cached: false, fetchedAt: at.toISOString() };
  }

  // --- arama ---
  async search(platform: Platform, kind: SearchKind, rawQuery: string, mode: PostMode = "top") {
    const q = cleanQuery(rawQuery);
    if (!q) throw new SocialError("NOT_FOUND", "Arama metni boş.");
    const key = `search:${platform}:${kind}:${kind === "posts" ? mode : "-"}:${q.toLowerCase()}`;
    if (kind === "posts") {
      return this.cached<SocialPost[]>(key, SEARCH_TTL_MS, () => this.driver.searchPosts(platform, q, mode));
    }
    if (kind === "accounts") {
      return this.cached<SocialAccount[]>(key, SEARCH_TTL_MS, () => this.driver.searchAccounts(platform, q));
    }
    return this.cached<HashtagInfo[]>(key, SEARCH_TTL_MS, async () => {
      if (platform === "x") return aggregateHashtags(await this.driver.searchPosts("x", q, "top"), q).slice(0, 25);
      const tags = await this.driver.searchHashtags(platform, q);
      return tags.map((t) => ({ tag: t.tag, postCount: t.postCount, mentions: 0, engagement: 0 }));
    });
  }

  // --- trend ---
  async trends(platform: Platform, rawQuery: string) {
    const q = cleanQuery(rawQuery);
    if (!q) throw new SocialError("NOT_FOUND", "Konu boş.");
    return this.cached(`trends:${platform}:${q.toLowerCase()}`, TREND_TTL_MS, async () => {
      if (platform === "x") {
        const top = await this.driver.searchPosts("x", q, "top");
        const latest = await this.driver.searchPosts("x", q, "latest");
        const byId = new Map<string, SocialPost>();
        for (const p of [...top, ...latest]) byId.set(p.id, p);
        const posts = [...byId.values()];
        return {
          hashtags: aggregateHashtags(posts, q).slice(0, 20),
          topPosts: [...posts].sort((a, b) => engagement(b) - engagement(a)).slice(0, 8),
          sampleSize: posts.length,
        };
      }
      // Instagram'da hashtag araması kapalı: konudan gönderileri alıp (varsa) başlıklarındaki hashtag'leri topla
      const posts = await this.driver.searchPosts("instagram", q, "top");
      return {
        hashtags: aggregateHashtags(posts, q).slice(0, 25),
        topPosts: [...posts].sort((a, b) => engagement(b) - engagement(a)).slice(0, 8),
        sampleSize: posts.length,
      };
    });
  }

  // --- takip listesi ---
  async addWatch(userId: string, platform: Platform, handle: string) {
    const { rows: count } = await this.pool.query<{ n: string }>("SELECT count(*) AS n FROM social_watch WHERE user_id = $1", [userId]);
    if (Number(count[0]?.n ?? 0) >= MAX_WATCH_PER_USER) {
      throw new SocialError("BLOCKED", `En fazla ${MAX_WATCH_PER_USER} hesap takip edilebilir.`);
    }
    const { rows } = await this.pool.query<WatchRow>(
      `INSERT INTO social_watch (user_id, platform, handle) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, platform, handle) DO UPDATE SET handle = EXCLUDED.handle RETURNING *`,
      [userId, platform, handle],
    );
    return rows[0]!;
  }

  async removeWatch(userId: string, id: string): Promise<boolean> {
    const r = await this.pool.query("DELETE FROM social_watch WHERE id = $1 AND user_id = $2", [id, userId]);
    return (r.rowCount ?? 0) > 0;
  }

  private async getWatch(userId: string, id: string): Promise<WatchRow> {
    const { rows } = await this.pool.query<WatchRow>("SELECT * FROM social_watch WHERE id = $1 AND user_id = $2", [id, userId]);
    if (!rows[0]) throw new SocialError("NOT_FOUND", "Takip kaydı bulunamadı.");
    return rows[0];
  }

  async listWatch(userId: string) {
    const { rows } = await this.pool.query(
      `SELECT w.*,
         (SELECT row_to_json(s) FROM (SELECT followers, following, posts_count, taken_at FROM social_snapshots
            WHERE watch_id = w.id ORDER BY taken_at DESC LIMIT 1) s) AS latest,
         (SELECT row_to_json(s) FROM (SELECT followers, taken_at FROM social_snapshots
            WHERE watch_id = w.id AND taken_at > now() - interval '7 days' ORDER BY taken_at ASC LIMIT 1) s) AS week_start,
         (SELECT coalesce(json_agg(p), '[]'::json) FROM (SELECT post_id AS id, url, text, posted_at AS "postedAt", likes, replies, reposts, views
            FROM social_posts WHERE watch_id = w.id ORDER BY posted_at DESC NULLS LAST LIMIT 6) p) AS posts
       FROM social_watch w WHERE w.user_id = $1 ORDER BY w.created_at`,
      [userId],
    );
    return rows.map((r) => ({
      id: r.id as string,
      platform: r.platform as Platform,
      handle: r.handle as string,
      name: r.display_name as string,
      lastCheckedAt: r.last_checked_at ? (r.last_checked_at as Date).toISOString() : null,
      lastError: (r.last_error as string | null) ?? null,
      followers: r.latest?.followers != null ? Number(r.latest.followers) : null,
      following: r.latest?.following != null ? Number(r.latest.following) : null,
      postsCount: r.latest?.posts_count != null ? Number(r.latest.posts_count) : null,
      // Tek anlık görüntü varsa (ilk okuma) değişim hesaplanamaz: "0" yerine bilinmiyor (null)
      followersWeekDelta:
        r.latest?.followers != null && r.week_start?.followers != null && r.latest.taken_at !== r.week_start.taken_at
          ? Number(r.latest.followers) - Number(r.week_start.followers)
          : null,
      posts: r.posts as Record<string, unknown>[],
    }));
  }

  /** Profil anlık görüntüsünü + gönderileri tek işlemde yazar (sunucu okuması ve uygulamadan gelen veri ortak kullanır). */
  private async saveProfile(watchId: string, prof: SocialProfile) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO social_snapshots (watch_id, followers, following, posts_count) VALUES ($1, $2, $3, $4)", [
        watchId,
        prof.account.followers,
        prof.following,
        prof.postsCount,
      ]);
      for (const p of prof.posts) {
        await client.query(
          `INSERT INTO social_posts (watch_id, post_id, url, text, posted_at, likes, replies, reposts, views, hashtags)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (watch_id, post_id) DO UPDATE SET likes = EXCLUDED.likes, replies = EXCLUDED.replies,
             reposts = EXCLUDED.reposts, views = EXCLUDED.views, text = EXCLUDED.text, fetched_at = now()`,
          [watchId, p.id, p.url, p.text, p.postedAt, p.likes, p.replies, p.reposts, p.views, p.hashtags],
        );
      }
      await client.query("UPDATE social_watch SET display_name = $2, last_checked_at = now(), last_error = NULL WHERE id = $1", [
        watchId,
        prof.account.name,
      ]);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  /** Profili sürücüyle çeker ve yazar. Hata `last_error`'a yazılıp yeniden fırlatılır. */
  private async refreshRow(w: WatchRow) {
    try {
      await this.saveProfile(w.id, await this.driver.profile(w.platform, w.handle));
    } catch (e) {
      await this.pool.query("UPDATE social_watch SET last_checked_at = now(), last_error = $2 WHERE id = $1", [w.id, (e as Error).message.slice(0, 300)]);
      throw e;
    }
  }

  /** Uygulamanın (kendi tarayıcısından) okuduğu profili kaydeder; kayıtla platform/kullanıcı adı eşleşmeli. */
  async ingestProfile(userId: string, watchId: string, prof: SocialProfile) {
    const w = await this.getWatch(userId, watchId);
    if (prof.account.platform !== w.platform || prof.account.handle.toLowerCase() !== w.handle.toLowerCase()) {
      throw new SocialError("NOT_FOUND", "Gönderilen profil takip kaydıyla eşleşmiyor.");
    }
    // Yalnızca bu hesabın kendi gönderileri kaydedilir (istemciden gelen başka hesap/platform gönderisi atılır)
    const own = prof.posts.filter((p) => p.platform === w.platform && p.author.toLowerCase() === w.handle.toLowerCase());
    await this.saveProfile(w.id, { ...prof, posts: own });
  }

  /** Uygulamanın hesapladığı trend verisini önbelleğe yazar (asistan özetine girsin). */
  async ingestTrends(platform: Platform, rawQuery: string, data: TrendData) {
    const q = cleanQuery(rawQuery);
    if (!q) throw new SocialError("NOT_FOUND", "Konu boş.");
    await this.pool.query(
      `INSERT INTO social_cache (key, payload, fetched_at) VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (key) DO UPDATE SET payload = EXCLUDED.payload, fetched_at = EXCLUDED.fetched_at`,
      [`trends:${platform}:${q.toLowerCase()}`, JSON.stringify(data), new Date(this.now())],
    );
  }

  async refreshWatch(userId: string, id: string) {
    await this.refreshRow(await this.getWatch(userId, id));
  }

  /** Zamanlayıcı: eski kayıtları sırayla, aralarda uzun rastgele beklemeyle yeniler. BLOCKED/oturum hatasında platformu atlar. */
  async refreshStale(minAgeMs: number, pauseMs: [number, number] = [20_000, 60_000]) {
    const { rows } = await this.pool.query<WatchRow>(
      `SELECT * FROM social_watch WHERE last_checked_at IS NULL OR last_checked_at < $1 ORDER BY last_checked_at NULLS FIRST LIMIT 100`,
      [new Date(this.now() - minAgeMs)],
    );
    const skip = new Set<Platform>();
    let ok = 0;
    let failed = 0;
    for (const w of rows) {
      if (skip.has(w.platform) || !this.driver.status(w.platform).connected) continue;
      try {
        await this.refreshRow(w);
        ok++;
      } catch (e) {
        failed++;
        if (e instanceof SocialError && ["BLOCKED", "LOGIN_REQUIRED", "NOT_CONNECTED", "BUSY"].includes(e.code)) skip.add(w.platform);
      }
      await sleep(jitter(pauseMs[0], pauseMs[1]));
    }
    return { ok, failed };
  }

  // --- asistan için özet ---
  async digest(userId: string): Promise<{ text: string; watched: number; trends: number }> {
    const watch = await this.listWatch(userId);
    const clip = (s: string, n: number) => s.replace(/[<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
    const num = (n: unknown) => (typeof n === "number" ? n.toLocaleString("en-US") : "?");
    const lines: string[] = [];
    for (const w of watch) {
      const delta = w.followersWeekDelta == null ? "" : ` (7 gün: ${w.followersWeekDelta >= 0 ? "+" : ""}${w.followersWeekDelta})`;
      lines.push(`${w.platform === "x" ? "X" : "Instagram"} @${w.handle}: ${num(w.followers)} takipçi${delta}, ${num(w.postsCount)} gönderi${w.lastError ? ` [son yenileme hatası: ${clip(w.lastError, 80)}]` : ""}`);
      for (const p of w.posts.slice(0, 4)) {
        const m = p as Record<string, any>;
        lines.push(`  - ${m.postedAt ? String(m.postedAt).slice(0, 10) : "?"} "${clip(String(m.text ?? ""), 160)}" (beğeni ${num(m.likes)}, yorum ${num(m.replies)}, görüntülenme ${num(m.views)})`);
      }
    }
    const { rows } = await this.pool.query<{ key: string; payload: any }>(
      `SELECT key, payload FROM social_cache WHERE key LIKE 'trends:%' AND fetched_at > now() - interval '7 days' ORDER BY fetched_at DESC LIMIT 4`,
    );
    for (const r of rows) {
      const [, platform, ...rest] = r.key.split(":");
      const tags: HashtagInfo[] = Array.isArray(r.payload?.hashtags) ? r.payload.hashtags : [];
      lines.push(`Trend (${platform === "x" ? "X" : "Instagram"}, "${clip(rest.join(":"), 60)}"): ${tags.slice(0, 8).map((t) => "#" + t.tag).join(" ") || "veri yok"}`);
    }
    return { text: lines.join("\n").slice(0, 6000), watched: watch.length, trends: rows.length };
  }
}
