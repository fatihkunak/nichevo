// shared/social-core.ts
var SUFFIX = { k: 1e3, bin: 1e3, m: 1e6, mn: 1e6, b: 1e9 };
function parseCount(input) {
  if (typeof input === "number") return Number.isFinite(input) ? Math.round(input) : null;
  if (typeof input !== "string") return null;
  const m = /(\d[\d.,]*)\s*(mn|bin|[kmb])?(?![a-z])/i.exec(input.trim());
  if (!m) return null;
  const [, rawNum, suf] = m;
  if (!rawNum) return null;
  if (suf) {
    const n2 = Number.parseFloat(rawNum.replace(",", ".").replace(/[.,](?=.*[.,])/g, ""));
    const mult = SUFFIX[suf.toLowerCase()];
    return Number.isFinite(n2) && mult ? Math.round(n2 * mult) : null;
  }
  const n = Number.parseInt(rawNum.replace(/[.,]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}
function extractHashtags(text) {
  const out = /* @__PURE__ */ new Set();
  for (const m of text.matchAll(/#([\p{L}\p{N}_]{1,100})/gu)) out.add(m[1].toLowerCase());
  return [...out];
}
function isoOrNull(v) {
  if (typeof v === "number" && Number.isFinite(v)) {
    const d = new Date(v * 1e3);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof v === "string" && v) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

// shared/x-dom.ts
var metric = (label) => label ? parseCount(label) ?? 0 : null;
function normalizeXTweet(r) {
  const m = /^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)/.exec(r.href);
  if (!m) return null;
  const [, author, id] = m;
  const text = r.text.trim();
  return {
    platform: "x",
    id,
    url: `https://x.com/${author}/status/${id}`,
    author,
    text,
    postedAt: isoOrNull(r.datetime),
    likes: metric(r.like),
    replies: metric(r.reply),
    reposts: metric(r.repost),
    views: metric(r.views),
    hashtags: extractHashtags(text)
  };
}
function normalizeXUserCell(r) {
  const m = /^\/([A-Za-z0-9_]{1,15})$/.exec(r.href);
  if (!m) return null;
  const handle = m[1];
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
    url: `https://x.com/${handle}`
  };
}
function normalizeXProfile(handle, r, posts) {
  return {
    account: {
      platform: "x",
      handle,
      name: r.name.split("\n")[0]?.trim() || handle,
      bio: r.bio.trim(),
      followers: parseCount(r.followers),
      verified: r.verified,
      url: `https://x.com/${handle}`
    },
    following: parseCount(r.following),
    postsCount: parseCount(r.posts),
    posts
  };
}
var COLLECT_TWEETS = `(() => {
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
var COLLECT_USERS = `(() => {
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
var PROFILE_STATS = `(() => {
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
function validateTask(raw) {
  const o = raw && typeof raw === "object" ? raw : null;
  if (!o) return null;
  const q = (v) => typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100) : "";
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
function xTaskUrl(t) {
  if (t.kind === "profile") return `https://x.com/${encodeURIComponent(t.handle)}`;
  const f = t.kind === "accounts" ? "user" : t.mode === "latest" ? "live" : "top";
  return `https://x.com/search?q=${encodeURIComponent(t.q)}&src=typed_query&f=${f}`;
}
var isLoginUrl = (u) => /\/i\/flow\/(login|signup)|\/login(\?|$|\/)|\/logout/.test(u);
function urlMatchesTask(url, task) {
  if (task.kind === "profile") {
    const h = task.handle.replace(/[^A-Za-z0-9_.]/g, "").replace(/\./g, String.raw`\.`);
    return new RegExp(String.raw`^https://(www\.|mobile\.)?(x|twitter)\.com/${h}(/|\?|#|$)`, "i").test(url);
  }
  return /^https:\/\/(www\.|mobile\.)?(x|twitter)\.com\/search\?/i.test(url);
}
function buildWebViewScript(t) {
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
var XReadError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "XReadError";
  }
};
function resultToData(t, msg) {
  if (msg.type === "error") throw new XReadError("FAILED", `Sayfa okunamad\u0131: ${msg.message}`);
  const posts = (msg.tweets ?? []).map(normalizeXTweet).filter((p) => p !== null);
  if (t.kind === "posts") {
    if (!posts.length) throw new XReadError("EMPTY", "G\xF6nderi bulunamad\u0131. Giri\u015F yapt\u0131\u011F\u0131ndan ve sayfan\u0131n y\xFCklendi\u011Finden emin ol.");
    return { kind: "posts", posts: posts.slice(0, 30) };
  }
  if (t.kind === "accounts") {
    const accounts = (msg.users ?? []).map(normalizeXUserCell).filter((a) => a !== null).slice(0, 20);
    if (!accounts.length) throw new XReadError("EMPTY", "Hesap bulunamad\u0131. Giri\u015F yapt\u0131\u011F\u0131ndan emin ol.");
    return { kind: "accounts", accounts };
  }
  const raw = msg.profile;
  if (!raw || raw.missing) throw new XReadError("NOT_FOUND", `@${t.handle} bulunamad\u0131 ya da ask\u0131ya al\u0131nm\u0131\u015F.`);
  if (!raw.name) throw new XReadError("EMPTY", "Profil okunamad\u0131. Giri\u015F yapt\u0131\u011F\u0131ndan emin ol.");
  const own = posts.filter((p) => p.author.toLowerCase() === t.handle.toLowerCase()).slice(0, 20);
  return { kind: "profile", profile: normalizeXProfile(t.handle, raw, own) };
}
export {
  COLLECT_TWEETS,
  COLLECT_USERS,
  PROFILE_STATS,
  XReadError,
  buildWebViewScript,
  isLoginUrl,
  normalizeXProfile,
  normalizeXTweet,
  normalizeXUserCell,
  resultToData,
  urlMatchesTask,
  validateTask,
  xTaskUrl
};
