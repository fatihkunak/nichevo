// Ekranların kullandığı birleşik sosyal API: telefonda X, kullanıcının KENDİ tarayıcısından (WebView) okunur ve sonuç
// sunucuya kaydedilir; Instagram sunucudaki test hesabı oturumuyla okunur. Web'de X yoktur (tarayıcı güvenlik modeli).
import { useMemo } from "react";

import { useXReader } from "@/components/x-reader";
import {
  ingestProfile,
  ingestTrends,
  refreshWatch as serverRefresh,
  socialSearch,
  socialTrends,
  type Cached,
  type HashtagInfo,
  type Platform,
  type SearchKind,
  type SocialAccount,
  type SocialPost,
  type TrendData,
  type WatchItem,
} from "@/lib/social";
import { aggregateHashtags, buildTrendData } from "@/shared/social-core";

export const X_WEB_MESSAGE =
  "X taraması için \"Nichevo X Okuyucu\" tarayıcı eklentisini kur (Sosyal > Bağlantı) ya da telefon uygulamasını kullan. Eklenti olmadan web'de yalnızca Instagram çalışır.";

const now = () => new Date().toISOString();
const live = <T,>(data: T): Cached<T> => ({ data, cached: false, fetchedAt: now() });

export type SearchData = SocialPost[] | SocialAccount[] | HashtagInfo[];

export function useSocialApi() {
  const x = useXReader();
  return useMemo(() => {
    const needX = (platform: Platform) => {
      if (platform === "x" && !x.available) throw new Error(X_WEB_MESSAGE);
    };

    return {
      xAvailable: x.available,
      openXLogin: () => x.openLogin(),

      async search(platform: Platform, kind: SearchKind, q: string, mode: "top" | "latest" = "top"): Promise<Cached<SearchData>> {
        if (platform !== "x") return socialSearch(platform, kind, q, kind === "posts" ? mode : undefined);
        needX(platform);
        if (kind === "accounts") {
          const r = await x.read({ kind: "accounts", q });
          return live(r.kind === "accounts" ? r.accounts : []);
        }
        const r = await x.read({ kind: "posts", q, mode: kind === "posts" ? mode : "top" });
        const posts = r.kind === "posts" ? r.posts : [];
        return live(kind === "posts" ? posts : aggregateHashtags(posts, q).slice(0, 25));
      },

      async trends(platform: Platform, q: string): Promise<Cached<TrendData>> {
        if (platform !== "x") return socialTrends(platform, q);
        needX(platform);
        const top = await x.read({ kind: "posts", q, mode: "top" });
        const latest = await x.read({ kind: "posts", q, mode: "latest" });
        const posts = [...(top.kind === "posts" ? top.posts : []), ...(latest.kind === "posts" ? latest.posts : [])];
        const data = buildTrendData(posts, q);
        await ingestTrends("x", q, data).catch(() => undefined); // sunucu kaydı başarısızsa sonuç yine gösterilir
        return live(data);
      },

      async refreshWatch(w: Pick<WatchItem, "id" | "platform" | "handle">): Promise<void> {
        if (w.platform !== "x") return void (await serverRefresh(w.id));
        needX(w.platform);
        const r = await x.read({ kind: "profile", handle: w.handle });
        if (r.kind === "profile") await ingestProfile(w.id, r.profile);
      },
    };
  }, [x]);
}
