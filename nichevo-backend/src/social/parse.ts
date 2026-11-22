// Sayfadan/JSON'dan gelen ham değerleri temizleyen SAF yardımcılar (tarayıcı gerektirmez, test edilir).

export { extractHashtags, isoOrNull, parseCount } from "../../../shared/social-core";

/** "@foo", "https://x.com/foo/status/1", "instagram.com/foo/" → "foo"; geçersizse null */
export function normalizeHandle(input: string): string | null {
  let s = input.trim();
  s = s.replace(/^https?:\/\/(www\.)?(x\.com|twitter\.com|instagram\.com)\//i, "");
  s = s.replace(/^@/, "").split(/[/?#]/)[0] ?? "";
  // Harf/rakam/_ ile başlamalı: "..", ".x" gibi yol benzeri değerler URL'ye girmesin
  return /^[A-Za-z0-9_][A-Za-z0-9._]{0,29}$/.test(s) ? s : null;
}

/** Arama metnini sınırla: denetim karakterlerini at, uzunluğu kısıtla */
export function cleanQuery(input: string): string {
  // eslint-disable-next-line no-control-regex
  return input.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
}

/** [min,max] ms arası rastgele bekleme süresi (insan hızı) */
export const jitter = (min: number, max: number) => Math.round(min + Math.random() * (max - min));
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
