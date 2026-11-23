import { useCallback, useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { Card, GradientButton } from "@/components/nv";
import { useColors } from "@/hooks/use-colors";
import { dropSnapshot, loadCompetitors, loadSnapshot, saveCompetitors, type CompetitorSnapshot } from "@/lib/competitor-store";
import {
  MAX_COMPETITORS,
  addCompetitor,
  formatAgo,
  isNewVideo,
  markSeen,
  removeCompetitor,
  type Competitor,
} from "@/lib/competitors";
import { formatCount } from "@/lib/insights";
import { loadYoutubeApiKey } from "@/lib/youtube-api";
import { fetchChannelInfo } from "@/lib/youtube-extras";

export function CompetitorsCard() {
  const colors = useColors();
  const [list, setList] = useState<Competitor[]>([]);
  const [snaps, setSnaps] = useState<Record<string, CompetitorSnapshot>>({});
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const refresh = useCallback(async (items: Competitor[]) => {
    const key = await loadYoutubeApiKey();
    if (!key || items.length === 0) return;
    const out: Record<string, CompetitorSnapshot> = {};
    await Promise.all(
      items.map(async (c) => {
        try {
          out[c.id] = (await loadSnapshot(c.id, key)).value;
        } catch {}
      }),
    );
    setSnaps((prev) => ({ ...prev, ...out }));
  }, []);

  useEffect(() => {
    let alive = true;
    loadCompetitors().then((l) => {
      if (!alive) return;
      setList(l);
      refresh(l);
    });
    return () => {
      alive = false;
    };
  }, [refresh]);

  const persist = (next: Competitor[]) => {
    setList(next);
    saveCompetitors(next);
  };

  const add = async () => {
    const q = input.trim();
    if (!q || busy) return;
    setBusy(true);
    setNote("");
    try {
      const key = await loadYoutubeApiKey();
      if (!key) {
        setNote("Önce Profil'den YouTube API anahtarı ekleyin.");
        return;
      }
      const info = await fetchChannelInfo(q, key);
      if (!info) {
        setNote("Kanal bulunamadı. @kullanıcıadı, kanal bağlantısı ya da UC… kimliği girin.");
        return;
      }
      // Temel çizgi: eklendiği andaki en yeni video "görülmüş" sayılır; sonrası YENİ olur
      const snap = (await loadSnapshot(info.id, key, true)).value;
      const res = addCompetitor(list, { id: info.id, title: info.title, lastSeenVideoId: snap.newest?.id ?? null });
      if (!res.ok) {
        setNote(res.reason === "duplicate" ? "Bu kanal zaten ekli." : `En fazla ${MAX_COMPETITORS} rakip eklenebilir.`);
        return;
      }
      persist(res.list);
      setSnaps((p) => ({ ...p, [info.id]: snap }));
      setInput("");
    } catch (e) {
      setNote("Eklenemedi: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = (id: string) => {
    persist(removeCompetitor(list, id));
    setSnaps((p) => {
      const rest = { ...p };
      delete rest[id];
      return rest;
    });
    dropSnapshot(id);
  };

  return (
    <Card title="Rakip Kanallar" hint={`${list.length}/${MAX_COMPETITORS}`}>
      {list.length === 0 ? (
        <Text className="text-muted text-[12px]">
          Takip etmek istediğiniz kanalları ekleyin; yeni video yüklediklerinde burada YENİ rozeti görünür (uygulamayı
          açtığınızda kontrol edilir).
        </Text>
      ) : null}
      {list.map((c) => {
        const s = snaps[c.id];
        const isNew = s ? isNewVideo(c, s.newest?.id ?? null) : false;
        return (
          <Pressable
            key={c.id}
            onPress={() => s?.newest && persist(markSeen(list, c.id, s.newest.id))}
            className="py-2 border-b border-border"
            accessibilityLabel={`${c.title} rakip kanalı`}
          >
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center flex-1 pr-2">
                <Text className="text-foreground text-[13px] font-semibold" numberOfLines={1} style={{ flexShrink: 1 }}>
                  {c.title}
                </Text>
                {isNew ? (
                  <Text
                    style={{
                      color: "#fff",
                      backgroundColor: "#D946EF",
                      fontSize: 9,
                      fontWeight: "700",
                      borderRadius: 6,
                      paddingHorizontal: 5,
                      paddingVertical: 1,
                      marginLeft: 6,
                    }}
                  >
                    YENİ
                  </Text>
                ) : null}
              </View>
              <Pressable onPress={() => remove(c.id)} accessibilityLabel={`${c.title} kanalını sil`}>
                <Text style={{ color: colors.error, fontSize: 12 }}>Sil</Text>
              </Pressable>
            </View>
            {s ? (
              <>
                <Text className="text-muted text-[11px]">{formatCount(s.subs)} abone</Text>
                {s.newest ? (
                  <Text className="text-muted text-[11px]" numberOfLines={1}>
                    Son: {s.newest.title} · {formatAgo(s.newest.publishedAt)} · {formatCount(s.newest.views)} görüntülenme
                  </Text>
                ) : (
                  <Text className="text-muted text-[11px]">Video bulunamadı</Text>
                )}
              </>
            ) : (
              <Text className="text-muted text-[11px]">Yükleniyor…</Text>
            )}
          </Pressable>
        );
      })}
      <View className="flex-row items-center mt-3">
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="@kanal ya da bağlantı"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          onSubmitEditing={add}
          className="flex-1 text-foreground border border-border rounded-xl px-3 mr-2"
          style={{ paddingVertical: 8, backgroundColor: "rgba(13,6,32,0.7)" }}
        />
        <GradientButton title="Ekle" small onPress={add} loading={busy} disabled={list.length >= MAX_COMPETITORS} />
      </View>
      {note ? <Text className="text-warning text-[11px] mt-2">{note}</Text> : null}
    </Card>
  );
}
