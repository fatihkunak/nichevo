import type { FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type { Mail, Mailer } from "../src/mailer.js";

const withDb = (url: string, db: string) => {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
};

let app: FastifyInstance;
let appPool: pg.Pool;
let ownerPool: pg.Pool;
let clock = Date.now();
let sent: Mail[] = [];
let failNext = false;

const JWT = "test-secret-test-secret-test-secret-123456";
const creds = { email: "kisi@nichevo.app", password: "correct-horse-1", name: "Kişi" };

const fakeMailer: Mailer = {
  async send(mail) {
    if (failNext) {
      failNext = false;
      throw new Error("SMTP bağlantısı kurulamadı");
    }
    sent.push(mail);
  },
};

const build = (withMailer: boolean) => buildApp({ pool: appPool, jwtSecret: JWT, now: () => clock, mailer: withMailer ? fakeMailer : undefined });

beforeAll(() => {
  process.loadEnvFile(".env");
  appPool = new pg.Pool({ connectionString: withDb(process.env.DATABASE_URL!, "nichevo_test") });
  ownerPool = new pg.Pool({ connectionString: withDb(process.env.OWNER_DATABASE_URL!, "nichevo_test") });
  app = build(true);
});

afterAll(async () => {
  await app.close();
  await appPool.end();
  await ownerPool.end();
});

beforeEach(async () => {
  clock = Date.now();
  sent = [];
  failNext = false;
  await ownerPool.query("TRUNCATE users CASCADE");
  await app.close();
  app = build(true);
});

const post = (url: string, payload: unknown, token?: string) =>
  app.inject({ method: "POST", url, payload: payload as object, headers: token ? { authorization: `Bearer ${token}` } : {} });
const get = (url: string, token?: string) => app.inject({ method: "GET", url, headers: token ? { authorization: `Bearer ${token}` } : {} });

const codeOf = (mail: Mail | undefined): string => {
  const m = /\b(\d{6})\b/.exec(mail?.text ?? "");
  if (!m) throw new Error("e-postada 6 haneli kod yok");
  return m[1]!;
};
const register = async () => (await post("/v1/auth/register", creds)).json();

describe("sağlayıcılar", () => {
  it("e-posta gönderimi yalnızca gönderici tanımlıysa açık görünür", async () => {
    expect((await get("/v1/auth/providers")).json().email).toBe(true);
    await app.close();
    app = build(false);
    expect((await get("/v1/auth/providers")).json().email).toBe(false);
  });
});

describe("parola sıfırlama: kod isteme", () => {
  it("gönderici yoksa 503 döner", async () => {
    await app.close();
    app = build(false);
    await register();
    const res = await post("/v1/auth/forgot-password", { email: creds.email });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("EMAIL_DISABLED");
  });

  it("kayıtlı e-postaya 6 haneli kod gönderir ve 202 döner", async () => {
    await register();
    sent = [];
    const res = await post("/v1/auth/forgot-password", { email: creds.email.toUpperCase() });
    expect(res.statusCode).toBe(202);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(creds.email);
    expect(codeOf(sent[0])).toMatch(/^\d{6}$/);
    const { rows } = await ownerPool.query("SELECT code_hash FROM email_codes WHERE purpose = 'pwreset'");
    expect(rows).toHaveLength(1);
    expect(rows[0].code_hash).not.toContain(codeOf(sent[0])); // kodun kendisi saklanmaz
  });

  it("kayıtsız e-postada da aynı yanıtı verir ama e-posta göndermez (hesap var mı sızmaz)", async () => {
    const res = await post("/v1/auth/forgot-password", { email: "yok@nichevo.app" });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ ok: true });
    expect(sent).toHaveLength(0);
  });

  it("şifresiz (Google) hesaba kod göndermez", async () => {
    await ownerPool.query(`INSERT INTO users (email, password_hash, name, google_sub, email_verified) VALUES ('g@nichevo.app', NULL, 'G', 'sub-1', true)`);
    const res = await post("/v1/auth/forgot-password", { email: "g@nichevo.app" });
    expect(res.statusCode).toBe(202);
    expect(sent).toHaveLength(0);
  });

  it("aynı e-posta için saatte en fazla 3 istek kabul eder", async () => {
    await register();
    sent = [];
    for (let i = 0; i < 3; i++) expect((await post("/v1/auth/forgot-password", { email: creds.email })).statusCode).toBe(202);
    const res = await post("/v1/auth/forgot-password", { email: creds.email });
    expect(res.statusCode).toBe(429);
    expect(sent).toHaveLength(3);
  });

  it("e-posta gönderimi hata verirse sunucu hatası sızdırmaz, yine 202 döner", async () => {
    await register();
    sent = [];
    failNext = true;
    const res = await post("/v1/auth/forgot-password", { email: creds.email });
    expect(res.statusCode).toBe(202);
    expect(sent).toHaveLength(0);
  });
});

