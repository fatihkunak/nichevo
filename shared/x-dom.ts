// X (Twitter) sayfa okuma: ortak kısım. Hem backend (Playwright) hem uygulama (WebView) AYNI seçicileri kullanır;
// X arayüzü değişince tek yerden güncellenir. Tarayıcı tarafı kod düz JS DİZESİ (tsx/esbuild `page.evaluate`
// fonksiyonlarına `__name` yardımcısı enjekte edip kırar; WebView zaten dize ister).
import { extractHashtags, isoOrNull, parseCount, type SocialAccount, type SocialPost, type SocialProfile } from "./social-core";

export interface RawTweet {
  href: string;
  text: string;
  datetime: string;
  reply: string;
  repost: string;
  like: string;
  views: string;
}

export interface RawUserCell {
  href: string;
  lines: string[];
  verified: boolean;
}

export interface RawXProfile {
  name: string;
  bio: string;
  followers: string;
  following: string;
  posts: string;
  verified: boolean;
  missing: boolean;
}

// Metrik etiketi hiç yoksa bilinmiyor (null); etiket var ama sayı yoksa X "0" yerine boş gösterir → 0.
const metric = (label: string): number | null => (label ? (parseCount(label) ?? 0) : null);

export function normalizeXTweet(r: RawTweet): SocialPost | null {
  const m = /^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)/.exec(r.href);
  if (!m) return null;
  const [, author, id] = m;
  const text = r.text.trim();
  return {
    platform: "x",
    id: id!,
    url: `https://x.com/${author}/status/${id}`,
    author: author!,
    text,
    postedAt: isoOrNull(r.datetime),
    likes: metric(r.like),
    replies: metric(r.reply),
    reposts: metric(r.repost),
    views: metric(r.views),
    hashtags: extractHashtags(text),
  };
}

export function normalizeXUserCell(r: RawUserCell): SocialAccount | null {
  const m = /^\/([A-Za-z0-9_]{1,15})$/.exec(r.href);
  if (!m) return null;
  const handle = m[1]!;
  const lines = r.lines.map((l) => l.trim()).filter(Boolean);
  const at = lines.findIndex((l) => l.toLowerCase() === `@${handle.toLowerCase()}`);
  const skip = /^(follow|following|follows you|click to follow.*|click to unfollow.*)$/i;
  const bio = lines.filter((l, i) => i > at && !skip.test(l)).join(" ");
  return {
    platform: "x",
    handle,
    name: (at > 0 ? lines[0] : handle) ?? handle,
    bio,
    followers: null,
    verified: r.verified,
    url: `https://x.com/${handle}`,
  };
}

export function normalizeXProfile(handle: string, r: RawXProfile, posts: SocialPost[]): SocialProfile {
  return {
    account: {
      platform: "x",
      handle,
      name: r.name.split("\n")[0]?.trim() || handle,
      bio: r.bio.trim(),
      followers: parseCount(r.followers),
      verified: r.verified,
      url: `https://x.com/${handle}`,
    },
    following: parseCount(r.following),
    postsCount: parseCount(r.posts),
    posts,
  };
}

// --- tarayıcı tarafı (düz JS) ---
export const COLLECT_TWEETS = `(() => {
  const out = [];
  document.querySelectorAll('article[data-testid="tweet"]').forEach((article) => {
    const time = article.querySelector('time');
    const link = time ? time.closest('a') : null;
    const lab = (sel) => {
      const b = article.querySelector(sel);
      if (!b) return '';
      return b.getAttribute('aria-label') || b.innerText || '';
    };
    const textEl = article.querySelector('[data-testid="tweetText"]');
    const views = article.querySelector('a[href$="/analytics"]');
    out.push({
      href: link ? (link.getAttribute('href') || '') : '',
      text: textEl ? textEl.innerText : '',
      datetime: time ? (time.getAttribute('datetime') || '') : '',
      reply: lab('[data-testid="reply"]'),
      repost: lab('[data-testid="retweet"]') || lab('[data-testid="unretweet"]'),
      like: lab('[data-testid="like"]') || lab('[data-testid="unlike"]'),
      views: views ? (views.getAttribute('aria-label') || views.innerText || '') : '',
    });
  });
  return out;
})()`;

