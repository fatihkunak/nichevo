import type { FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { SocialService } from "../src/social/service.js";
import {
  SocialError,
  type ConnectionStatus,
  type Platform,
  type PostMode,
  type SocialAccount,
  type SocialDriver,
  type SocialPost,
  type SocialProfile,
} from "../src/social/types.js";

const withDb = (url: string, db: string) => {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
};

const post = (id: string, tags: string[], likes = 10): SocialPost => ({
  platform: "x", id, url: `https://x.com/a/status/${id}`, author: "a", text: `gönderi ${id} ${tags.map((t) => "#" + t).join(" ")}`,
  postedAt: "2026-11-20T10:00:00.000Z", likes, replies: 1, reposts: 2, views: 100, hashtags: tags,
});

/** Tarayıcı açmayan sahte sürücü; çağrı sayısını tutar */
class FakeDriver implements SocialDriver {
  calls = { posts: 0, accounts: 0, hashtags: 0, profile: 0 };
  connected: Record<Platform, boolean> = { x: true, instagram: true };
  followers = 1000;
  failProfile: SocialError | null = null;
  loginCalls: Platform[] = [];
  disconnected: Platform[] = [];

  status(p: Platform): ConnectionStatus {
    return this.connected[p] ? { connected: true, handle: "testacc", since: "2026-11-22T00:00:00.000Z" } : { connected: false };
  }
  loginInProgress() { return false; }
  private guard(p: Platform) {
    if (!this.connected[p]) throw new SocialError("NOT_CONNECTED", "giriş yok");
  }
  async searchPosts(p: Platform, _q: string, _m: PostMode) {
    this.guard(p); this.calls.posts++;
    return [post("1", ["ai", "araçlar"], 50), post("2", ["ai", "yeni"], 5)];
  }
  async searchAccounts(p: Platform, _q: string): Promise<SocialAccount[]> {
    this.guard(p); this.calls.accounts++;
    return [{ platform: p, handle: "foo", name: "Foo", bio: "", followers: 10, verified: false, url: "https://x.com/foo" }];
  }
  async searchHashtags(p: Platform, _q: string) {
    this.guard(p); this.calls.hashtags++;
    return [{ tag: "yapayzeka", postCount: 5000 }];
  }
  async profile(p: Platform, handle: string): Promise<SocialProfile> {
    this.guard(p); this.calls.profile++;
    if (this.failProfile) throw this.failProfile;
    return {
      account: { platform: p, handle, name: "Foo Bar", bio: "", followers: this.followers, verified: false, url: "" },
      following: 5, postsCount: 7, posts: [post("10", ["x"]), post("11", ["y"])],
    };
  }
  async beginLogin(p: Platform) { this.loginCalls.push(p); return { started: true, command: "npm run social:login -- " + p }; }
  async disconnect(p: Platform) { this.disconnected.push(p); }
}

let app: FastifyInstance;
let appPool: pg.Pool;
let ownerPool: pg.Pool;
let driver: FakeDriver;
let clock = Date.now();
const JWT = "test-secret-test-secret-test-secret-123456";
const ME = { email: "me@nichevo.app", password: "correct-horse-1", name: "Ben" };
const OTHER = { email: "other@nichevo.app", password: "correct-horse-1", name: "Başkası" };

const build = () => {
  driver = new FakeDriver();
  app = buildApp({ pool: appPool, jwtSecret: JWT, now: () => clock, social: { service: new SocialService(appPool, driver, () => clock), allowedEmails: [ME.email] } });
};

beforeAll(() => {
  process.loadEnvFile(".env");
  appPool = new pg.Pool({ connectionString: withDb(process.env.DATABASE_URL!, "nichevo_test") });
  ownerPool = new pg.Pool({ connectionString: withDb(process.env.OWNER_DATABASE_URL!, "nichevo_test") });
});
afterAll(async () => {
  await app.close();
  await appPool.end();
  await ownerPool.end();
});
beforeEach(async () => {
  clock = Date.now();
  await ownerPool.query("TRUNCATE users CASCADE");
  await ownerPool.query("TRUNCATE social_cache");
  if (app) await app.close();
  build();
});

const reg = async (u: typeof ME) => (await app.inject({ method: "POST", url: "/v1/auth/register", payload: u })).json().accessToken as string;
const call = (method: "GET" | "POST" | "DELETE", url: string, token: string, payload?: unknown) =>
  app.inject({ method, url, payload: payload as object | undefined, headers: { authorization: `Bearer ${token}` } });

describe("erişim", () => {
  it("kimliksiz istek 401", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/social/status" })).statusCode).toBe(401);
  });
  it("izin listesinde olmayan hesap: durum enabled=false, diğer uçlar 403", async () => {
    const t = await reg(OTHER);
    expect((await call("GET", "/v1/social/status", t)).json()).toEqual({ enabled: false });
    expect((await call("GET", "/v1/social/search?platform=x&kind=posts&q=ai", t)).statusCode).toBe(403);
    expect((await call("GET", "/v1/social/watch", t)).statusCode).toBe(403);
    expect((await call("POST", "/v1/social/x/login", t)).statusCode).toBe(403);
    expect(driver.calls.posts).toBe(0);
  });
  it("izinli hesap: durum bağlantıları gösterir", async () => {
    const t = await reg(ME);
    const j = (await call("GET", "/v1/social/status", t)).json();
    expect(j.enabled).toBe(true);
    expect(j.platforms.x).toMatchObject({ connected: true, handle: "testacc", loginInProgress: false });
  });
  it("sosyal yapılandırılmamışsa uçlar hiç yok (404)", async () => {
    await app.close();
    app = buildApp({ pool: appPool, jwtSecret: JWT });
    const t = await reg(ME);
    expect((await call("GET", "/v1/social/status", t)).statusCode).toBe(404);
  });
});

