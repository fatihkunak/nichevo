export interface Config {
  port: number;
  host: string;
  databaseUrl: string;
  jwtSecret: string;
  /** İkisi de tanımlı değilse Google ile giriş kapalıdır */
  google?: { clientId: string; clientSecret: string; publicUrl: string };
  /** SOCIAL_ALLOWED_EMAILS (virgülle) boşsa sosyal tarama tamamen kapalıdır */
  social?: { allowedEmails: string[]; profilesDir?: string; channel: string; refreshHours: number };
  /**
   * AI_API_KEY (eski ad: EVREN_API_KEY) + izin listesi (AI_ALLOWED_EMAILS, yoksa SOCIAL_ALLOWED_EMAILS) varsa sunucu
   * üzerinden yapay zekâ açıktır. Herhangi bir OpenAI uyumlu uç nokta olabilir (AI_BASE_URL); AI_MODEL doluysa
   * istemcinin istediği model yok sayılır ve bu model kullanılır.
   */
  ai?: { apiKey: string; baseUrl: string; allowedEmails: string[]; model?: string; provider: string };
  /**
   * SMTP_URL (smtps://kullanici:parola@sunucu:465) + MAIL_FROM varsa parola sıfırlama ve e-posta doğrulama açıktır;
   * yoksa kapalıdır (uç noktalar 503, uygulama düğmeleri göstermez).
   */
  mail?: { smtpUrl: string; from: string };
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
  // Yeni adlar öncelikli; EVREN_* geri uyumluluk için çalışmaya devam eder.
  const aiKey = (env.AI_API_KEY ?? env.EVREN_API_KEY)?.trim();
  const aiBaseUrl = (env.AI_BASE_URL ?? env.EVREN_BASE_URL)?.trim() || "https://evren-llmapi.ssyz.org.tr/v1";
  const aiModel = env.AI_MODEL?.trim();
  if (aiModel && !/^[A-Za-z0-9._\/:-]{1,64}$/.test(aiModel)) throw new Error("AI_MODEL geçersiz karakter içeriyor");
  const smtpUrl = env.SMTP_URL?.trim();
  const mailFrom = env.MAIL_FROM?.trim();
  if (smtpUrl && !mailFrom) throw new Error("SMTP_URL tanımlı ama MAIL_FROM yok (nichevo-backend/.env)");
  if (smtpUrl && !/^smtps?:\/\//i.test(smtpUrl)) throw new Error("SMTP_URL smtp:// ya da smtps:// ile başlamalı");
  return {
    mail: smtpUrl && mailFrom ? { smtpUrl, from: mailFrom } : undefined,
    ai:
      aiKey && aiAllowed.length
        ? {
            apiKey: aiKey,
            baseUrl: aiBaseUrl,
            allowedEmails: aiAllowed,
            model: aiModel || undefined,
            provider: env.AI_PROVIDER_NAME?.trim() || (/evren/i.test(aiBaseUrl) ? "evren" : "custom"),
          }
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