export const COLLECT_USERS = `(() => {
  const out = [];
  document.querySelectorAll('[data-testid="UserCell"]').forEach((cell) => {
    const a = Array.from(cell.querySelectorAll('a[href^="/"]')).find((x) => /^\\/[A-Za-z0-9_]{1,15}$/.test(x.getAttribute('href') || ''));
    out.push({
      href: a ? a.getAttribute('href') : '',
      lines: (cell.innerText || '').split('\\n'),
      verified: !!cell.querySelector('svg[data-testid="icon-verified"]'),
    });
  });
  return out;
})()`;

export const PROFILE_STATS = `(() => {
  const q = (s) => document.querySelector(s);
  const t = (e) => (e ? e.innerText : '');
  const links = Array.from(document.querySelectorAll('a[href]'));
  const f = links.find((a) => /\\/(verified_followers|followers)$/.test(a.getAttribute('href') || ''));
  const g = links.find((a) => /\\/following$/.test(a.getAttribute('href') || ''));
  const body = document.body.innerText;
  const pm = /([\\d.,]+\\s*[KMB]?)\\s+posts/i.exec(body);
  return {
    name: t(q('[data-testid="UserName"]')),
    bio: t(q('[data-testid="UserDescription"]')),
    followers: t(f),
    following: t(g),
    posts: pm ? pm[1] : '',
    verified: !!q('[data-testid="UserName"] svg[data-testid="icon-verified"]'),
    missing: /this account doesn.t exist/i.test(body) || /account suspended/i.test(body),
  };
})()`;

// --- uygulama (WebView) için görevler ---
export type XTask =
  | { kind: "posts"; q: string; mode: "top" | "latest" }
  | { kind: "accounts"; q: string }
  | { kind: "profile"; handle: string };

/**
 * Güvenilmeyen girdiden (web sayfası → eklenti) görev üretir; geçersizse null. Eklenti yalnızca buradan geçen
 * görevleri çalıştırır, adresi her zaman xTaskUrl ile KENDİ üretir (dışarıdan adres alınmaz).
 */
export function validateTask(raw: unknown): XTask | null {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!o) return null;
  const q = (v: unknown) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100) : "");
  if (o.kind === "posts") {
    const text = q(o.q);
    return text ? { kind: "posts", q: text, mode: o.mode === "latest" ? "latest" : "top" } : null;
  }
  if (o.kind === "accounts") {
    const text = q(o.q);
    return text ? { kind: "accounts", q: text } : null;
  }
  if (o.kind === "profile") {
    return typeof o.handle === "string" && /^[A-Za-z0-9_]{1,15}$/.test(o.handle) ? { kind: "profile", handle: o.handle } : null;
  }
  return null;
}

export function xTaskUrl(t: XTask): string {
  if (t.kind === "profile") return `https://x.com/${encodeURIComponent(t.handle)}`;
  const f = t.kind === "accounts" ? "user" : t.mode === "latest" ? "live" : "top";
  return `https://x.com/search?q=${encodeURIComponent(t.q)}&src=typed_query&f=${f}`;
}

export const isLoginUrl = (u: string) => /\/i\/flow\/(login|signup)|\/login(\?|$|\/)|\/logout/.test(u);

/** Yüklenen adres hedef görev sayfası mı (giriş sonrası /home'a düşme gibi durumları ayırır) */
export function urlMatchesTask(url: string, task: XTask): boolean {
  if (task.kind === "profile") {
    const h = task.handle.replace(/[^A-Za-z0-9_.]/g, "").replace(/\./g, String.raw`\.`); // nokta regex'te joker olmasın
    return new RegExp(String.raw`^https://(www\.|mobile\.)?(x|twitter)\.com/${h}(/|\?|#|$)`, "i").test(url);
  }
  return /^https:\/\/(www\.|mobile\.)?(x|twitter)\.com\/search\?/i.test(url);
}

export type XTaskMessage =
  | { type: "result"; tweets?: RawTweet[]; users?: RawUserCell[]; profile?: RawXProfile }
  | { type: "error"; message: string };