describe("giriş / oturum", () => {
  it("giriş penceresini başlatır ve oturumu silebilir", async () => {
    const t = await reg(ME);
    const r = await call("POST", "/v1/social/instagram/login", t);
    expect(r.json()).toMatchObject({ started: true });
    expect(driver.loginCalls).toEqual(["instagram"]);
    expect((await call("DELETE", "/v1/social/x/session", t)).statusCode).toBe(204);
    expect(driver.disconnected).toEqual(["x"]);
    expect((await call("POST", "/v1/social/tiktok/login", t)).statusCode).toBe(404);
  });
});

describe("arama", () => {
  it("sonucu döner ve 30 dk önbellekler (ikinci çağrı sürücüye gitmez)", async () => {
    const t = await reg(ME);
    const url = "/v1/social/search?platform=x&kind=posts&q=Yapay%20Zeka";
    const a = (await call("GET", url, t)).json();
    expect(a.cached).toBe(false);
    expect(a.data).toHaveLength(2);
    const b = (await call("GET", url.replace("Yapay%20Zeka", "yapay%20zeka"), t)).json(); // büyük/küçük harf aynı anahtar
    expect(b.cached).toBe(true);
    expect(driver.calls.posts).toBe(1);
    clock += 31 * 60_000;
    expect((await call("GET", url, t)).json().cached).toBe(false);
    expect(driver.calls.posts).toBe(2);
  });
  it("hesap ve hashtag aramaları çalışır; X hashtag'i gönderilerden çıkarır", async () => {
    const t = await reg(ME);
    const acc = (await call("GET", "/v1/social/search?platform=x&kind=accounts&q=ai", t)).json();
    expect(acc.data[0].handle).toBe("foo");
    const xt = (await call("GET", "/v1/social/search?platform=x&kind=hashtags&q=ai", t)).json();
    expect(xt.data.map((h: { tag: string }) => h.tag)).toEqual(["araçlar", "yeni"]); // "ai" sorgunun kendisi, atılır
    const ig = (await call("GET", "/v1/social/search?platform=instagram&kind=hashtags&q=yapay", t)).json();
    expect(ig.data[0]).toMatchObject({ tag: "yapayzeka", postCount: 5000 });
  });
  it("geçersiz parametre 400, bağlı olmayan platform 409", async () => {
    const t = await reg(ME);
    expect((await call("GET", "/v1/social/search?platform=tiktok&kind=posts&q=a", t)).statusCode).toBe(400);
    expect((await call("GET", "/v1/social/search?platform=x&kind=posts", t)).statusCode).toBe(400);
    driver.connected.x = false;
    const r = await call("GET", "/v1/social/search?platform=x&kind=posts&q=a", t);
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe("NOT_CONNECTED");
  });
  it("saatlik 30 arama sınırı", async () => {
    const t = await reg(ME);
    let last = 200;
    for (let i = 0; i < 31; i++) last = (await call("GET", `/v1/social/search?platform=x&kind=posts&q=q${i}`, t)).statusCode;
    expect(last).toBe(429);
  });
});

