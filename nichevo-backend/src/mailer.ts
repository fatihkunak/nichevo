import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import nodemailer from "nodemailer";

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

/** E-posta gönderici soyutlaması: üretimde SMTP, testlerde sahte. */
export interface Mailer {
  send(mail: Mail): Promise<void>;
}

export interface SmtpConfig {
  /** smtps://kullanici:parola@sunucu:465 ya da smtp://... (STARTTLS) */
  url: string;
  /** Gönderen adresi, örn. `Nichevo <no-reply@alanadiniz.com>` */
  from: string;
}

export function createSmtpMailer(cfg: SmtpConfig): Mailer {
  const transport = nodemailer.createTransport({
    url: cfg.url,
    // Yavaş/kapalı SMTP sunucusu istekleri uzun süre asılı bırakmasın
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return {
    async send(mail) {
      await transport.sendMail({ from: cfg.from, to: mail.to, subject: mail.subject, text: mail.text });
    },
  };
}

// ---- Kodlar ----

export const CODE_TTL_MIN = 15;
export const CODE_MAX_ATTEMPTS = 5;
export type CodePurpose = "pwreset" | "verify";

/** 000000-999999 arası, kriptografik olarak rastgele 6 haneli kod. */
export const newCode = (): string => String(randomInt(0, 1_000_000)).padStart(6, "0");

/** Kodun özeti: kullanıcıya ve amaca bağlı HMAC. Veritabanı sızsa bile kod doğrudan okunamaz. */
export const hashCode = (secret: string, userId: string, purpose: CodePurpose, code: string): string =>
  createHmac("sha256", secret).update(`${userId}:${purpose}:${code}`).digest("hex");

export const sameHash = (a: string, b: string): boolean => {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && timingSafeEqual(x, y);
};

// ---- Metinler ----

export const resetMail = (to: string, code: string): Mail => ({
  to,
  subject: "Nichevo şifre sıfırlama kodu",
  text:
    `Nichevo şifreni sıfırlamak için kodun:\n\n${code}\n\n` +
    `Bu kod ${CODE_TTL_MIN} dakika geçerlidir ve tek kullanımlıktır. ` +
    `Bu isteği sen yapmadıysan bu e-postayı yok sayabilirsin; şifren değişmez.`,
});

export const verifyMail = (to: string, code: string): Mail => ({
  to,
  subject: "Nichevo e-posta doğrulama kodu",
  text:
    `Nichevo e-postanı doğrulamak için kodun:\n\n${code}\n\n` +
    `Bu kod ${CODE_TTL_MIN} dakika geçerlidir. Hesabı sen açmadıysan bu e-postayı yok sayabilirsin.`,
});