/**
 * WebView içinde çalışan okuma betiği: sayfanın yüklenmesini bekler, birkaç kez kaydırır, ham veriyi
 * `ReactNativeWebView.postMessage` ile yollar. Kaydırma ve beklemeler insan hızında; yalnızca OKUR.
 */
export function buildWebViewScript(t: XTask): string {
  const mode = t.kind === "accounts" ? "accounts" : t.kind === "profile" ? "profile" : "posts";
  return `(async () => {
  const post = (o) => window.ReactNativeWebView.postMessage(JSON.stringify(o));
  try {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const waitFor = async (sel, ms) => {
      const end = Date.now() + ms;
      while (Date.now() < end) { if (document.querySelector(sel)) return true; await sleep(400); }
      return false;
    };
    const collectTweets = () => ${COLLECT_TWEETS};
    const collectUsers = () => ${COLLECT_USERS};
    const profileStats = () => ${PROFILE_STATS};
    const gather = async (scrolls) => {
      const seen = new Map();
      for (let i = 0; i <= scrolls; i++) {
        for (const r of collectTweets()) if (r.href && !seen.has(r.href)) seen.set(r.href, r);
        if (i === scrolls) break;
        window.scrollBy(0, 1400);
        await sleep(1000 + Math.random() * 1200);
      }
      return Array.from(seen.values());
    };
    const mode = ${JSON.stringify(mode)};
    if (mode === 'accounts') {
      await waitFor('[data-testid="UserCell"]', 25000);
      await sleep(600);
      post({ type: 'result', users: collectUsers() });
    } else if (mode === 'profile') {
      await waitFor('[data-testid="UserName"], [data-testid="emptyState"]', 25000);
      await sleep(800);
      const profile = profileStats();
      const tweets = profile.name ? await gather(2) : [];
      post({ type: 'result', profile, tweets });
    } else {
      await waitFor('article[data-testid="tweet"]', 25000);
      await sleep(600);
      post({ type: 'result', tweets: await gather(4) });
    }
  } catch (e) {
    post({ type: 'error', message: String((e && e.message) || e) });
  }
})(); true;`;
}

export type XTaskData =
  | { kind: "posts"; posts: SocialPost[] }
  | { kind: "accounts"; accounts: SocialAccount[] }
  | { kind: "profile"; profile: SocialProfile };

export class XReadError extends Error {
  constructor(
    public code: "NOT_FOUND" | "EMPTY" | "FAILED",
    message: string,
  ) {
    super(message);
    this.name = "XReadError";
  }
}

/** Ham WebView mesajını doğrulanmış veriye çevirir (saf; test edilir). */
export function resultToData(t: XTask, msg: XTaskMessage): XTaskData {
  if (msg.type === "error") throw new XReadError("FAILED", `Sayfa okunamadı: ${msg.message}`);
  const posts = (msg.tweets ?? []).map(normalizeXTweet).filter((p): p is SocialPost => p !== null);
  if (t.kind === "posts") {
    if (!posts.length) throw new XReadError("EMPTY", "Gönderi bulunamadı. Giriş yaptığından ve sayfanın yüklendiğinden emin ol.");
    return { kind: "posts", posts: posts.slice(0, 30) };
  }
  if (t.kind === "accounts") {
    const accounts = (msg.users ?? []).map(normalizeXUserCell).filter((a): a is SocialAccount => a !== null).slice(0, 20);
    if (!accounts.length) throw new XReadError("EMPTY", "Hesap bulunamadı. Giriş yaptığından emin ol.");
    return { kind: "accounts", accounts };
  }
  const raw = msg.profile;
  if (!raw || raw.missing) throw new XReadError("NOT_FOUND", `@${t.handle} bulunamadı ya da askıya alınmış.`);
  if (!raw.name) throw new XReadError("EMPTY", "Profil okunamadı. Giriş yaptığından emin ol.");
  const own = posts.filter((p) => p.author.toLowerCase() === t.handle.toLowerCase()).slice(0, 20);
  return { kind: "profile", profile: normalizeXProfile(t.handle, raw, own) };
}