describe("parola sıfırlama: kodla yeni şifre", () => {
  const request = async () => {
    await register();
    sent = [];
    await post("/v1/auth/forgot-password", { email: creds.email });
    return codeOf(sent[0]);
  };
  const reset = (code: string, newPassword = "yeni-sifre-99") => post("/v1/auth/reset-password", { email: creds.email, code, newPassword });

  it("doğru kodla şifreyi değiştirir, eski oturumları kapatır ve yeni oturum verir", async () => {
    const first = await register();
    sent = [];
    await post("/v1/auth/forgot-password", { email: creds.email });
    const res = await reset(codeOf(sent[0]));
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.accessToken.split(".")).toHaveLength(3);
    // eski şifre ölür, yeni şifre çalışır
    expect((await post("/v1/auth/login", { email: creds.email, password: creds.password })).statusCode).toBe(401);
    expect((await post("/v1/auth/login", { email: creds.email, password: "yeni-sifre-99" })).statusCode).toBe(200);
    // eski erişim ve yenileme jetonları geçersiz
    expect((await get("/v1/me", first.accessToken)).statusCode).toBe(401);
    expect((await post("/v1/auth/refresh", { refreshToken: first.refreshToken })).statusCode).toBe(401);
    expect((await get("/v1/me", b.accessToken)).statusCode).toBe(200);
  });

  it("yanlış kodu reddeder, şifre değişmez", async () => {
    const code = await request();
    const wrong = code === "000000" ? "000001" : "000000";
    const res = await reset(wrong);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("INVALID_CODE");
    expect((await post("/v1/auth/login", { email: creds.email, password: creds.password })).statusCode).toBe(200);
  });

  it("5 yanlış denemeden sonra doğru kod bile kilitlenir", async () => {
    const code = await request();
    const wrong = code === "000000" ? "000001" : "000000";
    for (let i = 0; i < 5; i++) expect((await reset(wrong)).statusCode).toBe(400);
    const res = await reset(code);
    expect(res.statusCode).toBe(400);
    expect((await post("/v1/auth/login", { email: creds.email, password: creds.password })).statusCode).toBe(200);
  });

  it("kod tek kullanımlıktır", async () => {
    const code = await request();
    expect((await reset(code)).statusCode).toBe(200);
    expect((await reset(code, "baska-sifre-77")).statusCode).toBe(400);
  });

  it("15 dakika sonra kodun süresi dolar", async () => {
    const code = await request();
    clock += 16 * 60_000;
    const res = await reset(code);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("INVALID_CODE");
  });

  it("yeni kod istenince eskisi geçersiz olur", async () => {
    const first = await request();
    sent = [];
    await post("/v1/auth/forgot-password", { email: creds.email });
    const second = codeOf(sent[0]);
    if (first !== second) expect((await reset(first)).statusCode).toBe(400);
    expect((await reset(second)).statusCode).toBe(200);
  });

  it("başka kullanıcının kodu işe yaramaz", async () => {
    const code = await request();
    await ownerPool.query(`INSERT INTO users (email, password_hash, name) VALUES ('baska@nichevo.app', 'x', 'B')`);
    const res = await post("/v1/auth/reset-password", { email: "baska@nichevo.app", code, newPassword: "yeni-sifre-99" });
    expect(res.statusCode).toBe(400);
  });

  it("kısa şifreyi ve geçersiz kod biçimini doğrulamada reddeder", async () => {
    const code = await request();
    expect((await reset(code, "kisa")).statusCode).toBe(400);
    expect((await reset("12ab56")).statusCode).toBe(400);
    expect((await reset(code)).statusCode).toBe(200); // kısa şifre denemesi kodu yakmaz
  });

  it("gönderici yoksa 503 döner", async () => {
    await register();
    await app.close();
    app = build(false);
    const res = await post("/v1/auth/reset-password", { email: creds.email, code: "123456", newPassword: "yeni-sifre-99" });
    expect(res.statusCode).toBe(503);
  });
});

