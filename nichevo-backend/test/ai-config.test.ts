import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";

const base = {
  DATABASE_URL: "postgres://x:y@127.0.0.1:5545/z",
  JWT_SECRET: "test-secret-test-secret-test-secret-123456",
  SOCIAL_ALLOWED_EMAILS: "Me@Nichevo.app",
};

describe("loadConfig: yapay zekâ ortam değişkenleri", () => {
  it("anahtar yoksa ya da izin listesi boşsa kapalı", () => {
    expect(loadConfig({ ...base }).ai).toBeUndefined();
    expect(loadConfig({ DATABASE_URL: base.DATABASE_URL, JWT_SECRET: base.JWT_SECRET, AI_API_KEY: "k" }).ai).toBeUndefined();
  });

  it("eski EVREN_* adları aynen çalışır (geri uyumluluk)", () => {
    const ai = loadConfig({ ...base, EVREN_API_KEY: "evren-key" }).ai!;
    expect(ai).toMatchObject({ apiKey: "evren-key", baseUrl: "https://evren-llmapi.ssyz.org.tr/v1", provider: "evren", allowedEmails: ["me@nichevo.app"] });
    expect(ai.model).toBeUndefined();
  });

  it("AI_* adları EVREN_* adlarından önceliklidir; model ve sağlayıcı adı okunur", () => {
    const ai = loadConfig({
      ...base,
      EVREN_API_KEY: "eski",
      AI_API_KEY: "yeni",
      AI_BASE_URL: "http://localhost:20128/v1",
      AI_MODEL: "coding",
    }).ai!;
    expect(ai).toMatchObject({ apiKey: "yeni", baseUrl: "http://localhost:20128/v1", model: "coding", provider: "custom" });
    expect(loadConfig({ ...base, AI_API_KEY: "k", AI_PROVIDER_NAME: "omniroute" }).ai!.provider).toBe("omniroute");
  });

  it("geçersiz AI_MODEL başlangıçta reddedilir", () => {
    expect(() => loadConfig({ ...base, AI_API_KEY: "k", AI_MODEL: "a b;rm" })).toThrow(/AI_MODEL/);
  });
});
