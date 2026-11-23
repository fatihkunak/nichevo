import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";

const base = {
  DATABASE_URL: "postgres://x:y@127.0.0.1:5545/z",
  JWT_SECRET: "test-secret-test-secret-test-secret-123456",
};

describe("loadConfig: e-posta (SMTP) ortam değişkenleri", () => {
  it("SMTP_URL yoksa e-posta özellikleri kapalıdır", () => {
    expect(loadConfig({ ...base }).mail).toBeUndefined();
  });

  it("SMTP_URL + MAIL_FROM ile açılır", () => {
    const mail = loadConfig({ ...base, SMTP_URL: "smtps://u:p@smtp.ornek.com:465", MAIL_FROM: "Nichevo <no-reply@ornek.com>" }).mail!;
    expect(mail).toEqual({ smtpUrl: "smtps://u:p@smtp.ornek.com:465", from: "Nichevo <no-reply@ornek.com>" });
  });

  it("MAIL_FROM olmadan SMTP_URL hata verir", () => {
    expect(() => loadConfig({ ...base, SMTP_URL: "smtps://u:p@smtp.ornek.com:465" })).toThrow(/MAIL_FROM/);
  });

  it("SMTP_URL smtp/smtps dışında bir şemayla başlarsa hata verir", () => {
    expect(() => loadConfig({ ...base, SMTP_URL: "http://x", MAIL_FROM: "a@b.c" })).toThrow(/smtp/);
  });
});
