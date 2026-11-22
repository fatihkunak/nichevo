// X'i telefonun KENDİ tarayıcısı (WebView) üzerinden okur: görünür bir pencere açılır, kullanıcı X'e kendi hesabıyla
// giriş yapar, uygulama sayfadaki gönderi/hesap bilgisini okur. Kimlik taklidi yok: gerçek bir mobil tarayıcı bileşeni,
// kullanıcının kendi oturumu, her şey ekranda görünür. Yalnızca OKUR (beğenme/takip/paylaşma yok).
// Web'de sayfa x.com'u doğrudan okuyamaz (tarayıcı güvenlik modeli); orada "Nichevo X Okuyucu" tarayıcı eklentisi
// (extension/) kullanılır, eklenti yoksa `available=false`.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Modal, Platform, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useColors } from "@/hooks/use-colors";
import { pingExtension, runViaExtension } from "@/lib/x-extension";
import {
  XReadError,
  buildWebViewScript,
  isLoginUrl,
  resultToData,
  urlMatchesTask,
  xTaskUrl,
  type XTask,
  type XTaskData,
  type XTaskMessage,
} from "@/shared/x-dom";

const isNative = Platform.OS !== "web";
// Web paketine WebView sızmasın
const WebViewImpl: any = isNative ? require("react-native-webview").WebView : null;

const LOGIN_URL = "https://x.com/i/flow/login";
const READ_TIMEOUT_MS = 70_000; // sayfa yüklendikten sonra okuma için
const LOGIN_TIMEOUT_MS = 10 * 60_000; // kullanıcı giriş yaparken
const MAX_REDIRECT_FIXES = 3;

type Job =
  | { type: "read"; task: XTask; resolve: (d: XTaskData) => void; reject: (e: Error) => void }
  | { type: "login"; resolve: () => void; reject: (e: Error) => void };

type Phase = "loading" | "login" | "reading";

export interface XReader {
  /** Bu cihazda kullanılabilir mi (yalnızca telefon uygulaması) */
  available: boolean;
  read(task: XTask): Promise<XTaskData>;
  /** Giriş penceresini açar; kullanıcı "Bitti"ye basınca çözülür */
  openLogin(): Promise<void>;
}

const Ctx = createContext<XReader>({
  available: false,
  read: () => Promise.reject(new XReadError("FAILED", "X taraması yalnızca telefon uygulamasında kendi tarayıcınla çalışır.")),
  openLogin: () => Promise.reject(new XReadError("FAILED", "X girişi yalnızca telefon uygulamasında yapılır.")),
});

export const useXReader = () => useContext(Ctx);


