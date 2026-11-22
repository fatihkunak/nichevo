// Sosyal tarama (X + Instagram) ortak tipler. Yalnızca OKUMA: beğenme, takip, paylaşma, mesaj yok.
// Veri tipleri uygulamayla paylaşılır (shared/social-core.ts).
import type { Platform, SocialAccount, SocialPost, SocialProfile } from "../../../shared/social-core";

export type { HashtagInfo, Platform, SocialAccount, SocialPost, SocialProfile, TrendData } from "../../../shared/social-core";

export const PLATFORMS: Platform[] = ["x", "instagram"];
export const isPlatform = (v: unknown): v is Platform => v === "x" || v === "instagram";

export type SocialErrorCode =
  | "NOT_CONNECTED" // bu platform için test hesabı girişi yapılmamış
  | "LOGIN_REQUIRED" // oturum düşmüş/geçersiz
  | "BLOCKED" // platform hız sınırı ya da güvenlik doğrulaması istedi
  | "NOT_FOUND"
  | "PARSE" // sayfa yapısı değişmiş, okuyucu güncellenmeli
  | "BUSY"; // giriş penceresi açık

export class SocialError extends Error {
  constructor(
    public code: SocialErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SocialError";
  }
}

export interface ConnectionStatus {
  connected: boolean;
  handle?: string;
  since?: string;
}

export type PostMode = "top" | "latest";

/** Gerçek uygulama Playwright sürücüsüdür; testlerde sahte sürücü verilir. */
export interface SocialDriver {
  status(platform: Platform): ConnectionStatus;
  loginInProgress(platform: Platform): boolean;
  searchPosts(platform: Platform, q: string, mode: PostMode): Promise<SocialPost[]>;
  searchAccounts(platform: Platform, q: string): Promise<SocialAccount[]>;
  /** Instagram: hashtag araması (gönderi sayısıyla). X: kullanılmaz, hashtag'ler gönderilerden çıkarılır. */
  searchHashtags(platform: Platform, q: string): Promise<{ tag: string; postCount: number | null }[]>;
  profile(platform: Platform, handle: string): Promise<SocialProfile>;
  beginLogin(platform: Platform): Promise<{ started: boolean; command: string }>;
  disconnect(platform: Platform): Promise<void>;
}
