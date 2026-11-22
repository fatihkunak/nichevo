// Web uygulaması ↔ "Nichevo X Okuyucu" tarayıcı eklentisi köprüsü (window.postMessage). Yalnızca web'de anlamlıdır;
// native'de `window` olmadığından her şey sessizce "yok" döner. Eklentiyi sayfa değil, kullanıcı kurar (extension/ klasörü).
import { XReadError, type XTask, type XTaskMessage } from "@/shared/x-dom";

const hasWindow = () => typeof window !== "undefined" && typeof window.addEventListener === "function" && typeof document !== "undefined";

type FromExtension =
  | { source: "nichevo-extension"; type: "pong"; version?: string }
  | { source: "nichevo-extension"; type: "phase"; id: string; phase: string }
  | { source: "nichevo-extension"; type: "result"; id: string; ok: boolean; data?: XTaskMessage; error?: string };

const toExt = (msg: Record<string, unknown>) => window.postMessage({ source: "nichevo-web", ...msg }, window.location.origin);

const fromExt = (e: MessageEvent): FromExtension | null =>
  e.source === window && e.data && e.data.source === "nichevo-extension" ? (e.data as FromExtension) : null;

/** Eklenti bu sayfada kurulu ve çalışıyor mu */
export function pingExtension(timeoutMs = 1200): Promise<boolean> {
  if (!hasWindow()) return Promise.resolve(false);
  return new Promise((resolve) => {
    const finish = (v: boolean) => {
      window.removeEventListener("message", on);
      clearTimeout(timer);
      resolve(v);
    };
    const on = (e: MessageEvent) => {
      if (fromExt(e)?.type === "pong") finish(true);
    };
    window.addEventListener("message", on);
    const timer = setTimeout(() => finish(false), timeoutMs);
    toExt({ type: "ping" });
  });
}

const OVERALL_TIMEOUT_MS = 11 * 60_000;

/** Görevi eklentiye yollar; eklenti X'i görünür bir pencerede açıp okur. Ham sayfa sonucunu döndürür. */
export function runViaExtension(task: XTask, onPhase?: (phase: string) => void): Promise<XTaskMessage> {
  if (!hasWindow()) return Promise.reject(new XReadError("FAILED", "Eklenti yalnızca web'de kullanılır."));
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return new Promise((resolve, reject) => {
    const finish = (fn: () => void) => {
      window.removeEventListener("message", on);
      clearTimeout(timer);
      fn();
    };
    const on = (e: MessageEvent) => {
      const m = fromExt(e);
      if (!m || m.type === "pong" || m.id !== id) return;
      if (m.type === "phase") return onPhase?.(m.phase);
      if (m.ok && m.data) finish(() => resolve(m.data!));
      else finish(() => reject(new XReadError("FAILED", m.error || "X okunamadı.")));
    };
    window.addEventListener("message", on);
    const timer = setTimeout(() => finish(() => reject(new XReadError("FAILED", "Zaman aşımı."))), OVERALL_TIMEOUT_MS);
    toExt({ type: "task", id, task });
  });
}