describe("trend", () => {
  it("X: hashtag ve en çok etkileşim alan gönderileri döner", async () => {
    const t = await reg(ME);
    const j = (await call("GET", "/v1/social/trends?platform=x&q=ai", t)).json();
    expect(j.data.hashtags.map((h: { tag: string }) => h.tag)).toContain("araçlar");
    expect(j.data.topPosts[0].id).toBe("1"); // etkileşimi en yüksek
    expect(driver.calls.posts).toBe(2); // top + latest
  });
  it("Instagram: hashtag araması kapalı olduğundan konu gönderilerinden hashtag toplar", async () => {
    const t = await reg(ME);
    const j = (await call("GET", "/v1/social/trends?platform=instagram&q=yapay", t)).json();
    expect(j.data.hashtags.map((h: { tag: string }) => h.tag)).toEqual(expect.arrayContaining(["ai", "araçlar"]));
    expect(j.data.topPosts[0].id).toBe("1");
    expect(driver.calls.posts).toBe(1); // yalnızca gönderi araması
    expect(driver.calls.hashtags).toBe(0);
  });
});

describe("takip listesi", () => {
  it("ekler (bağlantıdan da), yineleneni birleştirir, geçersizi reddeder", async () => {
    const t = await reg(ME);
    const a = await call("POST", "/v1/social/watch", t, { platform: "x", handle: "https://x.com/Foo" });
    expect(a.statusCode).toBe(201);
    const b = await call("POST", "/v1/social/watch", t, { platform: "x", handle: "@Foo" });
    expect(b.json().id).toBe(a.json().id);
    expect((await call("POST", "/v1/social/watch", t, { platform: "x", handle: "a b!" })).statusCode).toBe(400);
    expect((await call("GET", "/v1/social/watch", t)).json().items).toHaveLength(1);
  });
  it("yenilemek anlık görüntü + gönderileri yazar; 7 günlük değişimi hesaplar", async () => {
    const t = await reg(ME);
    const id = (await call("POST", "/v1/social/watch", t, { platform: "x", handle: "foo" })).json().id;
    expect((await call("POST", `/v1/social/watch/${id}/refresh`, t)).statusCode).toBe(200);
    driver.followers = 1100;
    await call("POST", `/v1/social/watch/${id}/refresh`, t);
    const item = (await call("GET", "/v1/social/watch", t)).json().items[0];
    expect(item).toMatchObject({ handle: "foo", name: "Foo Bar", followers: 1100, following: 5, postsCount: 7, followersWeekDelta: 100, lastError: null });
    expect(item.posts).toHaveLength(2); // aynı gönderiler tekrar eklenmez (upsert)
    const { rows } = await ownerPool.query("SELECT count(*)::int AS n FROM social_snapshots");
    expect(rows[0].n).toBe(2);
  });
  it("yenileme hatası last_error'a yazılır ve uygun kodla döner", async () => {
    const t = await reg(ME);
    const id = (await call("POST", "/v1/social/watch", t, { platform: "instagram", handle: "foo" })).json().id;
    driver.failProfile = new SocialError("BLOCKED", "istekler sınırlandı");
    const r = await call("POST", `/v1/social/watch/${id}/refresh`, t);
    expect(r.statusCode).toBe(429);
    expect((await call("GET", "/v1/social/watch", t)).json().items[0].lastError).toContain("sınırlandı");
  });
  it("başka kullanıcının kaydını göremez/silemez; kendi kaydını siler", async () => {
    await app.close();
    app = buildApp({ pool: appPool, jwtSecret: JWT, social: { service: new SocialService(appPool, driver), allowedEmails: [ME.email, OTHER.email] } });
    const t1 = await reg(ME);
    const t2 = await reg(OTHER);
    const id = (await call("POST", "/v1/social/watch", t1, { platform: "x", handle: "foo" })).json().id;
    expect((await call("GET", "/v1/social/watch", t2)).json().items).toHaveLength(0);
    expect((await call("DELETE", `/v1/social/watch/${id}`, t2)).statusCode).toBe(404);
    expect((await call("POST", `/v1/social/watch/${id}/refresh`, t2)).statusCode).toBe(404);
    expect((await call("DELETE", `/v1/social/watch/${id}`, t1)).statusCode).toBe(204);
  });
  it("en fazla 25 hesap", async () => {
    const t = await reg(ME);
    let last = 201;
    for (let i = 0; i < 26; i++) last = (await call("POST", "/v1/social/watch", t, { platform: "x", handle: `acc${i}` })).statusCode;
    expect(last).toBe(429);
  });
});

