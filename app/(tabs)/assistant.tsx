import { useEffect, useMemo, useRef, useState } from "react";
import { FlatList, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from "react-native";

import { Chip, ScreenHeader } from "@/components/nv";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { ASSISTANT_SYSTEM, aiChat, aiStatus, type ChatTurn } from "@/lib/ai";
import { buildChannelSystem } from "@/lib/channel-context";
import { channelHealth, type RecentVideo } from "@/lib/insights";
import { useSession } from "@/lib/session";
import { loadSocialDigest } from "@/lib/social";
import { buildSocialSystem } from "@/lib/social-format";
import { bumpUsage } from "@/lib/usage";
import { loadYoutubeApiKey } from "@/lib/youtube-api";
import { fetchChannelInfo, fetchRecentVideos, type ChannelInfo } from "@/lib/youtube-extras";

const QUICK = [
  "Bu video için başlık önerir misin?",
  "En iyi yayınlama zamanı ne?",
  "Nişimi nasıl büyütürüm?",
];

// Sosyal veri (Sosyal sekmesindeki takip listesi + trendler) varsa gösterilen ek sorular
const SOCIAL_QUICK = [
  "Takip ettiğim hesaplar son zamanlarda ne paylaşmış?",
  "Bu verilere göre hangi hashtag'leri kullanmalıyım?",
];

// Bağlı kanal verisi varsa gösterilen ek soru
const CHANNEL_QUICK = ["Son videolarım nasıl gidiyor?"];

// Modeller Markdown döndürür; düz Text bileşeni için işaretleri temizle
const plain = (s: string) =>
  s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/^#{1,6}\s+/gm, "").replace(/`([^`]+)`/g, "$1");

export default function AssistantScreen() {
  const colors = useColors();
  const { profile } = useSession();
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef<FlatList<ChatTurn>>(null);
  // Sosyal veri: sunucuda takip/trend verisi varsa asistan onu okuyabilir (kapatılabilir)
  const [hasSocial, setHasSocial] = useState(false);
  const [socialOn, setSocialOn] = useState(true);
  // Kanal verisi: profilde kanal bağlıysa son videolar asistana bağlam olur (kapatılabilir)
  const [channel, setChannel] = useState<ChannelInfo | null>(null);
  const [recent, setRecent] = useState<RecentVideo[]>([]);
  const [channelOn, setChannelOn] = useState(true);
  const channelInput = useMemo(
    () => (channel ? { channel, recent, health: channelHealth(recent, channel.subs) } : null),
    [channel, recent],
  );

  useEffect(() => {
    if (!profile?.channelId) return;
    let alive = true;
    (async () => {
      try {
        const key = await loadYoutubeApiKey();
        const c = await fetchChannelInfo(profile.channelId, key);
        if (!alive || !c) return;
        setChannel(c);
        const r = await fetchRecentVideos(c.id, key, 10);
        if (alive) setRecent(r);
      } catch {}
    })();
    return () => {
      alive = false;
    };
  }, [profile?.channelId]);

  useEffect(() => {
    let alive = true;
    loadSocialDigest(true).then((d) => alive && setHasSocial(!!d));
    return () => {
      alive = false;
    };
  }, []);

  const send = async (msg: string) => {
    const content = msg.trim();
    if (!content || busy) return;
    const next: ChatTurn[] = [...turns, { role: "user", text: content }];
    setTurns(next);
    setText("");
    const st = await aiStatus();
    if (!st.creds) {
      setTurns([
        ...next,
        { role: "model", text: `${st.reason} Profil > Yapay Zeka bölümünden sağlayıcı seçip API anahtarı girin.` },
      ]);
      return;
    }
    setBusy(true);
    try {
      const digest = socialOn ? await loadSocialDigest() : null;
      const system = buildSocialSystem(buildChannelSystem(ASSISTANT_SYSTEM, channelOn ? channelInput : null), digest);
      const reply = await aiChat(system, next);
      setTurns([...next, { role: "model", text: reply }]);
      bumpUsage("chats");
    } catch (e) {
      setTurns([...next, { role: "model", text: "Hata: " + (e as Error).message }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScreenContainer className="px-4 pt-2">
      <ScreenHeader title="Yapay Zeka Asistanı" />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={80}
      >
        <FlatList
          ref={listRef}
          data={turns}
          keyExtractor={(_, i) => String(i)}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          ListHeaderComponent={
            turns.length === 0 ? (
              <View className="mb-2">
                <Text className="text-muted text-[12px] mb-2">Hızlı sorular</Text>
                <View className="flex-row flex-wrap">
                  {[...QUICK, ...(channelInput && channelOn ? CHANNEL_QUICK : []), ...(hasSocial && socialOn ? SOCIAL_QUICK : [])].map((q) => (
                    <Chip key={q} label={q} onPress={() => send(q)} />
                  ))}
                </View>
                {hasSocial || channelInput ? (
                  <View className="flex-row flex-wrap mt-1">
                    {hasSocial ? (
                      <Chip label={socialOn ? "Sosyal veri: açık" : "Sosyal veri: kapalı"} active={socialOn} onPress={() => setSocialOn((v) => !v)} />
                    ) : null}
                    {channelInput ? (
                      <Chip label={channelOn ? "Kanal verisi: açık" : "Kanal verisi: kapalı"} active={channelOn} onPress={() => setChannelOn((v) => !v)} />
                    ) : null}
                  </View>
                ) : null}
              </View>
            ) : undefined
          }
          renderItem={({ item }) => (
            <View
              className="mb-2 px-3 py-2 rounded-2xl"
              style={{
                alignSelf: item.role === "user" ? "flex-end" : "flex-start",
                maxWidth: "85%",
                backgroundColor: item.role === "user" ? "#7C3AED" : "rgba(26,14,54,0.95)",
                borderWidth: item.role === "user" ? 0 : 1,
                borderColor: colors.border,
              }}
            >
              <Text className="text-foreground text-[14px]">{item.role === "model" ? plain(item.text) : item.text}</Text>
            </View>
          )}
          ListFooterComponent={busy ? <Text className="text-muted text-[12px] mb-2">Yazıyor…</Text> : undefined}
        />
        <View
          className="flex-row items-center rounded-full border px-3 mb-2"
          style={{ borderColor: colors.border, backgroundColor: "rgba(13,6,32,0.85)" }}
        >
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Nichevo AI'a sorun..."
            placeholderTextColor={colors.muted}
            className="flex-1 text-foreground"
            style={{ paddingVertical: 10 }}
            onSubmitEditing={() => send(text)}
            returnKeyType="send"
          />
          <Pressable
            onPress={() => send(text)}
            disabled={busy || !text.trim()}
            accessibilityLabel="Gönder"
            style={{ opacity: busy || !text.trim() ? 0.4 : 1 }}
          >
            <Text style={{ color: colors.info, fontWeight: "700" }}>Gönder</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}
