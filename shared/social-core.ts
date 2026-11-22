// Sosyal tarama: backend (Playwright) ve uygulama (WebView) için ORTAK, saf (bağımlılıksız) tipler ve yardımcılar.

export type Platform = "x" | "instagram";

export interface SocialPost {
  platform: Platform;
  id: string;
  url: string;
  author: string;
  text: string;
  postedAt: string | null;
  likes: number | null;
  replies: number | null;
  reposts: number | null;
  views: number | null;
  hashtags: string[];
}

export interface SocialAccount {
  platform: Platform;
  handle: string;
  name: string;
  bio: string;
  followers: number | null;
  verified: boolean;
  url: string;
}

export interface SocialProfile {
  account: SocialAccount;
  following: number | null;
  postsCount: number | null;
  posts: SocialPost[];
}

export interface HashtagInfo {
  tag: string;
  /** Platformun bildirdiği toplam gönderi sayısı (Instagram); yoksa null */
  postCount: number | null;
  /** Örneklemde kaç gönderide geçti */
  mentions: number;
  /** Örneklemdeki toplam beğeni+yeniden paylaşım (kaba etkileşim) */
  engagement: number;
}

export interface TrendData {
  hashtags: HashtagInfo[];
  topPosts: SocialPost[];
  sampleSize: number;
}

const SUFFIX: Record<string, number> = { k: 1e3, bin: 1e3, m: 1e6, mn: 1e6, b: 1e9 };

/** "1,234" → 1234 · "1.2K" → 1200 · "3,4 Mn" → 3400000 · "12 views. View post analytics" → 12 */
export function parseCount(input: unknown): number | null {
  if (typeof input === "number") return Number.isFinite(input) ? Math.round(input) : null;
  if (typeof input !== "string") return null;
  const m = /(\d[\d.,]*)\s*(mn|bin|[kmb])?(?![a-z])/i.exec(input.trim());
  if (!m) return null;
  const [, rawNum, suf] = m;
  if (!rawNum) return null;
  if (suf) {
    const n = Number.parseFloat(rawNum.replace(",", ".").replace(/[.,](?=.*[.,])/g, ""));
    const mult = SUFFIX[suf.toLowerCase()];
    return Number.isFinite(n) && mult ? Math.round(n * mult) : null;
  }
  const n = Number.parseInt(rawNum.replace(/[.,]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

export function extractHashtags(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/#([\p{L}\p{N}_]{1,100})/gu)) out.add(m[1]!.toLowerCase());
  return [...out];
}

export function isoOrNull(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    const d = new Date(v * 1000);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof v === "string" && v) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

export const engagement = (p: SocialPost) => (p.likes ?? 0) + (p.reposts ?? 0) * 2 + (p.replies ?? 0);

/** Gönderilerden hashtag toplar (sorgunun kendisi hariç): geçiş sayısı + kaba etkileşim */
export function aggregateHashtags(posts: SocialPost[], exclude = ""): HashtagInfo[] {
  const skip = exclude.replace(/^#/, "").replace(/\s+/g, "").toLowerCase();
  const map = new Map<string, HashtagInfo>();
  for (const p of posts) {
    for (const tag of p.hashtags) {
      if (tag === skip) continue;
      const h = map.get(tag) ?? { tag, postCount: null, mentions: 0, engagement: 0 };
      h.mentions += 1;
      h.engagement += engagement(p);
      map.set(tag, h);
    }
  }
  return [...map.values()].sort((a, b) => b.mentions - a.mentions || b.engagement - a.engagement);
}

/** Aranan konudan trend verisi: hashtag'ler + en çok etkileşim alan gönderiler */
export function buildTrendData(posts: SocialPost[], query: string): TrendData {
  const byId = new Map<string, SocialPost>();
  for (const p of posts) byId.set(p.id, p);
  const all = [...byId.values()];
  return {
    hashtags: aggregateHashtags(all, query).slice(0, 20),
    topPosts: [...all].sort((a, b) => engagement(b) - engagement(a)).slice(0, 8),
    sampleSize: all.length,
  };
}