describe("zamanlayıcı yenileme", () => {
  it("yalnızca bağlı platformdaki eski kayıtları yeniler; hata diğerlerini durdurmaz", async () => {
    const t = await reg(ME);
    await call("POST", "/v1/social/watch", t, { platform: "x", handle: "aaa" });
    await call("POST", "/v1/social/watch", t, { platform: "instagram", handle: "bbb" });
    driver.connected.instagram = false;
    const svc = new SocialService(appPool, driver, () => clock);
    const r = await svc.refreshStale(1000, [0, 0]);
    expect(r).toEqual({ ok: 1, failed: 0 });
    expect(driver.calls.profile).toBe(1);
    expect((await svc.refreshStale(60 * 60_000, [0, 0])).ok).toBe(0); // henüz eskimedi
  });
});

describe("asistan özeti", () => {
  it("takip edilenleri, son gönderileri ve trendleri düz metin olarak verir; etiket karakterlerini temizler", async () => {
    const t = await reg(ME);
    const id = (await call("POST", "/v1/social/watch", t, { platform: "x", handle: "foo" })).json().id;
    await call("POST", `/v1/social/watch/${id}/refresh`, t);
    await call("GET", "/v1/social/trends?platform=x&q=ai", t);
    const j = (await call("GET", "/v1/social/digest", t)).json();
    expect(j).toMatchObject({ watched: 1, trends: 1 });
    expect(j.text).toContain("X @foo: 1,000 takipçi");
    expect(j.text).toContain("gönderi 10");
    expect(j.text).toContain('Trend (X, "ai"): #araçlar');
    expect(j.text).not.toMatch(/[<>]/);
  });
});

