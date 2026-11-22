import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";

import { Card, Chip, GradientButton, ScreenHeader } from "@/components/nv";
import { ConnectionView, SearchView, TrendView, WatchView, useSocialStatus } from "@/components/social-views";
import { ScreenContainer } from "@/components/screen-container";

type Tab = "search" | "watch" | "trend" | "connect";

export default function SocialScreen() {
  const { state, reload } = useSocialStatus();
  const [tab, setTab] = useState<Tab>("search");
  const [watchKey, setWatchKey] = useState(0);

  // Sekmeye her dönüşte yetki/bağlantı durumunu yenile (izin listesi ya da oturum değişmiş olabilir)
  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  return (
    <ScreenContainer className="px-4 pt-2">
      <ScreenHeader title="Sosyal Tarama" />
      {state.kind === "loading" ? <ActivityIndicator style={{ marginTop: 24 }} /> : null}

      {state.kind === "local" ? (
        <Card title="Sunucu gerekli">
          <Text className="text-muted text-[12px]">X ve Instagram taraması Nichevo sunucusunda çalışır. Bu sürümde sunucu adresi tanımlı olmadığı için kullanılamıyor.</Text>
        </Card>
      ) : null}

      {state.kind === "disabled" ? (
        <Card title="Bu hesap için kapalı">
          <Text className="text-muted text-[12px]">Sosyal tarama, sunucu makinesindeki bir test hesabı oturumunu kullandığı için yalnızca izin verilen hesaplara açık.</Text>
        </Card>
      ) : null}

      {state.kind === "error" ? (
        <Card title="Bağlanılamadı">
          <Text className="text-muted text-[12px] mb-2">{state.msg}</Text>
          <GradientButton small title="Tekrar dene" onPress={reload} />
        </Card>
      ) : null}

      {state.kind === "ready" ? (
        <>
          <View className="flex-row flex-wrap mb-1">
            <Chip label="Ara" active={tab === "search"} onPress={() => setTab("search")} />
            <Chip label="Takip" active={tab === "watch"} onPress={() => setTab("watch")} />
            <Chip label="Trend" active={tab === "trend"} onPress={() => setTab("trend")} />
            <Chip label="Bağlantı" active={tab === "connect"} onPress={() => setTab("connect")} />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 24 }}>
            {tab === "search" ? <SearchView onWatched={() => setWatchKey((k) => k + 1)} /> : null}
            {tab === "watch" ? <WatchView reloadKey={watchKey} /> : null}
            {tab === "trend" ? <TrendView /> : null}
            {tab === "connect" ? <ConnectionView platforms={state.platforms} onChanged={reload} /> : null}
          </ScrollView>
        </>
      ) : null}
    </ScreenContainer>
  );
}
