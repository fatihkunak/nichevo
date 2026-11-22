export interface Config {
  port: number;
  host: string;
  databaseUrl: string;
  jwtSecret: string;
  /** İkisi de tanımlı değilse Google ile giriş kapalıdır */
  google?: { clientId: string; clientSecret: string; publicUrl: string };
  /** SOCIAL_ALLOWED_EMAILS (virgülle) boşsa sosyal tarama tamamen kapalıdır */
  social?: { allowedEmails: string[]; profilesDir?: string; channel: string; refreshHours: number };
  /** EVREN_API_KEY + izin listesi (AI_ALLOWED_EMAILS, yoksa SOCIAL_ALLOWED_EMAILS) varsa sunucu üzerinden yapay zekâ açıktır */
  ai?: { apiKey: string; baseUrl: string; allowedEmails: string[] };
}

const need = (env: NodeJS.ProcessEnv, k: string): string => {
  const v = env[k]?.trim();
  if (!v) throw new Error(`${k} tanımlı değil (nichevo-backend/.env)`);
  return v;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const jwtSecret = need(env, "JWT_SECRET");
  if (jwtSecret.length < 32) throw new Error("JWT_SECRET en az 32 karakter olmalı");
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  const allowedEmails = (env.SOCIAL_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const refreshHours = Number(env.SOCIAL_REFRESH_HOURS ?? 12);
  const aiEmails = (env.AI_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const aiAllowed = aiEmails.length ? aiEmails : allowedEmails;
  const evrenKey = env.EVREN_API_KEY?.trim();
  return {
    ai:
      evrenKey && aiAllowed.length
        ? { apiKey: evrenKey, baseUrl: env.EVREN_BASE_URL?.trim() || "https://evren-llmapi.ssyz.org.tr/v1", allowedEmails: aiAllowed }
        : undefined,
    social: allowedEmails.length
      ? {
          allowedEmails,
          profilesDir: env.SOCIAL_PROFILE_DIR?.trim() || undefined,
          channel: env.SOCIAL_CHROME_CHANNEL?.trim() || "chrome",
          refreshHours: Number.isFinite(refreshHours) && refreshHours >= 1 ? refreshHours : 12,
        }
      : undefined,
    port: Number(env.PORT ?? 3102),
    host: env.HOST ?? "127.0.0.1",
    databaseUrl: need(env, "DATABASE_URL"),
    jwtSecret,
    google:
      clientId && clientSecret
        ? { clientId, clientSecret, publicUrl: env.PUBLIC_URL?.trim() || "https://nichevo-api.fatihgo.com" }
        : undefined,
  };
}