function NativeXReaderProvider({ children }: { children: React.ReactNode }) {
  const colors = useColors();
  const [job, setJob] = useState<Job | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const webRef = useRef<any>(null);
  const injected = useRef(false);
  const fixes = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const jobRef = useRef<Job | null>(null);
  const lastUrl = useRef("");

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const finish = useCallback((fn: (j: Job) => void) => {
    const j = jobRef.current;
    if (!j) return;
    clearTimer();
    jobRef.current = null;
    setJob(null);
    fn(j);
  }, []);

  const fail = useCallback(
    (msg: string) => finish((j) => j.reject(new XReadError("FAILED", msg))),
    [finish],
  );

  const arm = (ms: number, msg: string) => {
    clearTimer();
    timer.current = setTimeout(() => fail(msg), ms);
  };

  // İşler sırayla: aynı anda tek pencere
  const enqueue = useCallback(
    <T,>(make: (resolve: (v: T) => void, reject: (e: Error) => void) => Job): Promise<T> => {
      const run = () =>
        new Promise<T>((resolve, reject) => {
          const j = make(resolve, reject);
          injected.current = false;
          fixes.current = 0;
          lastUrl.current = "";
          jobRef.current = j;
          setPhase("loading");
          setJob(j);
          arm(LOGIN_TIMEOUT_MS, "Zaman aşımı.");
        });
      const p = chain.current.then(run, run);
      chain.current = p.catch(() => undefined);
      return p;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const value = useMemo<XReader>(
    () => ({
      available: isNative,
      read: (task) => enqueue<XTaskData>((resolve, reject) => ({ type: "read", task, resolve, reject })),
      openLogin: () => enqueue<void>((resolve, reject) => ({ type: "login", resolve, reject })),
    }),
    [enqueue],
  );

  // Hem tam sayfa yüklemesinde hem de X'in tek sayfalı uygulama içi adres değişimlerinde (giriş sonrası /home) çağrılır
  const handleUrl = (url: string) => {
    const j = jobRef.current;
    if (!j || j.type === "login" || !url || url === lastUrl.current) return;
    lastUrl.current = url;
    if (isLoginUrl(url)) {
      setPhase("login");
      arm(LOGIN_TIMEOUT_MS, "Giriş zaman aşımına uğradı.");
      injected.current = false;
      return;
    }
    if (urlMatchesTask(url, j.task)) {
      if (injected.current) return;
      injected.current = true;
      setPhase("reading");
      arm(READ_TIMEOUT_MS, "Sayfa zamanında okunamadı.");
      webRef.current?.injectJavaScript(buildWebViewScript(j.task));
      return;
    }
    // Giriş sonrası /home gibi başka bir sayfaya düştük: hedefe git (döngüye girmeden)
    if (fixes.current < MAX_REDIRECT_FIXES) {
      fixes.current += 1;
      webRef.current?.injectJavaScript(`window.location.href = ${JSON.stringify(xTaskUrl(j.task))}; true;`);
    } else {
      fail("X beklenen sayfayı açmadı. Giriş yaptığından emin olup tekrar dene.");
    }
  };

  const onMessage = (e: { nativeEvent: { data: string } }) => {
    const j = jobRef.current;
    if (!j || j.type !== "read") return;
    let msg: XTaskMessage;
    try {
      msg = JSON.parse(e.nativeEvent.data) as XTaskMessage;
    } catch {
      return;
    }
    if (msg.type !== "result" && msg.type !== "error") return;
    try {
      const data = resultToData(j.task, msg);
      finish((jj) => jj.type === "read" && jj.resolve(data));
    } catch (err) {
      finish((jj) => jj.reject(err as Error));
    }
  };

  const title =
    job?.type === "login"
      ? "X'e giriş yap"
      : phase === "login"
        ? "X'e giriş yap, sonra kendiliğinden devam eder"
        : phase === "reading"
          ? "X okunuyor…"
          : "X açılıyor…";

  return (
    <Ctx.Provider value={value}>
      {children}
      {isNative && job ? (
        <Modal visible animationType="slide" onRequestClose={() => fail("İptal edildi.")}>
          <SafeAreaView style={{ flex: 1, backgroundColor: "#12062A" }}>
            <View style={{ flexDirection: "row", alignItems: "center", padding: 12 }}>
              <Text style={{ color: colors.foreground, flex: 1, fontWeight: "600" }}>{title}</Text>
              {phase === "reading" ? <ActivityIndicator style={{ marginRight: 12 }} /> : null}
              {job.type === "login" ? (
                <Pressable onPress={() => finish((j) => j.type === "login" && j.resolve())} accessibilityLabel="Bitti">
                  <Text style={{ color: colors.info, fontWeight: "700" }}>Bitti</Text>
                </Pressable>
              ) : null}
              <Pressable onPress={() => fail("İptal edildi.")} accessibilityLabel="İptal" style={{ marginLeft: 16 }}>
                <Text style={{ color: colors.muted }}>İptal</Text>
              </Pressable>
            </View>
            <Text style={{ color: colors.muted, fontSize: 11, paddingHorizontal: 12, paddingBottom: 8 }}>
              Burada kendi X hesabınla giriş yaparsın (şifre bu uygulamaya gelmez). Nichevo yalnızca sayfayı okur: beğenme, takip, paylaşma yok.
            </Text>
            <WebViewImpl
              ref={webRef}
              source={{ uri: job.type === "login" ? LOGIN_URL : xTaskUrl(job.task) }}
              onLoadEnd={(e: { nativeEvent: { url: string } }) => handleUrl(e.nativeEvent.url)}
              onNavigationStateChange={(n: { url: string; loading: boolean }) => !n.loading && handleUrl(n.url)}
              onMessage={onMessage}
              onError={() => fail("X sayfası açılamadı. Bağlantını kontrol edip tekrar dene.")}
              javaScriptEnabled
              domStorageEnabled
              sharedCookiesEnabled
              thirdPartyCookiesEnabled
              setSupportMultipleWindows={false}
              style={{ flex: 1, backgroundColor: "#000" }}
            />
          </SafeAreaView>
        </Modal>
      ) : null}
    </Ctx.Provider>
  );
}

const PHASE_LABEL: Record<string, string> = {
  login: "açılan pencerede X'e giriş yap, sonra kendiliğinden devam eder",
  reading: "okunuyor…",
};

/** Web: okuma, kullanıcının tarayıcısındaki "Nichevo X Okuyucu" eklentisiyle yapılır (eklenti X'i görünür bir pencerede açar). */
function WebXReaderProvider({ children }: { children: React.ReactNode }) {
  const colors = useColors();
  const [ready, setReady] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const chain = useRef<Promise<unknown>>(Promise.resolve());

  // Eklenti sayfa açılırken geç yüklenebilir: birkaç kez yokla
  useEffect(() => {
    let alive = true;
    let tries = 0;
    const tick = async () => {
      if (!alive) return;
      if (await pingExtension(700)) return setReady(true);
      if (++tries < 10) setTimeout(tick, 1500);
    };
    void tick();
    return () => {
      alive = false;
    };
  }, []);

  const value = useMemo<XReader>(
    () => ({
      available: ready,
      read: (task) => {
        const run = async () => {
          setPhase("starting");
          try {
            return resultToData(task, await runViaExtension(task, setPhase));
          } finally {
            setPhase(null);
          }
        };
        const p = chain.current.then(run, run);
        chain.current = p.catch(() => undefined);
        return p;
      },
      // Web'de giriş, eklentinin açtığı pencerede gerekirse kendiliğinden istenir; elle girmek için X'i aç
      openLogin: async () => {
        window.open("https://x.com/i/flow/login", "_blank", "noopener");
      },
    }),
    [ready],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {phase ? (
        <View
          pointerEvents="none"
          style={{ position: "absolute", top: 8, left: 8, right: 8, padding: 10, borderRadius: 12, backgroundColor: "rgba(26,14,54,0.96)", borderWidth: 1, borderColor: colors.border }}
        >
          <Text style={{ color: colors.foreground, fontSize: 12 }}>X {PHASE_LABEL[phase] ?? "açılıyor…"}</Text>
        </View>
      ) : null}
    </Ctx.Provider>
  );
}

export const XReaderProvider = isNative ? NativeXReaderProvider : WebXReaderProvider;