describe("ingest (uygulamanın kendi tarayıcısından okuduğu X verisi)", () => {
  const profile = (handle = "foo") => ({
    account: { platform: "x", handle, name: "Foo Bar", bio: "bio", followers: 2500, verified: false, url: `https://x.com/${handle}` },
    following: 10,
    postsCount: 99,
    posts: [
      { platform: "x", id: "501", url: `https://x.com/${handle}/status/501`, author: handle, text: "ilk #tag", postedAt: "2026-11-21T10:00:00.000Z", likes: 7, replies: 1, reposts: 0, views: null, hashtags: ["tag"] },
    ],
  });

  it("profili takip kaydına yazar: anlık görüntü + gönderi, last_checked güncellenir", async () => {
    const t = await reg(ME);
    const id = (await call("POST", "/v1/social/watch", t, { platform: "x", handle: "foo" })).json().id;
    const r = await call("POST", `/v1/social/watch/${id}/ingest`, t, { profile: profile() });
    expect(r.statusCode).toBe(200);
    const item = (await call("GET", "/v1/social/watch", t)).json().items[0];
    expect(item).toMatchObject({ name: "Foo Bar", followers: 2500, following: 10, postsCount: 99, lastError: null });
    expect(item.posts[0]).toMatchObject({ id: "501", likes: 7 });
    expect(item.lastCheckedAt).not.toBeNull();
    expect(item.followersWeekDelta).toBeNull(); // tek anlık görüntü: değişim yok, "0" değil
    expect(driver.calls.profile).toBe(0); // sunucu tarayıcısı hiç kullanılmadı
  });

  it("başka hesabın gönderileri kaydedilmez, yalnızca o hesabınkiler", async () => {
    const t = await reg(ME);
    const id = (await call("POST", "/v1/social/watch", t, { platform: "x", handle: "foo" })).json().id;
    const p = profile();
    p.posts.push({ ...p.posts[0]!, id: "999", author: "baska", url: "https://x.com/baska/status/999" });
    expect((await call("POST", `/v1/social/watch/${id}/ingest`, t, { profile: p })).statusCode).toBe(200);
    const item = (await call("GET", "/v1/social/watch", t)).json().items[0];
    expect(item.posts.map((x: { id: string }) => x.id)).toEqual(["501"]);
  });

  it("kayıtla eşleşmeyen kullanıcı adı / platform reddedilir", async () => {
    const t = await reg(ME);
    const id = (await call("POST", "/v1/social/watch", t, { platform: "x", handle: "foo" })).json().id;
    expect((await call("POST", `/v1/social/watch/${id}/ingest`, t, { profile: profile("baska") })).statusCode).toBe(404);
    const ig = profile();
    ig.account.platform = "instagram";
    expect((await call("POST", `/v1/social/watch/${id}/ingest`, t, { profile: ig })).statusCode).toBe(404);
  });

  it("bozuk/zararlı alanları reddeder (400): dış bağlantı, kötü tarih, aşırı uzun metin, fazla gönderi", async () => {
    const t = await reg(ME);
    const id = (await call("POST", "/v1/social/watch", t, { platform: "x", handle: "foo" })).json().id;
    const bad = (mut: (p: ReturnType<typeof profile>) => void) => {
      const p = profile();
      mut(p);
      return call("POST", `/v1/social/watch/${id}/ingest`, t, { profile: p });
    };
    expect((await bad((p) => (p.posts[0]!.url = "https://evil.example/x"))).statusCode).toBe(400);
    expect((await bad((p) => (p.posts[0]!.postedAt = "yarın akşam"))).statusCode).toBe(400);
    expect((await bad((p) => (p.posts[0]!.text = "a".repeat(1001)))).statusCode).toBe(400);
    expect((await bad((p) => (p.account.followers = -5))).statusCode).toBe(400);
    expect((await bad((p) => (p.posts = Array.from({ length: 31 }, (_, i) => ({ ...profile().posts[0]!, id: String(i) }))))).statusCode).toBe(400);
    const { rows } = await ownerPool.query("SELECT count(*)::int AS n FROM social_snapshots");
    expect(rows[0].n).toBe(0); // hiçbiri yazılmadı
  });

  it("başka kullanıcının kaydına veri yazılamaz; izinsiz hesap 403", async () => {
    await app.close();
    app = buildApp({ pool: appPool, jwtSecret: JWT, social: { service: new SocialService(appPool, driver), allowedEmails: [ME.email, OTHER.email] } });
    const t1 = await reg(ME);
    const t2 = await reg(OTHER);
    const id = (await call("POST", "/v1/social/watch", t1, { platform: "x", handle: "foo" })).json().id;
    expect((await call("POST", `/v1/social/watch/${id}/ingest`, t2, { profile: profile() })).statusCode).toBe(404);
    await app.close();
    build(); // yalnızca ME izinli; OTHER'ın jetonu (aynı gizli anahtar, aynı DB) hâlâ geçerli ama izin listesinde değil
    const t3 = t2;
    expect((await call("POST", `/v1/social/watch/${id}/ingest`, t3, { profile: profile() })).statusCode).toBe(403);
    expect((await call("POST", "/v1/social/trends/ingest", t3, { platform: "x", q: "ai", data: { hashtags: [], topPosts: [], sampleSize: 0 } })).statusCode).toBe(403);
  });

  it("trend verisini önbelleğe yazar; asistan özetinde görünür", async () => {
    const t = await reg(ME);
    const data = { hashtags: [{ tag: "yapayzeka", postCount: null, mentions: 4, engagement: 120 }], topPosts: [], sampleSize: 12 };
    expect((await call("POST", "/v1/social/trends/ingest", t, { platform: "x", q: "Yapay Zeka", data })).statusCode).toBe(200);
    const cached = (await call("GET", "/v1/social/trends?platform=x&q=yapay%20zeka", t)).json();
    expect(cached.cached).toBe(true);
    expect(cached.data.hashtags[0].tag).toBe("yapayzeka");
    expect(driver.calls.posts).toBe(0);
    expect((await call("GET", "/v1/social/digest", t)).json().text).toContain("#yapayzeka");
  });
});
