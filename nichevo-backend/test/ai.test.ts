import type { FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";

const withDb = (url: string, db: string) => {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
};

const JWT = "test-secret-test-secret-test-secret-123456";
const KEY = "evren-secret-key-1234567890";
const ME = { email: "me@nichevo.app", password: "correct-horse-1", name: "Ben" };
const OTHER = { email: "other@nichevo.app", password: "correct-horse-1", name: "Başkası" };

let app: FastifyInstance;
let appPool: pg.Pool;
let ownerPool: pg.Pool;
let calls: { url: string; headers: Record<string, string>; body: any }[] = [];
let upstream: (url: string, init: RequestInit) => Promise<Response> = async () => new Response("{}");

const fakeFetch = (async (url: string, init: RequestInit) => {
  calls.push({ url: String(url), headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
  return upstream(String(url), init);
}) as unknown as typeof fetch;

const ok = (content: string, extra: object = {}) =>
  new Response(JSON.stringify({ model: "qwen3.8-flash-next", choices: [{ message: { content }, finish_reason: "stop" }], ...extra }), { status: 200 });

const build = (withAi = true) => {
  app = buildApp({
    pool: appPool,
    jwtSecret: JWT,
    ai: withAi ? { config: { apiKey: KEY, baseUrl: "https://evren.example/v1/" }, allowedEmails: [ME.email], fetchImpl: fakeFetch } : undefined,
  });
};

beforeAll(() => {
  process.loadEnvFile(".env");
  appPool = new pg.Pool({ connectionString: withDb(process.env.DATABASE_URL!, "nichevo_test") });
  ownerPool = new pg.Pool({ connectionString: withDb(process.env.OWNER_DATABASE_URL!, "nichevo_test") });
});
afterAll(async () => {
  await app.close();
  await appPool.end();
  await ownerPool.end();
});
beforeEach(async () => {
  await ownerPool.query("TRUNCATE users CASCADE");
  calls = [];
  upstream = async () => ok("merhaba");
  if (app) await app.close();
  build();
});

const reg = async (u: typeof ME) => (await app.inject({ method: "POST", url: "/v1/auth/register", payload: u })).json().accessToken as string;
const chat = (token: string | null, payload: unknown) =>
  app.inject({ method: "POST", url: "/v1/ai/chat", payload: payload as object, headers: token ? { authorization: `Bearer ${token}` } : {} });
const MSG = { system: "Sen bir asistansın", messages: [{ role: "user", text: "selam" }] };

describe("sunucu üzerinden EVREN", () => {
  it("kimliksiz 401; izin listesinde olmayan hesap 403 ve EVREN'e hiç istek gitmez", async () => {
    expect((await chat(null, MSG)).statusCode).toBe(401);
    const t = await reg(OTHER);
    expect((await chat(t, MSG)).statusCode).toBe(403);
    expect(calls).toHaveLength(0);
    const st = await app.inject({ method: "GET", url: "/v1/ai/status", headers: { authorization: `Bearer ${t}` } });
    expect(st.json().enabled).toBe(false);
  });

  it("izinli hesap: anahtar yalnızca X-API-Key başlığıyla EVREN'e gider; istek biçimi doğru; yanıt metni döner", async () => {
    const t = await reg(ME);
    const r = await chat(t, { ...MSG, model: "gemma-4-31b", maxTokens: 512, messages: [{ role: "user", text: "selam" }, { role: "model", text: "merhaba" }, { role: "user", text: "nasılsın" }] });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ text: "merhaba", model: "qwen3.8-flash-next" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://evren.example/v1/chat/completions"); // sondaki / temizlenir
    expect(calls[0]!.headers["x-api-key"]).toBe(KEY);
    expect(calls[0]!.headers["authorization"]).toBeUndefined();
    expect(calls[0]!.body).toMatchObject({
      model: "gemma-4-31b",
      max_tokens: 512,
      stream: false,
      messages: [
        { role: "system", content: "Sen bir asistansın" },
        { role: "user", content: "selam" },
        { role: "assistant", content: "merhaba" },
        { role: "user", content: "nasılsın" },
      ],
    });
    // anahtar yanıtta hiçbir yerde yok
    expect(r.body).not.toContain(KEY);
    const st = await app.inject({ method: "GET", url: "/v1/ai/status", headers: { authorization: `Bearer ${t}` } });
    expect(st.json()).toMatchObject({ enabled: true, provider: "evren" });
    expect(st.body).not.toContain(KEY);
  });

  it("varsayılan model auto ve 2048 token; sistem metni boşsa system mesajı eklenmez", async () => {
    const t = await reg(ME);
    await chat(t, { messages: [{ role: "user", text: "x" }] });
    expect(calls[0]!.body.model).toBe("auto");
    expect(calls[0]!.body.max_tokens).toBe(2048);
    expect(calls[0]!.body.messages).toEqual([{ role: "user", content: "x" }]);
  });

  it("üst servis hata gövdesi anahtarı yansıtsa bile istemciye sızmaz", async () => {
    const t = await reg(ME);
    upstream = async () => new Response(`invalid key ${KEY} for request`, { status: 401 });
    const r = await chat(t, MSG);
    expect(r.statusCode).toBe(502);
    expect(r.json().error.code).toBe("AI_UPSTREAM");
    expect(r.body).not.toContain(KEY);
    expect(r.json().error.message).toContain("***");
  });

  it("ağ hatası mesajı anahtarı içerse de sızmaz; zaman aşımı 504", async () => {
    const t = await reg(ME);
    upstream = async () => {
      throw new Error(`connect failed using ${KEY}`);
    };
    const r = await chat(t, MSG);
    expect(r.statusCode).toBe(502);
    expect(r.body).not.toContain(KEY);
    upstream = async () => {
      const e = new Error("aborted");
      e.name = "AbortError";
      throw e;
    };
    expect((await chat(t, MSG)).statusCode).toBe(504);
  });

  it("bozuk/boş yanıtlar anlaşılır hata verir (token sınırı ayrı mesaj)", async () => {
    const t = await reg(ME);
    upstream = async () => new Response("<html>", { status: 200 });
    expect((await chat(t, MSG)).json().error.code).toBe("AI_UPSTREAM");
    upstream = async () => ok("   ");
    expect((await chat(t, MSG)).json().error.code).toBe("AI_EMPTY");
    upstream = async () => new Response(JSON.stringify({ choices: [{ message: { content: "" }, finish_reason: "length" }] }), { status: 200 });
    expect((await chat(t, MSG)).json().error.message).toMatch(/token sınırı/);
  });

  it("geçersiz girdi 400: model adı, token üst sınırı, mesaj sayısı/uzunluğu, boş mesaj listesi", async () => {
    const t = await reg(ME);
    expect((await chat(t, { ...MSG, model: "../etc" })).statusCode).toBe(400);
    expect((await chat(t, { ...MSG, maxTokens: 99999 })).statusCode).toBe(400);
    expect((await chat(t, { ...MSG, messages: [] })).statusCode).toBe(400);
    expect((await chat(t, { ...MSG, messages: Array.from({ length: 31 }, () => ({ role: "user", text: "x" })) })).statusCode).toBe(400);
    expect((await chat(t, { ...MSG, messages: [{ role: "user", text: "x".repeat(12_001) }] })).statusCode).toBe(400);
    expect((await chat(t, { ...MSG, messages: [{ role: "admin", text: "x" }] })).statusCode).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("saatlik 60 istek sınırı", async () => {
    const t = await reg(ME);
    let last = 200;
    for (let i = 0; i < 61; i++) last = (await chat(t, MSG)).statusCode;
    expect(last).toBe(429);
    expect(calls).toHaveLength(60);
  });

  it("yapılandırılmamışsa uçlar yok (404)", async () => {
    await app.close();
    build(false);
    const t = await reg(ME);
    expect((await chat(t, MSG)).statusCode).toBe(404);
  });
});
