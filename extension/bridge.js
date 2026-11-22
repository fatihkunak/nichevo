// Köprü: yalnızca Nichevo sayfalarında çalışır (manifest `matches`). Sayfa window.postMessage ile görev yollar,
// köprü bunu eklentinin arka planına iletir ve sonucu sayfaya geri verir. Başka hiçbir siteyle konuşmaz.
const VERSION = chrome.runtime.getManifest().version;
const post = (msg) => window.postMessage({ source: "nichevo-extension", ...msg }, window.location.origin);

let port = null;
const ensurePort = () => {
  if (port) return port;
  port = chrome.runtime.connect({ name: "nichevo" });
  port.onMessage.addListener((m) => {
    if (m?.type === "hb") return; // arka planı canlı tutan sinyal
    post(m);
  });
  port.onDisconnect.addListener(() => {
    port = null;
  });
  return port;
};

window.addEventListener("message", (e) => {
  // Yalnızca aynı pencereden (sayfanın kendisinden) gelen mesajlar
  if (e.source !== window || !e.data || e.data.source !== "nichevo-web") return;
  const m = e.data;
  if (m.type === "ping") return post({ type: "pong", version: VERSION });
  if (m.type === "task" && typeof m.id === "string") {
    try {
      ensurePort().postMessage({ type: "task", id: m.id, task: m.task });
    } catch (err) {
      post({ type: "result", id: m.id, ok: false, error: "Eklenti yanıt vermiyor. Sayfayı yenile." });
    }
  }
});

post({ type: "pong", version: VERSION }); // sayfa açılırken eklentinin var olduğunu duyur
