// ÜRETİLDİ: node scripts/build-extension.mjs (kaynak: shared/x-dom.ts). Elle düzenleme.
window.ReactNativeWebView = { postMessage: (m) => chrome.runtime.sendMessage({ type: "nichevo-result", data: m }) };
(async () => {
  const post = (o) => window.ReactNativeWebView.postMessage(JSON.stringify(o));
  try {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const waitFor = async (sel, ms) => {
      const end = Date.now() + ms;
      while (Date.now() < end) { if (document.querySelector(sel)) return true; await sleep(400); }
      return false;
    };
    const collectTweets = () => (() => {
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
})();
    const collectUsers = () => (() => {
  const out = [];
  document.querySelectorAll('[data-testid="UserCell"]').forEach((cell) => {
    const a = Array.from(cell.querySelectorAll('a[href^="/"]')).find((x) => /^\/[A-Za-z0-9_]{1,15}$/.test(x.getAttribute('href') || ''));
    out.push({
      href: a ? a.getAttribute('href') : '',
      lines: (cell.innerText || '').split('\n'),
      verified: !!cell.querySelector('svg[data-testid="icon-verified"]'),
    });
  });
  return out;
})();
    const profileStats = () => (() => {
  const q = (s) => document.querySelector(s);
  const t = (e) => (e ? e.innerText : '');
  const links = Array.from(document.querySelectorAll('a[href]'));
  const f = links.find((a) => /\/(verified_followers|followers)$/.test(a.getAttribute('href') || ''));
  const g = links.find((a) => /\/following$/.test(a.getAttribute('href') || ''));
  const body = document.body.innerText;
  const pm = /([\d.,]+\s*[KMB]?)\s+posts/i.exec(body);
  return {
    name: t(q('[data-testid="UserName"]')),
    bio: t(q('[data-testid="UserDescription"]')),
    followers: t(f),
    following: t(g),
    posts: pm ? pm[1] : '',
    verified: !!q('[data-testid="UserName"] svg[data-testid="icon-verified"]'),
    missing: /this account doesn.t exist/i.test(body) || /account suspended/i.test(body),
  };
})();
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
    const mode = "posts";
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
})(); true;
