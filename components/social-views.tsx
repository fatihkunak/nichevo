import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Platform as RNPlatform, Pressable, Text, TextInput, View } from "react-native";

import { Card, Chip, GradientButton } from "@/components/nv";
import { X_WEB_MESSAGE, useSocialApi } from "@/components/social-api";
import { useColors } from "@/hooks/use-colors";
import {
  addWatch,
  disconnectSocial,
  fetchSocialStatus,
  invalidateSocialDigest,
  listWatch,
  removeWatch,
  startSocialLogin,
  type HashtagInfo,
  type Platform,
  type PlatformStatus,
  type SearchKind,
  type SocialAccount,
  type SocialPost,
  type TrendData,
  type WatchItem,
} from "@/lib/social";
import { PLATFORM_LABEL, formatCount, formatDelta, timeAgo } from "@/lib/social-format";

const PLATFORMS: Platform[] = ["x", "instagram"];

const open = (url: string) => {
  Linking.openURL(url).catch(() => undefined);
};

function Muted({ children }: { children: React.ReactNode }) {
  return <Text className="text-muted text-[12px]">{children}</Text>;
}

function ErrorText({ msg }: { msg: string | null }) {
  const colors = useColors();
  return msg ? <Text style={{ color: colors.error ?? "#F87171", fontSize: 12, marginBottom: 8 }}>{msg}</Text> : null;
}

function Field({ value, onChange, placeholder, onSubmit }: { value: string; onChange: (s: string) => void; placeholder: string; onSubmit: () => void }) {
  const colors = useColors();
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={colors.muted}
      autoCapitalize="none"
      autoCorrect={false}
      onSubmitEditing={onSubmit}
      returnKeyType="search"
      className="text-foreground rounded-xl border px-3 mb-2"
      style={{ borderColor: colors.border, backgroundColor: "rgba(13,6,32,0.85)", paddingVertical: 10 }}
    />
  );
}

function PlatformChips({ value, onChange }: { value: Platform; onChange: (p: Platform) => void }) {
  return (
    <View className="flex-row flex-wrap">
      {PLATFORMS.map((p) => (
        <Chip key={p} label={PLATFORM_LABEL[p]} active={value === p} onPress={() => onChange(p)} />
      ))}
    </View>
  );
}

function Metrics({ p }: { p: Pick<SocialPost, "likes" | "replies" | "reposts" | "views"> }) {
  const parts = [
    p.likes !== null && `♥ ${formatCount(p.likes)}`,
    p.replies !== null && `💬 ${formatCount(p.replies)}`,
    p.reposts !== null && `↻ ${formatCount(p.reposts)}`,
    p.views !== null && `👁 ${formatCount(p.views)}`,
  ].filter(Boolean);
  return parts.length ? <Muted>{parts.join("   ")}</Muted> : null;
}

function PostCard({ p }: { p: Pick<SocialPost, "url" | "text" | "postedAt" | "likes" | "replies" | "reposts" | "views"> & { author?: string } }) {
  return (
    <Pressable onPress={() => open(p.url)} className="mb-2 pb-2 border-b" style={{ borderColor: "rgba(139,92,246,0.18)" }}>
      <View className="flex-row justify-between">
        <Text className="text-foreground text-[13px] font-semibold">{p.author ? `@${p.author}` : ""}</Text>
        <Muted>{timeAgo(p.postedAt)}</Muted>
      </View>
      <Text className="text-foreground text-[13px] my-1" numberOfLines={5}>
        {p.text || "(metin yok)"}
      </Text>
      <Metrics p={p} />
    </Pressable>
  );
}

