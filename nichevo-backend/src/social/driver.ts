// Gerçek sürücü: sistemdeki Chrome + kalıcı profil (test hesabının çerezleri). Tüm işlemler TEK sırada yürür:
// aynı anda tek sayfa, her işlem öncesi rastgele bekleme (insan hızı). Giriş, kullanıcının masaüstünde açılan
// görünür pencerede yapılır (scripts/social-login.mjs); şifre bu koda hiç uğramaz.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type BrowserContext, type Page } from "playwright-core";

import { IG_SEARCH_UNSUPPORTED, igKeywordPosts, igProfile } from "./instagram.js";
import { jitter, sleep } from "./parse.js";
import {
  SocialError,
  type ConnectionStatus,
  type Platform,
  type PostMode,
  type SocialAccount,
  type SocialDriver,
  type SocialPost,
  type SocialProfile,
} from "./types.js";
import { xProfile, xSearchAccounts, xSearchPosts } from "./x.js";

const backendDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const LOGIN_LOCK_MS = 12 * 60_000; // betik en fazla 10 dk bekler; kilit bundan eskiyse ölü sayılır
const IDLE_CLOSE_MS = 60_000;

export interface PlaywrightDriverOptions {
  profilesDir?: string;
  /** "chrome" | "msedge": sistemde kurulu tarayıcı (ayrı indirme gerekmez) */
  channel?: string;
  headless?: boolean;
}

class Queue {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.tail.then(fn);
    this.tail = p.catch(() => undefined);
    return p;
  }
}

export class PlaywrightDriver implements SocialDriver {
  readonly profilesDir: string;
  private channel: string;
  private headless: boolean;
  private queue = new Queue();
  private ctx = new Map<Platform, { ctx: BrowserContext; timer?: NodeJS.Timeout }>();
  private loginStartedAt = new Map<Platform, number>();

  constructor(o: PlaywrightDriverOptions = {}) {
    this.profilesDir = o.profilesDir ?? join(backendDir, ".social-profile");
    this.channel = o.channel ?? "chrome";
    this.headless = o.headless ?? true;
    mkdirSync(this.profilesDir, { recursive: true });
  }

  private statusFile = (p: Platform) => join(this.profilesDir, `${p}.status.json`);
  private lockFile = (p: Platform) => join(this.profilesDir, `${p}.login.lock`);
  private profileDir = (p: Platform) => join(this.profilesDir, p);

  status(platform: Platform): ConnectionStatus {
    try {
      const j = JSON.parse(readFileSync(this.statusFile(platform), "utf8"));
      if (j?.connected === true) return { connected: true, handle: j.handle || undefined, since: j.at };
    } catch {
      // dosya yok/bozuk → bağlı değil
    }
    return { connected: false };
  }

  loginInProgress(platform: Platform): boolean {
    if (Date.now() - (this.loginStartedAt.get(platform) ?? 0) < 25_000) return true; // betik kilidini yazana kadar
    try {
      return Date.now() - statSync(this.lockFile(platform)).mtimeMs < LOGIN_LOCK_MS;
    } catch {
      return false;
    }
  }

  private markDisconnected(platform: Platform) {
    writeFileSync(this.statusFile(platform), JSON.stringify({ connected: false, at: new Date().toISOString() }));
  }

  private async open(platform: Platform): Promise<BrowserContext> {
    const e = this.ctx.get(platform);
    if (e) {
      if (e.timer) clearTimeout(e.timer);
      return e.ctx;
    }
    const ctx = await chromium.launchPersistentContext(this.profileDir(platform), {
      channel: this.channel,
      headless: this.headless,
      locale: "en-US", // sayı/metin biçimleri (1.2K, Likes) tek dilde
      viewport: { width: 1280, height: 900 },
    });
    ctx.on("close", () => this.ctx.delete(platform));
    this.ctx.set(platform, { ctx });
    return ctx;
  }

  private scheduleClose(platform: Platform) {
    const e = this.ctx.get(platform);
    if (!e) return;
    if (e.timer) clearTimeout(e.timer);
    e.timer = setTimeout(() => void this.release(platform), IDLE_CLOSE_MS);
    e.timer.unref();
  }