describe("e-posta doğrulaması", () => {
  it("kayıtta doğrulama kodu gönderir; hesap doğrulanmamış başlar ama giriş engellenmez", async () => {
    const res = await post("/v1/auth/register", creds);
    expect(res.statusCode).toBe(201);
    expect(res.json().user.emailVerified).toBe(false);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(creds.email);
    expect((await post("/v1/auth/login", { email: creds.email, password: creds.password })).statusCode).toBe(200);
  });

  it("gönderici yoksa kayıt eskisi gibi çalışır, e-posta gitmez", async () => {
    await app.close();
    app = build(false);
    const res = await post("/v1/auth/register", creds);
    expect(res.statusCode).toBe(201);
    expect(sent).toHaveLength(0);
  });

  it("e-posta gönderimi hata verirse kayıt yine başarılı olur", async () => {
    failNext = true;
    const res = await post("/v1/auth/register", creds);
    expect(res.statusCode).toBe(201);
  });

  it("doğru kod hesabı doğrulanmış yapar", async () => {
    const reg = await register();
    const code = codeOf(sent[0]);
    const res = await post("/v1/auth/verify-email", { code }, reg.accessToken);
    expect(res.statusCode).toBe(200);
    expect(res.json().user.emailVerified).toBe(true);
    expect((await get("/v1/me", reg.accessToken)).json().user.emailVerified).toBe(true);
  });

  it("yanlış kodu reddeder; 5 denemeden sonra kilitlenir", async () => {
    const reg = await register();
    const code = codeOf(sent[0]);
    const wrong = code === "000000" ? "000001" : "000000";
    for (let i = 0; i < 5; i++) expect((await post("/v1/auth/verify-email", { code: wrong }, reg.accessToken)).statusCode).toBe(400);
    expect((await post("/v1/auth/verify-email", { code }, reg.accessToken)).statusCode).toBe(400);
  });

  it("oturum olmadan doğrulama 401 döner", async () => {
    expect((await post("/v1/auth/verify-email", { code: "123456" })).statusCode).toBe(401);
  });

  it("kodu yeniden gönderir (yeni kod eskisini geçersiz kılar), saatte 3 ile sınırlıdır", async () => {
    const reg = await register(); // 1 e-posta (kayıt)
    sent = [];
    for (let i = 0; i < 3; i++) expect((await post("/v1/auth/resend-verification", {}, reg.accessToken)).statusCode).toBe(202);
    expect(sent).toHaveLength(3);
    expect((await post("/v1/auth/resend-verification", {}, reg.accessToken)).statusCode).toBe(429);
    const last = codeOf(sent[2]);
    expect((await post("/v1/auth/verify-email", { code: last }, reg.accessToken)).statusCode).toBe(200);
  });

  it("zaten doğrulanmış hesaba yeniden e-posta göndermez", async () => {
    const reg = await register();
    await post("/v1/auth/verify-email", { code: codeOf(sent[0]) }, reg.accessToken);
    sent = [];
    const res = await post("/v1/auth/resend-verification", {}, reg.accessToken);
    expect(res.statusCode).toBe(200);
    expect(res.json().alreadyVerified).toBe(true);
    expect(sent).toHaveLength(0);
  });

  it("doğrulama kodu parola sıfırlamada kullanılamaz (amaçlar ayrı)", async () => {
    await register();
    const verifyCode = codeOf(sent[0]);
    sent = [];
    await post("/v1/auth/forgot-password", { email: creds.email });
    const resetCode = codeOf(sent[0]);
    if (verifyCode !== resetCode) {
      const res = await post("/v1/auth/reset-password", { email: creds.email, code: verifyCode, newPassword: "yeni-sifre-99" });
      expect(res.statusCode).toBe(400);
    }
  });
});
