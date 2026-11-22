// "Nichevo X Okuyucu" tarayıcı eklentisini GERÇEK Chromium'a yükler (Playwright'ın paketlenmiş Chromium'u), Nichevo sayfasından
// (localhost:8081) görev yollar. X benzeri sayfalar ağ katmanında sahte olarak sunulur: gerçek X'e istek yok.
// Chromium (bundled) kurulu değilse atlanır. Not: Chrome 137+ kararlı sürümü --load-extension'ı kapattı; bu yüzden bundled Chromium.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import https from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resultToData } from "../../shared/x-dom";

const EXT = resolve(__dirname, "..", "..", "extension");
const hasChromium = (() => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

const X_PAGE = `<!doctype html><html><body>
<article data-testid="tweet">
  <a href="/foo/status/111"><time datetime="2026-11-20T10:00:00.000Z">Nov 20</time></a>
  <div data-testid="tweetText">Eklenti testi #YapayZeka</div>
  <button data-testid="reply" aria-label="5 Replies. Reply"></button>
  <button data-testid="like" aria-label="1.2K Likes. Like"></button>
</article>
<article data-testid="tweet">
  <a href="/bar/status/222"><time datetime="2026-11-19T08:00:00.000Z">Nov 19</time></a>
  <div data-testid="tweetText">İkinci</div>
</article>
</body></html>`;

const hasOpenssl = (() => {
  try {
    execFileSync("openssl", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

let ctx: BrowserContext;
let xServer: https.Server;
let loggedIn = true;

const html = (body: string) => ({ status: 200, contentType: "text/html; charset=utf-8", body: `<!doctype html><html><body>${body}</body></html>` });

/** Sayfadan eklentiye görev yollar, `result` mesajını bekler (sayfanın gerçek protokolü) */
const sendTask = (page: Page, task: unknown, id: string) =>
  page.evaluate(
    `new Promise((resolve) => {
      window.__phases = window.__phases || [];
      window.addEventListener('message', function on(e) {
        const m = e.data;
        if (e.source !== window || !m || m.source !== 'nichevo-extension' || m.id !== ${JSON.stringify(id)}) return;
        if (m.type === 'phase') window.__phases.push(m.phase);
        if (m.type === 'result') { window.removeEventListener('message', on); resolve(m); }
      });
      window.postMessage({ source: 'nichevo-web', type: 'task', id: ${JSON.stringify(id)}, task: ${JSON.stringify(task)} }, location.origin);
    })`,
  ) as Promise<{ ok: boolean; data?: any; error?: string }>;

describe.skipIf(!hasChromium || !hasOpenssl)("tarayıcı eklentisi (gerçek Chromium + yüklü eklenti)", () => {
  beforeAll(async () => {
    // Sahte "x.com": yerel HTTPS sunucu (kendinden imzalı sertifika). Tarayıcı x.com'u buraya yönlendirir.
    // (Eklentinin tarayıcı tarafından açtığı pencere Playwright ağ yakalamasına düşmediği için route kullanılamaz.)
    const dir = mkdtempSync(join(tmpdir(), "nichevo-cert-"));
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, "k.pem"), "-out", join(dir, "c.pem"), "-days", "1", "-subj", "/CN=x.com", "-addext", "subjectAltName=DNS:x.com"], { stdio: "ignore" });
    xServer = https.createServer({ key: readFileSync(join(dir, "k.pem")), cert: readFileSync(join(dir, "c.pem")) }, (req, res) => {
      const u = new URL(req.url ?? "/", "https://x.com");
      const send = (status: number, body: string, headers: Record<string, string> = {}) => {
        res.writeHead(status, { "content-type": "text/html; charset=utf-8", ...headers });
        res.end(body);
      };
      if (u.pathname.startsWith("/search") || u.pathname === "/foo") {
        if (!loggedIn) return send(302, "", { location: "https://x.com/i/flow/login" });
        return send(200, X_PAGE);
      }
      if (u.pathname.startsWith("/i/flow/login")) return send(200, "<html><body>giriş</body></html>");
      return send(200, "<html><body>ana sayfa</body></html>");
    });
    await new Promise<void>((r) => xServer.listen(0, "127.0.0.1", r));
    const port = (xServer.address() as AddressInfo).port;

    ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "nichevo-ext-")), {
      channel: "chromium",
      headless: true,
      ignoreHTTPSErrors: true,
      args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, `--host-resolver-rules=MAP x.com 127.0.0.1:${port}`, "--ignore-certificate-errors"],
    });
    // Nichevo sayfası: Playwright'ın kendi açtığı sayfa, route burada çalışır
    await ctx.route("http://localhost:8081/**", (r) => r.fulfill(html("<p>nichevo</p>")));
  }, 90_000);
  afterAll(async () => {
    await ctx?.close();
    await new Promise((r) => xServer?.close(r));
  });

  const openNichevo = async () => {
    const page = await ctx.newPage();
    await page.goto("http://localhost:8081/");
    return page;
  };

  it("köprü: sayfa eklentiyi bulur (ping/pong)", async () => {
    const page = await openNichevo();
    const pong = await page.evaluate(
      `new Promise((res) => { window.addEventListener('message', function on(e){ const m=e.data; if(e.source===window&&m&&m.source==='nichevo-extension'&&m.type==='pong'){ window.removeEventListener('message',on); res(m.version); } }); window.postMessage({source:'nichevo-web',type:'ping'}, location.origin); })`,
    );
    expect(pong).toBe("1.0.0");
    await page.close();
  }, 60_000);

  it("giriş yapılmışken: X'i görünür pencerede açar, okur, sonuç uçtan uca ayrıştırılır, pencere kapanır", async () => {
    loggedIn = true;
    const page = await openNichevo();
    const task = { kind: "posts", q: "ai", mode: "top" } as const;
    const res = await sendTask(page, task, "t1");
    expect(res.error ?? "ok").toBe("ok");
    const d = resultToData(task, res.data);
    expect(d.kind === "posts" && d.posts.map((p) => p.id)).toEqual(["111", "222"]);
    expect(d.kind === "posts" && d.posts[0]).toMatchObject({ author: "foo", likes: 1200, replies: 5, hashtags: ["yapayzeka"] });
    await new Promise((r) => setTimeout(r, 1000));
    expect(ctx.pages().filter((p) => p.url().startsWith("https://x.com"))).toHaveLength(0); // pencere kapandı
    await page.close();
  }, 90_000);

  it("giriş duvarı: 'login' aşaması bildirilir, kullanıcı girince /home'dan hedefe dönüp okur", async () => {
    loggedIn = false;
    const page = await openNichevo();
    const task = { kind: "posts", q: "ai", mode: "top" } as const;
    const pending = sendTask(page, task, "t2");
    // eklentinin açtığı pencere giriş sayfasına düşer
    const login = await ctx.waitForEvent("page", { predicate: (p) => p.url().startsWith("https://x.com"), timeout: 20_000 }).catch(() => null);
    const xPage = login ?? ctx.pages().find((p) => p.url().startsWith("https://x.com"));
    expect(xPage).toBeTruthy();
    await xPage!.waitForURL(/i\/flow\/login/, { timeout: 20_000 });
    await expect.poll(async () => (await page.evaluate("window.__phases || []")) as string[], { timeout: 15_000 }).toContain("login");
    // kullanıcı giriş yaptı: X ana sayfaya yönlendirir
    loggedIn = true;
    await xPage!.goto("https://x.com/home");
    const res = await pending;
    expect(res.ok).toBe(true);
    const d = resultToData(task, res.data);
    expect(d.kind === "posts" && d.posts).toHaveLength(2);
    await page.close();
  }, 120_000);

  it("Nichevo sekmesi kapanırsa görev iptal edilir ve X penceresi kapanır (10 dk beklemez)", async () => {
    loggedIn = false; // giriş duvarında bekler
    const page = await openNichevo();
    void sendTask(page, { kind: "posts", q: "ai", mode: "top" }, "t3").catch(() => undefined);
    const xPage = await ctx.waitForEvent("page", { predicate: (p) => p.url().startsWith("https://x.com") || p.url() === "about:blank" || p.url().startsWith("chrome-error"), timeout: 20_000 }).catch(() => null);
    expect(xPage).toBeTruthy();
    await expect.poll(async () => (await page.evaluate("window.__phases || []")) as string[], { timeout: 15_000 }).toContain("login");
    await page.close(); // kullanıcı Nichevo sekmesini kapattı
    await expect.poll(() => ctx.pages().filter((p) => /x\.com/.test(p.url())).length, { timeout: 15_000 }).toBe(0);
    loggedIn = true;
  }, 90_000);

  it("geçersiz / kötü niyetli görevleri çalıştırmaz (adres dışarıdan alınmaz)", async () => {
    const page = await openNichevo();
    for (const [i, bad] of [{ kind: "open", url: "https://evil.example" }, { kind: "profile", handle: "../etc" }, { kind: "posts", q: "   " }, null].entries()) {
      const res = await sendTask(page, bad, `bad${i}`);
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/Geçersiz görev/);
    }
    expect(ctx.pages().filter((p) => p.url().startsWith("https://evil.example"))).toHaveLength(0);
    await page.close();
  }, 60_000);

  it("başka sitelerde köprü yok: eklenti Nichevo dışındaki sayfalara yanıt vermez", async () => {
    await ctx.route("https://example.org/**", (r) => r.fulfill(html("<p>başka site</p>")));
    const page = await ctx.newPage();
    await page.goto("https://example.org/");
    const pong = await page.evaluate(
      `new Promise((res) => { const t = setTimeout(() => res(false), 1200); window.addEventListener('message', (e) => { if (e.data && e.data.source === 'nichevo-extension') { clearTimeout(t); res(true); } }); window.postMessage({source:'nichevo-web',type:'ping'}, location.origin); })`,
    );
    expect(pong).toBe(false);
    await page.close();
  }, 30_000);
});
