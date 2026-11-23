import pg from "pg";

import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createSmtpMailer } from "./mailer.js";
import { PlaywrightDriver } from "./social/driver.js";
import { SocialService } from "./social/service.js";

const cfg = loadConfig();
const pool = new pg.Pool({ connectionString: cfg.databaseUrl, max: 10 });

// Sosyal tarama yalnızca SOCIAL_ALLOWED_EMAILS tanımlıysa açılır
const driver = cfg.social ? new PlaywrightDriver({ profilesDir: cfg.social.profilesDir, channel: cfg.social.channel }) : null;
const social = cfg.social && driver ? { service: new SocialService(pool, driver), allowedEmails: cfg.social.allowedEmails } : undefined;

const mailer = cfg.mail ? createSmtpMailer({ url: cfg.mail.smtpUrl, from: cfg.mail.from }) : undefined;

const app = buildApp({ pool, jwtSecret: cfg.jwtSecret, logger: true, google: cfg.google,
  social,
  mailer,
  ai: cfg.ai ? { config: { apiKey: cfg.ai.apiKey, baseUrl: cfg.ai.baseUrl, model: cfg.ai.model, provider: cfg.ai.provider }, allowedEmails: cfg.ai.allowedEmails } : undefined,
});

// Takip listesi otomatik yenileme: yarım saatte bir bakar, kayıt `refreshHours`'tan eskiyse sırayla (aralarda 20-60 sn) yeniler
let refreshTimer: NodeJS.Timeout | undefined;
let refreshing = false;
if (social && cfg.social) {
  const minAge = cfg.social.refreshHours * 3_600_000;
  refreshTimer = setInterval(() => {
    if (refreshing) return;
    refreshing = true;
    social.service
      .refreshStale(minAge)
      .then((r) => {
        if (r.ok || r.failed) app.log.info({ social: r }, "sosyal takip yenilemesi");
      })
      .catch((e) => app.log.error(e, "sosyal takip yenilemesi başarısız"))
      .finally(() => {
        refreshing = false;
      });
  }, 30 * 60_000);
  refreshTimer.unref();
}

const shutdown = async () => {
  if (refreshTimer) clearInterval(refreshTimer);
  await app.close();
  await driver?.closeAll();
  await pool.end();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await pool.query("SELECT 1"); // veritabanına ulaşılamıyorsa hemen düş
await app.listen({ port: cfg.port, host: cfg.host });
