// Arka plan: Nichevo'dan gelen görevi doğrular, görünür bir pencerede X'i açar, giriş duvarı çıkarsa kullanıcının
// girmesini bekler, sonra okuma betiğini enjekte eder ve ham sonucu geri yollar. YALNIZCA OKUR.
// Adres her zaman xTaskUrl ile BURADA üretilir; dışarıdan adres/betik kabul edilmez.
import { isLoginUrl, urlMatchesTask, validateTask, xTaskUrl } from "./generated/x-dom.js";

const READ_TIMEOUT_MS = 70_000; // sayfa yüklendikten sonra okuma için
const LOGIN_TIMEOUT_MS = 10 * 60_000; // kullanıcı giriş yaparken
const MAX_FIXES = 3;
const ALLOWED_ORIGINS = ["https://nichevo.fatihgo.com", "http://localhost:8081"];

let chain = Promise.resolve(); // aynı anda tek pencere

const safePost = (port, msg) => {
  try {
    port.postMessage(msg);
  } catch {
    // köprü kapanmış; sonuç yutulur
  }
};

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "nichevo") return;
  const origin = port.sender?.origin ?? "";
  if (!ALLOWED_ORIGINS.includes(origin)) return port.disconnect();
  // Nichevo sekmesi kapanırsa (port düşer) bekleyen ve çalışan görevler iptal edilir; pencere açık kalmaz
  const ctl = { closed: false, abort: null };
  port.onDisconnect.addListener(() => {
    ctl.closed = true;
    ctl.abort?.();
  });
  port.onMessage.addListener((msg) => {
    if (msg?.type !== "task" || typeof msg.id !== "string") return;
    const task = validateTask(msg.task);
    if (!task) return safePost(port, { type: "result", id: msg.id, ok: false, error: "Geçersiz görev." });
    chain = chain.then(() => (ctl.closed ? undefined : run(task, port, msg.id, ctl))).catch(() => undefined);
  });
});

async function run(task, port, id, ctl) {
  // Port mesajı servis çalışanını canlı tutar; uzun girişleri bekleyebilmek için düzenli sinyal
  const hb = setInterval(() => safePost(port, { type: "hb" }), 20_000);
  let windowId = null;
  try {
    const target = xTaskUrl(task);
    // Görünür pencere: arka plan sekmelerinde X sayfayı çizmeyebilir; ayrıca kullanıcı ne olduğunu görür
    const win = await chrome.windows.create({ url: target, type: "popup", width: 520, height: 820, focused: true });
    windowId = win.id;
    const tabId = win.tabs?.[0]?.id;
    if (tabId === undefined) throw new Error("X penceresi açılamadı.");
    const data = await drive(tabId, task, target, (phase) => safePost(port, { type: "phase", id, phase }), ctl);
    safePost(port, { type: "result", id, ok: true, data });
  } catch (e) {
    safePost(port, { type: "result", id, ok: false, error: String(e?.message ?? e) });
  } finally {
    clearInterval(hb);
    ctl.abort = null;
    if (windowId !== null) chrome.windows.remove(windowId).catch(() => undefined);
  }
}

function drive(tabId, task, target, onPhase, ctl) {
  return new Promise((resolve, reject) => {
    let injected = false;
    let fixes = 0;
    let lastUrl = "";
    let timer = null;

    const cleanup = () => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      chrome.runtime.onMessage.removeListener(onMessage);
    };
    const done = (err, data) => {
      cleanup();
      if (err) reject(err);
      else resolve(data);
    };
    const arm = (ms, msg) => {
      clearTimeout(timer);
      timer = setTimeout(() => done(new Error(msg)), ms);
    };

    const handle = async (url) => {
      if (!url || url === lastUrl) return;
      lastUrl = url;
      try {
        if (isLoginUrl(url)) {
          onPhase("login");
          injected = false;
          arm(LOGIN_TIMEOUT_MS, "Giriş zaman aşımına uğradı.");
          return;
        }
        if (urlMatchesTask(url, task)) {
          if (injected) return;
          injected = true;
          onPhase("reading");
          arm(READ_TIMEOUT_MS, "Sayfa zamanında okunamadı.");
          await chrome.scripting.executeScript({ target: { tabId }, files: [`generated/inject-${task.kind}.js`] });
          return;
        }
        // Giriş sonrası /home gibi başka bir sayfaya düştük: hedefe git (döngüye girmeden)
        if (fixes < MAX_FIXES) {
          fixes += 1;
          await chrome.tabs.update(tabId, { url: target });
        } else {
          done(new Error("X beklenen sayfayı açmadı. Giriş yaptığından emin olup tekrar dene."));
        }
      } catch (e) {
        done(e instanceof Error ? e : new Error(String(e)));
      }
    };

    const onUpdated = (id, info, tab) => {
      if (id !== tabId) return;
      if (info.url) void handle(info.url);
      else if (info.status === "complete" && tab.url) void handle(tab.url);
    };
    const onRemoved = (id) => {
      if (id === tabId) done(new Error("X penceresi kapatıldı."));
    };
    const onMessage = (msg, sender) => {
      if (msg?.type !== "nichevo-result" || sender.tab?.id !== tabId || typeof msg.data !== "string") return;
      try {
        done(null, JSON.parse(msg.data));
      } catch {
        done(new Error("Sayfadan gelen veri okunamadı."));
      }
    };

    ctl.abort = () => done(new Error("İptal edildi (Nichevo sekmesi kapandı)."));
    if (ctl.closed) return done(new Error("İptal edildi (Nichevo sekmesi kapandı)."));
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    chrome.runtime.onMessage.addListener(onMessage);
    arm(LOGIN_TIMEOUT_MS, "Zaman aşımı.");
    // Pencere hızlı açılırsa ilk URL olayı kaçmış olabilir: mevcut adresi de değerlendir
    chrome.tabs.get(tabId).then((t) => handle(t.url || t.pendingUrl), () => undefined);
  });
}
