// X (Twitter) okuyucusu (sunucu): giriş yapılmış Playwright sayfasından arama/profil okur. YALNIZCA OKUMA.
// Seçiciler ve ayrıştırma uygulamayla ORTAK: shared/x-dom.ts (X arayüzü değişince orada güncellenir).
import type { Page } from "playwright-core";

import {
  COLLECT_TWEETS,
  COLLECT_USERS,
  PROFILE_STATS,
  normalizeXProfile,
  normalizeXTweet,
  normalizeXUserCell,
  type RawTweet,
  type RawUserCell,
  type RawXProfile,
} from "../../../shared/x-dom";
import { jitter, sleep } from "./parse.js";
import { SocialError, type PostMode, type SocialAccount, type SocialPost, type SocialProfile } from "./types.js";

// testler/dış kullanım için yeniden dışa aç
export { COLLECT_TWEETS, COLLECT_USERS, PROFILE_STATS, normalizeXProfile, normalizeXTweet, normalizeXUserCell };
export type { RawTweet, RawUserCell, RawXProfile };

function assertLoggedIn(page: Page) {
  if (/\/(i\/flow\/)?login|\/i\/flow\/login|\/logout/.test(page.url())) {
    throw new SocialError("LOGIN_REQUIRED", "X oturumu düşmüş. Sosyal sekmesinden X için yeniden giriş yap.");
  }
}

/** Sayfayı açar; platform otomatik tarayıcıyı engellerse (403/429) ham tarayıcı hatası yerine anlaşılır `BLOCKED` verir. */
export async function gotoChecked(page: Page, url: string): Promise<void> {
  let status = 0;
  const onResponse = (r: import("playwright-core").Response) => {
    if (r.request().isNavigationRequest() && r.frame() === page.mainFrame()) status = r.status();
  };
  const blocked = () =>
    new SocialError("BLOCKED", `X otomatik tarayıcı erişimini engelledi (HTTP ${status}). Bu yöntemle X okunamıyor; Sosyal sekmesindeki notu oku.`);
  page.on("response", onResponse);
  try {
    // Gövdesiz 403 `goto`yu fırlattırır, gövdeli 403 normal yanıt döner: iki durumu da yakala
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    if (resp) status = resp.status();
  } catch (e) {
    if (status === 403 || status === 429) throw blocked();
    throw new SocialError("PARSE", `X sayfası açılamadı: ${String((e as Error).message).split("\n")[0]}`);
  } finally {
    page.off("response", onResponse);
  }
  if (status === 403 || status === 429) throw blocked();
}

async function open(page: Page, url: string, waitFor: string) {
  await gotoChecked(page, url);
  assertLoggedIn(page);
  await page.waitForSelector(waitFor, { timeout: 20_000 }).catch(() => undefined);
  assertLoggedIn(page);
  await sleep(jitter(700, 1500));
}

async function collectTweets(page: Page, want: number, maxScrolls = 4): Promise<SocialPost[]> {
  const seen = new Map<string, SocialPost>();
  for (let i = 0; i <= maxScrolls; i++) {
    const raw = (await page.evaluate(COLLECT_TWEETS)) as RawTweet[];
    for (const r of raw) {
      const p = normalizeXTweet(r);
      if (p && !seen.has(p.id)) seen.set(p.id, p);
    }
    if (seen.size >= want || i === maxScrolls) break;
    await page.mouse.wheel(0, 1400);
    await sleep(jitter(1000, 2200));
  }
  return [...seen.values()].slice(0, want);
}

export async function xSearchPosts(page: Page, q: string, mode: PostMode): Promise<SocialPost[]> {
  const f = mode === "latest" ? "live" : "top";
  await open(page, `https://x.com/search?q=${encodeURIComponent(q)}&src=typed_query&f=${f}`, 'article[data-testid="tweet"]');
  return collectTweets(page, 30);
}

export async function xSearchAccounts(page: Page, q: string): Promise<SocialAccount[]> {
  await open(page, `https://x.com/search?q=${encodeURIComponent(q)}&src=typed_query&f=user`, '[data-testid="UserCell"]');
  const raw = (await page.evaluate(COLLECT_USERS)) as RawUserCell[];
  return raw.map(normalizeXUserCell).filter((a): a is SocialAccount => a !== null).slice(0, 20);
}

export async function xProfile(page: Page, handle: string): Promise<SocialProfile> {
  await open(page, `https://x.com/${encodeURIComponent(handle)}`, '[data-testid="UserName"], [data-testid="emptyState"]');
  const raw = (await page.evaluate(PROFILE_STATS)) as RawXProfile;
  if (raw.missing) throw new SocialError("NOT_FOUND", `@${handle} bulunamadı ya da askıya alınmış.`);
  if (!raw.name) throw new SocialError("PARSE", "X profil sayfası okunamadı (sayfa yapısı değişmiş olabilir).");
  const all = await collectTweets(page, 20, 2);
  const posts = all.filter((p) => p.author.toLowerCase() === handle.toLowerCase());
  return normalizeXProfile(handle, raw, posts);
}
