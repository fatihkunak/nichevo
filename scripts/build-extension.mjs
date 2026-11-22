// Tarayıcı eklentisinin (extension/) üretilen dosyalarını oluşturur: seçiciler ve okuma betikleri shared/x-dom.ts'ten
// gelir (tek kaynak). Çalıştır: node scripts/build-extension.mjs   (npm run build:extension)
// Çıktı `extension/generated/` altındadır ve repoya girer, böylece eklenti derleme olmadan "paketlenmemiş olarak yüklenebilir".
import { build } from "esbuild";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "extension", "generated");
mkdirSync(out, { recursive: true });

// 1) Arka plan betiğinin kullandığı ortak işlevler (ES modülü)
await build({
  entryPoints: [join(root, "shared", "x-dom.ts")],
  outfile: join(out, "x-dom.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "chrome120",
  legalComments: "none",
});

// 2) Sayfaya enjekte edilen okuma betikleri: WebView'deki `ReactNativeWebView.postMessage` yerine eklenti mesajı kullanır.
// Betik görev türüne göre üretilir (arama sorgusu betikte yok; sayfa adresi zaten sorguyu taşır).
const bundled = await build({
  entryPoints: [join(root, "shared", "x-dom.ts")],
  write: false,
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node20",
});
const mod = { exports: {} };
new Function("module", "exports", bundled.outputFiles[0].text)(mod, mod.exports);
const { buildWebViewScript } = mod.exports;

const STUB = `window.ReactNativeWebView = { postMessage: (m) => chrome.runtime.sendMessage({ type: "nichevo-result", data: m }) };\n`;
for (const [name, task] of [
  ["posts", { kind: "posts", q: "x", mode: "top" }],
  ["accounts", { kind: "accounts", q: "x" }],
  ["profile", { kind: "profile", handle: "x" }],
]) {
  writeFileSync(join(out, `inject-${name}.js`), `// ÜRETİLDİ: node scripts/build-extension.mjs (kaynak: shared/x-dom.ts). Elle düzenleme.\n${STUB}${buildWebViewScript(task)}\n`);
}
console.log("extension/generated güncellendi");
