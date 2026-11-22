// Test hesabıyla X / Instagram girişi: görünür Chrome penceresi açar, SEN giriş yaparsın (şifre/2FA bu betiğe uğramaz).
// Giriş çerezi görülünce profil kaydedilir ve pencere kapanır. Sunucu aynı profili sonra gizli (headless) kullanır.
// Kullanım: npm run social:login -- x   |   npm run social:login -- instagram
// UYARI: ANA hesabınla değil, yalnızca bu iş için açılmış test hesabıyla giriş yap.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const platform = process.argv[2];
const CFG = {
  x: { url: "https://x.com/i/flow/login", cookie: "auth_token", domain: "https://x.com" },
  instagram: { url: "https://www.instagram.com/accounts/login/", cookie: "sessionid", domain: "https://www.instagram.com" },
}[platform];
if (!CFG) {
  console.error("Kullanım: node scripts/social-login.mjs <x|instagram>");
  process.exit(2);
}

const here = dirname(fileURLToPath(import.meta.url));
const profiles = process.env.SOCIAL_PROFILE_DIR || join(here, "..", ".social-profile");
mkdirSync(profiles, { recursive: true });
const lock = join(profiles, `${platform}.login.lock`);
const statusFile = join(profiles, `${platform}.status.json`);
writeFileSync(lock, String(Date.now()));

const keepLock = setInterval(() => writeFileSync(lock, String(Date.now())), 30_000);
let ctx;
try {
  ctx = await chromium.launchPersistentContext(join(profiles, platform), {
    channel: process.env.SOCIAL_CHROME_CHANNEL || "chrome",
    headless: false,
    locale: "en-US",
    viewport: null,
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto(CFG.url, { waitUntil: "domcontentloaded" });
  console.log(`${platform}: açılan pencerede TEST hesabıyla giriş yap (en fazla 10 dk)…`);

  const deadline = Date.now() + 10 * 60_000;
  let ok = false;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    if (page.isClosed()) break;
    const cookies = await ctx.cookies(CFG.domain).catch(() => []);
    if (cookies.some((c) => c.name === CFG.cookie && c.value)) {
      ok = true;
      break;
    }
  }
  if (!ok) throw new Error("Giriş tamamlanmadı (süre doldu ya da pencere kapatıldı).");

  // Çerezlerin diske yazılması için kısa bekleme; kullanıcı adını dene (başarısız olursa boş bırak)
  await new Promise((r) => setTimeout(r, 2500));
  let handle = "";
  try {
    if (platform === "x") {
      handle = ((await page.locator('a[data-testid="AppTabBar_Profile_Link"]').first().getAttribute("href", { timeout: 8000 })) || "").replace(/^\//, "");
    }
  } catch {
    // kullanıcı adı okunamadı; kritik değil
  }
  writeFileSync(statusFile, JSON.stringify({ connected: true, handle, at: new Date().toISOString() }));
  console.log(`${platform}: bağlandı${handle ? ` (@${handle})` : ""}. Pencere kapanıyor.`);
} catch (e) {
  console.error(String(e?.message || e));
  process.exitCode = 1;
} finally {
  clearInterval(keepLock);
  await ctx?.close().catch(() => undefined);
  rmSync(lock, { force: true });
}
