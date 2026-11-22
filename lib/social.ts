// Sosyal tarama istemcisi: Nichevo sunucusundaki /v1/social/* uç noktaları (X + Instagram, yalnızca okuma).
// Kazıma sunucu makinesinde, test hesabı oturumuyla yapılır; telefon yalnızca sonucu okur.
import { authedRequest, apiConfigured } from "@/lib/api";
import type { HashtagInfo, SocialAccount, SocialPost, SocialProfile, TrendData } from "@/shared/social-core";
import type { Platform } from "@/lib/social-format";

export type { Platform };

export type { HashtagInfo, SocialAccount, SocialPost, SocialProfile, TrendData } from "@/shared/social-core";

export interface PlatformStatus {
  connected: boolean;
  handle?: string;
  since?: string;
  loginInProgress: boolean;
}

export type SocialStatus = { enabled: false } | { enabled: true; platforms: Record<Platform, PlatformStatus> };

export interface WatchItem {
  id: string;
  platform: Platform;
  handle: string;
  name: string;
  lastCheckedAt: string | null;
  lastError: string | null;
  followers: number | null;
  following: number | null;
  postsCount: number | null;
  followersWeekDelta: number | null;
  posts: Pick<SocialPost, "id" | "url" | "text" | "postedAt" | "likes" | "replies" | "reposts" | "views">[];
}

export interface Cached<T> {
  data: T;
  cached: boolean;
  fetchedAt: string;
}

export type SearchKind = "posts" | "accounts" | "hashtags";

const qs = (o: Record<string, string | undefined>) =>
  Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(v!)}`)
    .join("&");

export const socialAvailable = (): boolean => apiConfigured();

export const fetchSocialStatus = () => authedRequest<SocialStatus>("/v1/social/status", "GET");

export const startSocialLogin = (p: Platform) => authedRequest<{ started: boolean; command: string }>(`/v1/social/${p}/login`, "POST");

export const disconnectSocial = (p: Platform) => authedRequest<void>(`/v1/social/${p}/session`, "DELETE");

export const socialSearch = (platform: Platform, kind: SearchKind, q: string, mode?: "top" | "latest") =>
  authedRequest<Cached<SocialPost[] | SocialAccount[] | HashtagInfo[]>>(`/v1/social/search?${qs({ platform, kind, q, mode })}`, "GET");

export const socialTrends = (platform: Platform, q: string) => authedRequest<Cached<TrendData>>(`/v1/social/trends?${qs({ platform, q })}`, "GET");

export const listWatch = async () => (await authedRequest<{ items: WatchItem[] }>("/v1/social/watch", "GET")).items;

export const addWatch = (platform: Platform, handle: string) => authedRequest<{ id: string; platform: Platform; handle: string }>("/v1/social/watch", "POST", { platform, handle });

export const removeWatch = (id: string) => authedRequest<void>(`/v1/social/watch/${id}`, "DELETE");

/** Uygulamanın kendi tarayıcısından (X) okuduğu profili takip kaydına yazdırır */
export const ingestProfile = (watchId: string, profile: SocialProfile) =>
  authedRequest<{ ok: true }>(`/v1/social/watch/${watchId}/ingest`, "POST", { profile });

/** Uygulamanın hesapladığı trend verisini sunucuya yollar (asistan özetine girsin) */
export const ingestTrends = (platform: Platform, q: string, data: TrendData) =>
  authedRequest<{ ok: true }>("/v1/social/trends/ingest", "POST", { platform, q, data });

export const refreshWatch = (id: string) => authedRequest<{ ok: true }>(`/v1/social/watch/${id}/refresh`, "POST");

// --- asistan bağlamı ---
let digestCache: { at: number; text: string | null } | null = null;
const DIGEST_TTL = 2 * 60_000;

/** Asistan için sosyal veri özeti. Sunucu yok / yetkisiz / veri boş / hata → null (asistan sessizce verisiz çalışır). */
export async function loadSocialDigest(force = false): Promise<string | null> {
  if (!socialAvailable()) return null;
  if (!force && digestCache && Date.now() - digestCache.at < DIGEST_TTL) return digestCache.text;
  let text: string | null = null;
  try {
    const r = await authedRequest<{ text: string; watched: number; trends: number }>("/v1/social/digest", "GET");
    text = r.text.trim() && (r.watched > 0 || r.trends > 0) ? r.text : null;
  } catch {
    text = null;
  }
  digestCache = { at: Date.now(), text };
  return text;
}

/** Takip/yenileme sonrası asistanın eski özeti kullanmaması için */
export const invalidateSocialDigest = () => {
  digestCache = null;
};