  async release(platform: Platform) {
    const e = this.ctx.get(platform);
    if (!e) return;
    if (e.timer) clearTimeout(e.timer);
    this.ctx.delete(platform);
    await e.ctx.close().catch(() => undefined);
  }

  private withPage<T>(platform: Platform, fn: (page: Page) => Promise<T>): Promise<T> {
    return this.queue.run(async () => {
      if (this.loginInProgress(platform)) throw new SocialError("BUSY", "Giriş penceresi açık; giriş bitince tekrar dene.");
      if (!this.status(platform).connected) {
        throw new SocialError("NOT_CONNECTED", `${platform === "x" ? "X" : "Instagram"} için test hesabıyla giriş yapılmamış (Sosyal > Bağlantı).`);
      }
      const ctx = await this.open(platform);
      const page = await ctx.newPage();
      try {
        await sleep(jitter(400, 1200));
        return await fn(page);
      } catch (e) {
        if (e instanceof SocialError && e.code === "LOGIN_REQUIRED") {
          this.markDisconnected(platform);
          await this.release(platform);
        }
        if (e instanceof SocialError) throw e;
        // Ham tarayıcı/ağ hatası (zaman aşımı, bağlantı kopması…) kullanıcıya sızmasın
        throw new SocialError("PARSE", `Tarayıcı hatası: ${String((e as Error).message).split("\n")[0]}`);
      } finally {
        await page.close().catch(() => undefined);
        this.scheduleClose(platform);
      }
    });
  }

  searchPosts(platform: Platform, q: string, mode: PostMode): Promise<SocialPost[]> {
    return this.withPage(platform, (page) => (platform === "x" ? xSearchPosts(page, q, mode) : igKeywordPosts(page, q)));
  }

  searchAccounts(platform: Platform, q: string): Promise<SocialAccount[]> {
    if (platform === "instagram") return Promise.reject(new SocialError("PARSE", IG_SEARCH_UNSUPPORTED));
    return this.withPage(platform, (page) => xSearchAccounts(page, q));
  }

  searchHashtags(platform: Platform, _q: string) {
    if (platform === "instagram") return Promise.reject(new SocialError("PARSE", IG_SEARCH_UNSUPPORTED));
    return Promise.resolve([]);
  }

  profile(platform: Platform, handle: string): Promise<SocialProfile> {
    return this.withPage(platform, (page) => (platform === "x" ? xProfile(page, handle) : igProfile(page, handle)));
  }

  async beginLogin(platform: Platform): Promise<{ started: boolean; command: string }> {
    const command = `cd ${backendDir} && npm run social:login -- ${platform}`;
    await this.queue.run(() => this.release(platform)); // profil dosyası kilidi: sunucu tarayıcıyı bırakmalı
    this.loginStartedAt.set(platform, Date.now());
    // 1) Kullanıcının masaüstü oturumunda çalışan görev (sunucu S4U/pencere yok oturumunda olsa da pencere görünür)
    if (process.platform === "win32") {
      const r = spawnSync("schtasks", ["/run", "/tn", `NichevoSocialLogin-${platform}`], { windowsHide: true, timeout: 10_000 });
      if (r.status === 0) return { started: true, command };
    }
    // 2) Sunucu zaten masaüstü oturumundan başlatılmışsa doğrudan aç
    if (process.env.SESSIONNAME || process.platform !== "win32") {
      try {
        const child = spawn(process.execPath, [join(backendDir, "scripts", "social-login.mjs"), platform], {
          detached: true,
          stdio: "ignore",
          env: { ...process.env, SOCIAL_PROFILE_DIR: this.profilesDir },
        });
        child.unref();
        return { started: true, command };
      } catch {
        // aşağıda elle komut
      }
    }
    this.loginStartedAt.delete(platform);
    return { started: false, command };
  }

  async disconnect(platform: Platform): Promise<void> {
    await this.queue.run(() => this.release(platform));
    rmSync(this.profileDir(platform), { recursive: true, force: true });
    if (existsSync(this.statusFile(platform))) rmSync(this.statusFile(platform));
  }

  async closeAll() {
    for (const p of [...this.ctx.keys()]) await this.release(p);
  }
}
