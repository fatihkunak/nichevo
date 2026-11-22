// Tarayıcı tarafı betikleri GERÇEK Chrome'da, X/Instagram benzeri yerel sahte sayfalara karşı çalıştırır.
// Amaç: düz JS dizelerinin (kaçışlar dahil) sözdizimi ve seçici mantığı doğru mu. Gerçek X/Instagram'a ağ çağrısı YOK.
// Chrome kurulu değilse atlanır (CI).
import { existsSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { chromium, type Browser } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { COLLECT_IG_LINKS, READ_IG_PROFILE, normalizeIgLinks, normalizeIgProfilePage, type RawIgLink, type RawIgProfilePage } from "../src/social/instagram.js";
import { buildWebViewScript, resultToData, type XTask, type XTaskMessage } from "../../shared/x-dom";
import { SocialError } from "../src/social/types.js";
import { COLLECT_TWEETS, gotoChecked, COLLECT_USERS, PROFILE_STATS, normalizeXProfile, normalizeXTweet, normalizeXUserCell, type RawTweet, type RawUserCell, type RawXProfile } from "../src/social/x.js";

const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find(existsSync);

const X_PAGE = `<!doctype html><html><body>
<div data-testid="UserName"><div><span>Foo Bar</span><svg data-testid="icon-verified"></svg></div><div>@foo</div></div>
<div data-testid="UserDescription">AI araçları üzerine</div>
<a href="/foo/verified_followers"><span>1.2M</span> Followers</a>
<a href="/foo/following"><span>321</span> Following</a>
<div>12.5K posts</div>
<article data-testid="tweet">
  <div data-testid="User-Name"><a href="/foo">Foo Bar</a><a href="/foo">@foo</a></div>
  <a href="/foo/status/111"><time datetime="2026-11-20T10:00:00.000Z">Nov 20</time></a>
  <div data-testid="tweetText">Yeni video #YapayZeka #araçlar</div>
  <button data-testid="reply" aria-label="5 Replies. Reply"></button>
  <button data-testid="retweet" aria-label="7 reposts. Repost"></button>
  <button data-testid="like" aria-label="1.2K Likes. Like"></button>
  <a href="/foo/status/111/analytics" aria-label="45K views. View post analytics"></a>
</article>
<article data-testid="tweet">
  <a href="/bar/status/222"><time datetime="2026-11-19T08:00:00.000Z">Nov 19</time></a>
  <div data-testid="tweetText">Sayısız metrik</div>
  <button data-testid="reply" aria-label="Reply"></button>
  <button data-testid="like" aria-label="Like"></button>
</article>
<article data-testid="tweet"><div>reklam, zaman yok</div></article>
<div data-testid="UserCell"><a href="/baz"><div>Baz Kişi</div></a><div>@baz</div><div>Follow</div><div>Finans anlatıyorum</div><svg data-testid="icon-verified"></svg></div>
<div data-testid="UserCell"><a href="/i/lists/1">liste</a></div>
</body></html>`;

const IG_PAGE = `<!doctype html><html><head><title>Instagram (@instagram) • Instagram photos and videos</title>
<meta property="og:description" content="685M Followers, 178 Following, 8,656 Posts - See Instagram photos and videos from Instagram (@instagram)">
<meta property="og:title" content="Instagram (@instagram) • Instagram photos and videos"></head><body>
<a href="/instagram/p/Df-eXldGxRb/"><img alt="x"></a><a href="/instagram/reel/Df2aGgPtPZQ/"></a><a href="/instagram/p/Df-eXldGxRb/"></a>
<a href="/p/NoAuthor123/"></a><a href="/explore/">keşfet</a></body></html>`;

let server: http.Server;
let base = "";
let browser: Browser;

describe.skipIf(!CHROME)("tarayıcı betikleri (gerçek Chrome, sahte sayfa)", () => {
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url?.startsWith("/ig")) {
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.end(IG_PAGE);
        return;
      }
      if (req.url?.startsWith("/blocked")) {
        res.statusCode = 403;
        res.end("forbidden");
        return;
      }
      if (req.url?.startsWith("/api/profile")) {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ data: { user: { username: "foo", full_name: "Foo", edge_followed_by: { count: 99 }, edge_owner_to_timeline_media: { count: 1, edges: [{ node: { shortcode: "ZZZ", edge_media_to_caption: { edges: [] } } }] } } } }));
        return;
      }
      if (req.url?.startsWith("/api/echo")) {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ app: req.headers["x-ig-app-id"], csrf: req.headers["x-csrftoken"], xhr: req.headers["x-requested-with"] }));
        return;
      }
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(X_PAGE);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    browser = await chromium.launch({ channel: "chrome", headless: true });
  }, 60_000);
  afterAll(async () => {
    await browser?.close();
    await new Promise((r) => server?.close(r));
  });

  it("tweetleri okur; reklam kartı ve sayısız metrik doğru işlenir", async () => {
    const page = await browser.newPage();
    await page.goto(base);
    const raw = (await page.evaluate(COLLECT_TWEETS)) as RawTweet[];
    expect(raw).toHaveLength(3);
    const posts = raw.map(normalizeXTweet).filter((p) => p !== null);
    expect(posts).toHaveLength(2); // reklam kartının durum bağlantısı yok
    expect(posts[0]).toMatchObject({ id: "111", author: "foo", likes: 1200, replies: 5, reposts: 7, views: 45000, hashtags: ["yapayzeka", "araçlar"] });
    expect(posts[1]).toMatchObject({ id: "222", author: "bar", likes: 0, replies: 0, reposts: null, views: null });
    await page.close();
  });

  it("hesap kartlarını okur", async () => {
    const page = await browser.newPage();
    await page.goto(base);
    const raw = (await page.evaluate(COLLECT_USERS)) as RawUserCell[];
    const accounts = raw.map(normalizeXUserCell).filter((a) => a !== null);
    expect(accounts).toEqual([{ platform: "x", handle: "baz", name: "Baz Kişi", bio: "Finans anlatıyorum", followers: null, verified: true, url: "https://x.com/baz" }]);
    await page.close();
  });

  it("profil sayılarını okur", async () => {
    const page = await browser.newPage();
    await page.goto(base);
    const raw = (await page.evaluate(PROFILE_STATS)) as RawXProfile;
    expect(raw.missing).toBe(false);
    const p = normalizeXProfile("foo", raw, []);
    expect(p.account).toMatchObject({ name: "Foo Bar", bio: "AI araçları üzerine", followers: 1_200_000, verified: true });
    expect(p.following).toBe(321);
    expect(p.postsCount).toBe(12_500);
    await page.close();
  });

  it("platform 403 verirse ham hata değil anlaşılır BLOCKED fırlatır; normal sayfa geçer", async () => {
    const page = await browser.newPage();
    await expect(gotoChecked(page, `${base}/blocked`)).rejects.toMatchObject({ name: "SocialError", code: "BLOCKED" });
    await expect(gotoChecked(page, base)).resolves.toBeUndefined();
    await expect(gotoChecked(page, "http://127.0.0.1:1/")).rejects.toBeInstanceOf(SocialError);
    await page.close();
  });

  /** Telefondaki WebView gibi: sayfada `ReactNativeWebView.postMessage` var, okuma betiği enjekte edilir */
  const runWebViewScript = async (task: XTask): Promise<XTaskMessage> => {
    const page = await browser.newPage();
    await page.goto(base);
    await page.evaluate("(function(){ window.__msg = null; window.ReactNativeWebView = { postMessage: function (m) { window.__msg = m; } }; })()");
    await page.evaluate(`(function(){ ${buildWebViewScript(task)} })()`);
    await page.waitForFunction("window.__msg !== null", null, { timeout: 40_000 });
    const raw = (await page.evaluate("window.__msg")) as string;
    await page.close();
    return JSON.parse(raw) as XTaskMessage;
  };

  it("WebView betiği: gönderi araması sayfayı kaydırıp okur, sonuç uçtan uca ayrıştırılır", async () => {
    const task: XTask = { kind: "posts", q: "ai", mode: "top" };
    const msg = await runWebViewScript(task);
    expect(msg.type).toBe("result");
    const d = resultToData(task, msg);
    expect(d.kind === "posts" && d.posts.map((p) => p.id)).toEqual(["111", "222"]);
  }, 60_000);

  it("WebView betiği: hesap araması", async () => {
    const task: XTask = { kind: "accounts", q: "ai" };
    const d = resultToData(task, await runWebViewScript(task));
    expect(d.kind === "accounts" && d.accounts[0]).toMatchObject({ handle: "baz", name: "Baz Kişi" });
  }, 60_000);

  it("WebView betiği: profil (sayılar + yalnızca o hesabın gönderileri)", async () => {
    const task: XTask = { kind: "profile", handle: "foo" };
    const d = resultToData(task, await runWebViewScript(task));
    expect(d.kind).toBe("profile");
    if (d.kind !== "profile") return;
    expect(d.profile.account).toMatchObject({ handle: "foo", name: "Foo Bar", followers: 1_200_000 });
    expect(d.profile.following).toBe(321);
    expect(d.profile.posts.map((p) => p.id)).toEqual(["111"]); // "bar"ın gönderisi (222) elenir
  }, 60_000);

  it("Instagram sayfa betikleri: meta sayıları ve gönderi bağlantıları okunur", async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/ig`);
    const raw = (await page.evaluate(READ_IG_PROFILE)) as RawIgProfilePage;
    expect(raw.notFound).toBe(false);
    const prof = normalizeIgProfilePage("instagram", raw, []);
    expect(prof.account).toMatchObject({ name: "Instagram", followers: 685_000_000 });
    expect(prof.postsCount).toBe(8656);
    const links = (await page.evaluate(COLLECT_IG_LINKS)) as RawIgLink[];
    const posts = normalizeIgLinks(links, "instagram");
    expect(posts.map((p) => p.id)).toEqual(["Df-eXldGxRb", "Df2aGgPtPZQ", "NoAuthor123"]);
    expect(posts[2]?.author).toBe("instagram"); // bağlantıda yazar yoksa varsayılan
    await page.close();
  });
});
