// Instagram okuyucusu (sunucu): giriş yapılmış Playwright sayfasını OKUR (23 Kas 2026 canlı keşfine göre).
// Instagram'ın belgesiz REST uç noktaları (topsearch, web_profile_info, tags/web_info) artık 404 veriyor ve hashtag
// sayfaları anahtar kelime aramasına yönleniyor; bu yüzden sayfanın kendisi okunur:
//  - profil: `og:description` ("685M Followers, 178 Following, 8,656 Posts") + sayfadaki gönderi bağlantıları
//  - gönderi araması: /explore/search/keyword/?q= sayfasındaki gönderi bağlantıları
//  - sayfa yüklenirken Instagram'ın kendi graphql yanıtlarında medya nesneleri geçerse beğeni/yorum sayıları oradan alınır
// Hesap ve hashtag ARAMASI şu an desteklenmiyor (uç nokta kapalı); bu dürüstçe SocialError ile bildirilir.
import type { Page, Response } from "playwright-core";

import { extractHashtags, isoOrNull, jitter, parseCount, sleep } from "./parse.js";
import { SocialError, type SocialPost, type SocialProfile } from "./types.js";

const ORIGIN = "https://www.instagram.com";

const likeCount = (v: unknown): number | null => {
  const n = parseCount(v);
  return n === null || n < 0 ? null : n; // gizlenmiş beğeni -1 döner
};
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const rec = (v: unknown): Record<string, any> | null => (v && typeof v === "object" ? (v as Record<string, any>) : null);

/** v1 medya nesnesi (graphql yanıtları) */
function postFromMedia(m: Record<string, any>, defaultAuthor: string): SocialPost | null {
  const code = str(m.code);
  const author = str(m.user?.username) || str(m.owner?.username) || defaultAuthor;
  if (!code || !author) return null;
  const caption = str(m.caption?.text);
  return {
    platform: "instagram",
    id: code,
    url: `${ORIGIN}/p/${code}/`,
    author,
    text: caption,
    postedAt: isoOrNull(m.taken_at),
    likes: likeCount(m.like_count),
    replies: likeCount(m.comment_count),
    reposts: null,
    views: likeCount(m.play_count ?? m.view_count ?? m.ig_play_count),
    hashtags: extractHashtags(caption),
  };
}

/** Yanıt şeması sık değişir: JSON ağacında medya nesnesi gibi görünen her düğümü topla (code + like_count/caption/taken_at). */
export function collectIgMedia(json: unknown, limit = 30, defaultAuthor = ""): SocialPost[] {
  const seen = new Map<string, SocialPost>();
  const walk = (v: unknown, depth: number) => {
    if (depth > 12 || seen.size >= limit) return;
    if (Array.isArray(v)) {
      for (const x of v) walk(x, depth + 1);
      return;
    }
    const o = rec(v);
    if (!o) return;
    const hasAuthor = !!(rec(o.user)?.username || rec(o.owner)?.username || defaultAuthor);
    if (typeof o.code === "string" && hasAuthor && ("like_count" in o || "caption" in o || "taken_at" in o)) {
      const p = postFromMedia(o, defaultAuthor);
      if (p && !seen.has(p.id)) seen.set(p.id, p);
    }
    for (const k of Object.keys(o)) walk(o[k], depth + 1);
  };
  walk(json, 0);
  return [...seen.values()];
}

// --- sayfa okuma (saf ayrıştırıcılar) ---
export interface RawIgLink {
  author: string;
  kind: string;
  code: string;
}

/** Sayfadaki gönderi bağlantılarını gönderiye çevirir; metrikler bilinmiyor (null) */
export function normalizeIgLinks(raw: RawIgLink[], defaultAuthor = ""): SocialPost[] {
  const seen = new Set<string>();
  const out: SocialPost[] = [];
  for (const r of raw) {
    if (!/^[A-Za-z0-9_-]{5,20}$/.test(r.code) || seen.has(r.code)) continue;
    seen.add(r.code);
    out.push({
      platform: "instagram",
      id: r.code,
      url: `${ORIGIN}/${r.kind === "reel" ? "reel" : "p"}/${r.code}/`,
      author: r.author || defaultAuthor,
      text: "",
      postedAt: null,
      likes: null,
      replies: null,
      reposts: null,
      views: null,
      hashtags: [],
    });
  }
  return out;
}

export interface RawIgProfilePage {
  og: string | null;
  ogTitle: string | null;
  notFound: boolean;
}