// ---------------- Bağlantı ----------------
export function ConnectionView({ platforms, onChanged }: { platforms: Record<Platform, PlatformStatus>; onChanged: () => void }) {
  const api = useSocialApi();
  const [xNote, setXNote] = useState("");
  const [busy, setBusy] = useState<Platform | null>(null);
  const [note, setNote] = useState<Record<Platform, string>>({ x: "", instagram: "" });

  // Giriş penceresi açıkken durumu 3 sn'de bir yokla
  const waiting = PLATFORMS.some((p) => platforms[p].loginInProgress);
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(onChanged, 3000);
    return () => clearInterval(t);
  }, [waiting, onChanged]);

  const login = async (p: Platform) => {
    setBusy(p);
    try {
      const r = await startSocialLogin(p);
      setNote((n) => ({
        ...n,
        [p]: r.started
          ? "Bilgisayarında bir Chrome penceresi açıldı. Orada TEST hesabıyla giriş yap; bitince pencere kendiliğinden kapanır."
          : `Sunucu pencere açamadı. Bilgisayarda şu komutu çalıştır:\n${r.command}`,
      }));
      onChanged();
    } catch (e) {
      setNote((n) => ({ ...n, [p]: (e as Error).message }));
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async (p: Platform) => {
    setBusy(p);
    try {
      await disconnectSocial(p);
      setNote((n) => ({ ...n, [p]: "" }));
      onChanged();
    } catch (e) {
      setNote((n) => ({ ...n, [p]: (e as Error).message }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <View>
      <Card title="Nasıl okunuyor?" hint="yalnızca okuma">
        <Muted>
          Nichevo hiçbir şey beğenmez, takip etmez, paylaşmaz; yalnızca okur. Ana hesabını kullanma: platformlar otomatik gezinmeyi hesap kilidiyle cezalandırabilir, bu iş için ayrı bir TEST hesabı aç.
        </Muted>
        <Text className="text-foreground text-[12px] mt-2">
          • X: bu telefonun kendi tarayıcısı açılır, X'e kendin giriş yaparsın, uygulama sayfayı okur (sunucu X'e hiç girmez; X otomatik sunucu tarayıcısını 403 ile engelliyor).
        </Text>
        <Text className="text-foreground text-[12px] mt-1">• Instagram: Nichevo bilgisayarındaki test hesabı oturumuyla okunur (profil takibi ve gönderi araması).</Text>
      </Card>
      <Card title="X" hint={RNPlatform.OS === "web" ? (api.xAvailable ? "tarayıcı eklentisi bağlı" : "eklenti gerekli") : "bu telefonun tarayıcısı"}>
        {api.xAvailable ? (
          <>
            <Muted>
              {RNPlatform.OS === "web"
                ? "Nichevo X Okuyucu eklentisi bağlı. X'i taradığında açılan küçük pencerede X'e girmen istenirse gir; giriş tarayıcında kalır, şifren Nichevo'ya gelmez."
                : "Giriş bu cihazdaki tarayıcıda kalır; şifren Nichevo'ya gelmez. Bir kez giriş yapman yeterli, ilk X taramasında da giriş istenirse aynı pencerede yapabilirsin."}
            </Muted>
            {xNote ? <Text className="text-foreground text-[12px] mt-2">{xNote}</Text> : null}
            <View className="flex-row mt-3">
              <GradientButton
                small
                title="X'e giriş yap"
                onPress={() => {
                  setXNote("");
                  api.openXLogin().then(
                    () => setXNote("Pencere kapandı. Giriş yaptıysan artık Ara, Takip ve Trend'de X'i kullanabilirsin."),
                    (e) => setXNote((e as Error).message),
                  );
                }}
              />
            </View>
          </>
        ) : (
          <>
            <Muted>{X_WEB_MESSAGE}</Muted>
            {RNPlatform.OS === "web" ? (
              <Text className="text-foreground text-[12px] mt-2">
                Kurulum (bir kez, Chrome/Edge): 1) adres çubuğuna chrome://extensions yaz, 2) sağ üstten "Geliştirici modu"nu aç, 3) "Paketlenmemiş öğe yükle" de ve Nichevo deposundaki extension klasörünü seç, 4) bu sayfayı yenile.
              </Text>
            ) : null}
          </>
        )}
      </Card>
      {PLATFORMS.filter((p) => p !== "x").map((p) => {
        const s = platforms[p];
        return (
          <Card key={p} title={PLATFORM_LABEL[p]} hint={s.loginInProgress ? "giriş bekleniyor…" : s.connected ? "bağlı" : "bağlı değil"}>
            <Muted>{s.connected ? `Oturum açık${s.handle ? ` (@${s.handle})` : ""}${s.since ? ` · ${timeAgo(s.since)}` : ""}` : "Henüz giriş yapılmadı."}</Muted>
            {note[p] ? <Text className="text-foreground text-[12px] mt-2">{note[p]}</Text> : null}
            <View className="flex-row mt-3" style={{ gap: 8 }}>
              <GradientButton small title={s.connected ? "Yeniden giriş yap" : "Giriş yap"} onPress={() => login(p)} loading={busy === p} disabled={s.loginInProgress} />
              {s.connected ? <GradientButton small title="Bağlantıyı kes" onPress={() => disconnect(p)} disabled={busy === p} /> : null}
            </View>
          </Card>
        );
      })}
    </View>
  );
}

// ---------------- Ara ----------------
type SearchResult =
  | { kind: "posts"; items: SocialPost[] }
  | { kind: "accounts"; items: SocialAccount[] }
  | { kind: "hashtags"; items: HashtagInfo[] };

export function SearchView({ onWatched }: { onWatched: () => void }) {
  const api = useSocialApi();
  const [platform, setPlatform] = useState<Platform>("x");
  const [kind, setKind] = useState<SearchKind>("posts");
  const [mode, setMode] = useState<"top" | "latest">("top");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<(SearchResult & { cached: boolean; fetchedAt: string }) | null>(null);
  const [watched, setWatched] = useState<Set<string>>(new Set());

  const run = useCallback(
    async (query = q, k = kind) => {
      const text = query.trim();
      if (!text || busy) return;
      setBusy(true);
      setError(null);
      try {
        const r = await api.search(platform, k, text, mode);
        setResult({ kind: k, items: r.data, cached: r.cached, fetchedAt: r.fetchedAt } as SearchResult & { cached: boolean; fetchedAt: string });
      } catch (e) {
        setResult(null);
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [q, kind, mode, platform, busy, api],
  );

  const watch = async (a: SocialAccount) => {
    try {
      await addWatch(a.platform, a.handle);
      setWatched((w) => new Set(w).add(`${a.platform}:${a.handle}`));
      invalidateSocialDigest();
      onWatched();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <View>
      <Card title="Niş tara">
        <PlatformChips value={platform} onChange={setPlatform} />
        <View className="flex-row flex-wrap">
          <Chip label="Gönderi" active={kind === "posts"} onPress={() => setKind("posts")} />
          <Chip label="Hesap" active={kind === "accounts"} onPress={() => setKind("accounts")} />
          <Chip label="Hashtag" active={kind === "hashtags"} onPress={() => setKind("hashtags")} />
        </View>
        {kind === "posts" ? (
          <View className="flex-row flex-wrap">
            <Chip label="Popüler" active={mode === "top"} onPress={() => setMode("top")} />
            <Chip label="En yeni" active={mode === "latest"} onPress={() => setMode("latest")} />
          </View>
        ) : null}
        {platform === "instagram" ? <Muted>Instagram'da yalnızca gönderi araması ve profil takibi çalışır (hesap ve hashtag araması Instagram tarafından kapatıldı). Sonuçlarda beğeni sayısı çoğunlukla görünmez.</Muted> : null}
        <View style={{ height: 8 }} />
        <Field value={q} onChange={setQ} placeholder={kind === "accounts" ? "örn. yapay zeka" : "örn. kişisel finans"} onSubmit={() => run()} />
        <GradientButton title="Tara" onPress={() => run()} loading={busy} disabled={!q.trim()} />
      </Card>

      <ErrorText msg={error} />
      {busy ? <ActivityIndicator style={{ marginVertical: 12 }} /> : null}

      {result ? (
        <Card title={`${result.items.length} sonuç`} hint={result.cached ? `önbellek · ${timeAgo(result.fetchedAt)}` : "canlı"}>
          {result.items.length === 0 ? <Muted>Sonuç yok. Başka bir kelime dene.</Muted> : null}
          {result.kind === "posts" && result.items.map((p) => <PostCard key={p.id} p={p} />)}
          {result.kind === "accounts" &&
            result.items.map((a) => {
              const done = watched.has(`${a.platform}:${a.handle}`);
              return (
                <View key={a.handle} className="flex-row items-center justify-between mb-2">
                  <Pressable className="flex-1 pr-2" onPress={() => open(a.url)}>
                    <Text className="text-foreground text-[13px] font-semibold">
                      {a.name || a.handle} <Text className="text-muted">@{a.handle}</Text>
                    </Text>
                    {a.bio ? (
                      <Text className="text-muted text-[12px]" numberOfLines={2}>
                        {a.bio}
                      </Text>
                    ) : null}
                    {a.followers !== null ? <Muted>{formatCount(a.followers)} takipçi</Muted> : null}
                  </Pressable>
                  <GradientButton small title={done ? "Takipte" : "Takibe al"} onPress={() => watch(a)} disabled={done} />
                </View>
              );
            })}
          {result.kind === "hashtags" &&
            result.items.map((h) => (
              <Pressable
                key={h.tag}
                className="flex-row justify-between mb-2"
                onPress={() => {
                  setKind("posts");
                  setQ(`#${h.tag}`);
                  run(`#${h.tag}`, "posts");
                }}
              >
                <Text className="text-foreground text-[13px]">#{h.tag}</Text>
                <Muted>{[h.postCount !== null && `${formatCount(h.postCount)} gönderi`, h.mentions > 0 && `${h.mentions}× geçti`].filter(Boolean).join(" · ")}</Muted>
              </Pressable>
            ))}
        </Card>
      ) : null}
    </View>
  );
}

// ---------------- Takip ----------------
export function WatchView({ reloadKey }: { reloadKey: number }) {
  const api = useSocialApi();
  const [items, setItems] = useState<WatchItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [platform, setPlatform] = useState<Platform>("x");
  const [handle, setHandle] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await listWatch());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const add = async () => {
    if (!handle.trim() || adding) return;
    setAdding(true);
    try {
      const r = await addWatch(platform, handle);
      setHandle("");
      invalidateSocialDigest();
      await load();
      // eklenir eklenmez ilk veriyi çek
      setBusyId(r.id);
      await api.refreshWatch({ id: r.id, platform: r.platform, handle: r.handle }).catch((e) => setError((e as Error).message));
      invalidateSocialDigest();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
      setAdding(false);
    }
  };

  const refresh = async (w: WatchItem) => {
    const id = w.id;
    setBusyId(id);
    setError(null);
    try {
      await api.refreshWatch(w);
    } catch (e) {
      setError((e as Error).message);
    }
    invalidateSocialDigest();
    await load();
    setBusyId(null);
  };

  const remove = async (id: string) => {
    try {
      await removeWatch(id);
      invalidateSocialDigest();
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <View>
      <Card title="Rakip / hesap takibi" hint="Instagram: 12 saatte bir otomatik · X: telefonda Yenile">
        <PlatformChips value={platform} onChange={setPlatform} />
        <Field value={handle} onChange={setHandle} placeholder="@kullanıcıadı ya da profil bağlantısı" onSubmit={add} />
        <GradientButton title="Takibe ekle" onPress={add} loading={adding} disabled={!handle.trim()} />
      </Card>
      <ErrorText msg={error} />
      {items === null ? <ActivityIndicator style={{ marginVertical: 12 }} /> : null}
      {items?.length === 0 ? <Muted>Henüz takip ettiğin hesap yok.</Muted> : null}
      {items?.map((w) => (
        <Card key={w.id} title={`${PLATFORM_LABEL[w.platform]} · @${w.handle}`} hint={w.lastCheckedAt ? timeAgo(w.lastCheckedAt) : "henüz çekilmedi"}>
          {w.name ? <Text className="text-foreground text-[13px] mb-1">{w.name}</Text> : null}
          <Muted>
            {formatCount(w.followers)} takipçi{w.followersWeekDelta !== null ? ` (7 gün: ${formatDelta(w.followersWeekDelta)})` : ""} · {formatCount(w.postsCount)} gönderi
          </Muted>
          {w.lastError ? <ErrorText msg={`Son yenileme hatası: ${w.lastError}`} /> : null}
          <View style={{ height: 8 }} />
          {w.posts.slice(0, 3).map((p) => (
            <PostCard key={p.id} p={p} />
          ))}
          <View className="flex-row mt-1" style={{ gap: 8 }}>
            <GradientButton small title="Yenile" onPress={() => refresh(w)} loading={busyId === w.id} />
            <GradientButton small title="Takipten çıkar" onPress={() => remove(w.id)} disabled={busyId === w.id} />
          </View>
        </Card>
      ))}
    </View>
  );
}

// ---------------- Trend ----------------
export function TrendView() {
  const api = useSocialApi();
  const [platform, setPlatform] = useState<Platform>("x");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<{ t: TrendData; cached: boolean; fetchedAt: string } | null>(null);
  const reqId = useRef(0);

  const run = async () => {
    const text = q.trim();
    if (!text || busy) return;
    const id = ++reqId.current;
    setBusy(true);
    setError(null);
    try {
      const r = await api.trends(platform, text);
      if (id === reqId.current) {
        setData({ t: r.data, cached: r.cached, fetchedAt: r.fetchedAt });
        invalidateSocialDigest(); // yeni trend asistanın özetine girsin
      }
    } catch (e) {
      if (id === reqId.current) {
        setData(null);
        setError((e as Error).message);
      }
    } finally {
      if (id === reqId.current) setBusy(false);
    }
  };

  return (
    <View>
      <Card title="Trend konu ve hashtag">
        <PlatformChips value={platform} onChange={setPlatform} />
        <Field value={q} onChange={setQ} placeholder="örn. yapay zeka araçları" onSubmit={run} />
        <GradientButton title="Trendleri getir" onPress={run} loading={busy} disabled={!q.trim()} />
      </Card>
      <ErrorText msg={error} />
      {data ? (
        <>
          <Card title="Hashtag'ler" hint={`${data.t.sampleSize} gönderi örneği · ${data.cached ? `önbellek ${timeAgo(data.fetchedAt)}` : "canlı"}`}>
            {data.t.hashtags.length === 0 ? <Muted>Hashtag bulunamadı.</Muted> : null}
            {data.t.hashtags.map((h) => (
              <View key={h.tag} className="flex-row justify-between mb-1">
                <Text className="text-foreground text-[13px]">#{h.tag}</Text>
                <Muted>{[h.postCount !== null && `${formatCount(h.postCount)} gönderi`, h.mentions > 0 && `${h.mentions}× · etkileşim ${formatCount(h.engagement)}`].filter(Boolean).join(" · ")}</Muted>
              </View>
            ))}
          </Card>
          <Card title="En çok etkileşim alanlar">
            {data.t.topPosts.length === 0 ? <Muted>Gönderi yok.</Muted> : null}
            {data.t.topPosts.map((p) => (
              <PostCard key={p.id} p={p} />
            ))}
          </Card>
        </>
      ) : null}
    </View>
  );
}

/** Üst düzey: durumu yükler (sunucu yok / yetkisiz / hata durumlarını ayırır) */
export function useSocialStatus() {
  const [state, setState] = useState<
    { kind: "loading" } | { kind: "local" } | { kind: "disabled" } | { kind: "error"; msg: string } | { kind: "ready"; platforms: Record<Platform, PlatformStatus> }
  >({ kind: "loading" });

  const reload = useCallback(async () => {
    try {
      const s = await fetchSocialStatus();
      setState(s.enabled ? { kind: "ready", platforms: s.platforms } : { kind: "disabled" });
    } catch (e) {
      const code = (e as { code?: string }).code;
      setState(code === "NO_SERVER" ? { kind: "local" } : { kind: "error", msg: (e as Error).message });
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { state, reload };
}