/** "685M Followers, 178 Following, 8,656 Posts - See Instagram photos…" + "Instagram (@instagram) • Instagram photos…" */
export function normalizeIgProfilePage(handle: string, raw: RawIgProfilePage, posts: SocialPost[]): SocialProfile {
  if (raw.notFound) throw new SocialError("NOT_FOUND", `@${handle} bulunamadı.`);
  const m = /([\d.,]+\s*[KMB]?)\s+Followers?,\s*([\d.,]+\s*[KMB]?)\s+Following,\s*([\d.,]+\s*[KMB]?)\s+Posts?/i.exec(raw.og ?? "");
  if (!m) throw new SocialError("PARSE", "Instagram profil sayfası okunamadı (sayfa yapısı değişmiş olabilir ya da hesap gizli).");
  const name = /^(.*?)\s*\(@/.exec(raw.ogTitle ?? "")?.[1]?.trim() ?? "";
  return {
    account: {
      platform: "instagram",
      handle,
      name,
      bio: "",
      followers: parseCount(m[1]),
      verified: false,
      url: `${ORIGIN}/${handle}/`,
    },
    following: parseCount(m[2]),
    postsCount: parseCount(m[3]),
    posts,
  };
}

// --- tarayıcı tarafı (düz JS dizesi, bkz. x.ts notu) ---
export const COLLECT_IG_LINKS = `(() => {
  const out = [];
  const seen = new Set();
  document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]').forEach((a) => {
    const m = /^\\/(?:([A-Za-z0-9._]+)\\/)?(p|reel)\\/([A-Za-z0-9_-]+)/.exec(a.getAttribute('href') || '');
    if (!m || seen.has(m[3])) return;
    seen.add(m[3]);
    out.push({ author: m[1] || '', kind: m[2], code: m[3] });
  });
  return out;
})()`;

export const READ_IG_PROFILE = `(() => {
  const meta = (p) => { const e = document.querySelector('meta[property="' + p + '"]'); return e ? e.getAttribute('content') : null; };
  const t = document.title || '';
  return { og: meta('og:description'), ogTitle: meta('og:title'), notFound: /page not found|sorry, this page/i.test(t + ' ' + document.body.innerText.slice(0, 400)) };
})()`;

async function open(page: Page, url: string) {
  let status = 0;
  const onResponse = (r: Response) => {
    if (r.request().isNavigationRequest() && r.frame() === page.mainFrame()) status = r.status();
  };
  page.on("response", onResponse);
  try {
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    if (resp) status = resp.status();
  } catch (e) {
    if (status === 403 || status === 429) throw new SocialError("BLOCKED", `Instagram erişimi engelledi (HTTP ${status}). Bir süre bekle.`);
    throw new SocialError("PARSE", `Instagram sayfası açılamadı: ${String((e as Error).message).split("\n")[0]}`);
  } finally {
    page.off("response", onResponse);
  }
  if (status === 403 || status === 429) throw new SocialError("BLOCKED", `Instagram erişimi engelledi (HTTP ${status}). Bir süre bekle.`);
  if (/\/accounts\/login|\/challenge|\/accounts\/suspended/.test(page.url())) {
    throw new SocialError("LOGIN_REQUIRED", "Instagram oturumu düşmüş ya da doğrulama istiyor. Sosyal sekmesinden Instagram için yeniden giriş yap.");
  }
  await sleep(jitter(3500, 5500)); // sayfa JS'inin gönderileri çizmesi için
}

/** Sayfa yüklenirken ve kaydırılırken Instagram'ın kendi graphql yanıtlarını dinler (yalnızca okur) */
function listenGraphql(page: Page): { texts: string[]; stop: () => void } {
  const texts: string[] = [];
  const on = async (r: Response) => {
    if (!r.url().includes("/graphql/query")) return;
    try {
      texts.push(await r.text());
    } catch {
      // yanıt gövdesi okunamadı; önemli değil
    }
  };
  page.on("response", on);
  return { texts, stop: () => page.off("response", on) };
}

function mediaFrom(texts: string[], defaultAuthor: string): SocialPost[] {
  const out = new Map<string, SocialPost>();
  for (const t of texts) {
    try {
      for (const p of collectIgMedia(JSON.parse(t), 40, defaultAuthor)) if (!out.has(p.id)) out.set(p.id, p);
    } catch {
      // JSON değil
    }
  }
  return [...out.values()];
}

/** Bağlantılardaki gönderilere graphql'den gelen metrikleri (varsa) bindirir */
function mergeMetrics(links: SocialPost[], media: SocialPost[]): SocialPost[] {
  const byId = new Map(media.map((p) => [p.id, p]));
  return links.map((l) => byId.get(l.id) ?? l);
}

export async function igProfile(page: Page, handle: string): Promise<SocialProfile> {
  const g = listenGraphql(page);
  try {
    await open(page, `${ORIGIN}/${encodeURIComponent(handle)}/`);
    const raw = (await page.evaluate(READ_IG_PROFILE)) as RawIgProfilePage;
    const links = normalizeIgLinks((await page.evaluate(COLLECT_IG_LINKS)) as RawIgLink[], handle).slice(0, 24);
    const own = mergeMetrics(links, mediaFrom(g.texts, handle).filter((p) => p.author.toLowerCase() === handle.toLowerCase()));
    return normalizeIgProfilePage(handle, raw, own.filter((p) => p.author.toLowerCase() === handle.toLowerCase()));
  } finally {
    g.stop();
  }
}

/** Anahtar kelime/hashtag aramasındaki gönderiler (Instagram'ın yeni arama sayfası). Beğeni sayıları genelde yoktur. */
export async function igKeywordPosts(page: Page, q: string): Promise<SocialPost[]> {
  const g = listenGraphql(page);
  try {
    await open(page, `${ORIGIN}/explore/search/keyword/?q=${encodeURIComponent(q)}`);
    const links = normalizeIgLinks((await page.evaluate(COLLECT_IG_LINKS)) as RawIgLink[]).slice(0, 30);
    return mergeMetrics(links, mediaFrom(g.texts, ""));
  } finally {
    g.stop();
  }
}

export const IG_SEARCH_UNSUPPORTED =
  "Instagram'da hesap ve hashtag araması şu an desteklenmiyor (Instagram bu arama uç noktasını kapattı). Gönderi araması ve profil takibi çalışır.";
