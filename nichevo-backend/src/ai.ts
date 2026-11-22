// Sunucu üzerinden EVREN LLM: API anahtarı YALNIZCA sunucuda (EVREN_API_KEY) durur, cihaza/istemciye hiç gönderilmez.
// Uygulama bu uç noktayla konuşur; anahtar girmesi gerekmez. Yalnızca izin listesindeki hesaplar kullanabilir
// (kota/ücret sunucu sahibine ait) ve kullanıcı başına saatlik sınır vardır.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

export interface AiConfig {
  apiKey: string;
  /** Varsayılan: https://evren-llmapi.ssyz.org.tr/v1 */
  baseUrl: string;
}

export interface AiRouteDeps {
  ai: AiConfig;
  allowedEmails: Set<string>;
  authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
  now?: () => number;
  /** Test için: gerçek ağ yerine sahte fetch */
  fetchImpl?: typeof fetch;
}

const TIMEOUT_MS = 90_000;
const MAX_TOKENS_CAP = 4096;
const HOURLY_LIMIT = 60;

const chatBody = z.object({
  system: z.string().max(12_000).default(""),
  messages: z
    .array(z.object({ role: z.enum(["user", "model"]), text: z.string().max(12_000) }))
    .min(1)
    .max(30),
  model: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/).optional(),
  maxTokens: z.number().int().min(1).max(MAX_TOKENS_CAP).optional(),
});

/** Üst servis hata gövdeleri anahtarı yansıtabilir; asla istemciye gösterme. */
const redact = (text: string, key: string) => (key.length >= 8 ? text.split(key).join("***") : text).slice(0, 200);

export function registerAiRoutes(app: FastifyInstance, deps: AiRouteDeps) {
  const { ai, allowedEmails, authenticate } = deps;
  const now = deps.now ?? Date.now;
  const doFetch = deps.fetchImpl ?? fetch;

  const hits = new Map<string, number[]>();
  const limited = (key: string) => {
    const t = now();
    const arr = (hits.get(key) ?? []).filter((x) => t - x < 3_600_000);
    arr.push(t);
    hits.set(key, arr);
    return arr.length > HOURLY_LIMIT;
  };

  const fail = (reply: FastifyReply, status: number, code: string, message: string) => reply.code(status).send({ error: { code, message } });
  const emailOf = (req: FastifyRequest) => String((req as FastifyRequest & { user?: { email: string } }).user?.email ?? "").toLowerCase();

  app.get("/v1/ai/status", { preHandler: authenticate }, async (req) => ({ enabled: allowedEmails.has(emailOf(req)), provider: "evren", defaultModel: "auto" }));

  app.post("/v1/ai/chat", { preHandler: authenticate, bodyLimit: 256 * 1024 }, async (req, reply) => {
    if (reply.sent) return;
    if (!allowedEmails.has(emailOf(req))) return fail(reply, 403, "AI_NOT_ALLOWED", "Sunucu yapay zekâsı bu hesap için açık değil.");
    const b = chatBody.parse(req.body);
    if (limited(`ai:${(req as any).user.id}`)) return fail(reply, 429, "RATE_LIMITED", "Saatlik yapay zekâ sınırına ulaştın.");

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const resp = await doFetch(`${ai.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": ai.apiKey },
        body: JSON.stringify({
          model: b.model ?? "auto",
          max_tokens: b.maxTokens ?? 2048,
          stream: false,
          messages: [
            ...(b.system ? [{ role: "system", content: b.system }] : []),
            ...b.messages.map((m) => ({ role: m.role === "model" ? "assistant" : "user", content: m.text })),
          ],
        }),
        signal: ctrl.signal,
      });
      const text = await resp.text();
      if (!resp.ok) return fail(reply, 502, "AI_UPSTREAM", `Yapay zekâ servisi ${resp.status} döndürdü: ${redact(text, ai.apiKey)}`);
      let json: any;
      try {
        json = JSON.parse(text);
      } catch {
        return fail(reply, 502, "AI_UPSTREAM", "Yapay zekâ servisi geçersiz yanıt verdi.");
      }
      const out: unknown = json?.choices?.[0]?.message?.content;
      if (typeof out !== "string" || !out.trim()) {
        const length = json?.choices?.[0]?.finish_reason === "length";
        return fail(reply, 502, "AI_EMPTY", length ? "Yanıt token sınırına takıldı (model önce düşünüyor olabilir)." : "Yapay zekâ boş yanıt verdi.");
      }
      return { text: out.trim(), model: typeof json?.model === "string" ? json.model.slice(0, 64) : b.model ?? "auto" };
    } catch (e) {
      if ((e as Error).name === "AbortError") return fail(reply, 504, "AI_TIMEOUT", "Yapay zekâ servisi zamanında yanıt vermedi.");
      return fail(reply, 502, "AI_UPSTREAM", `Yapay zekâ servisine ulaşılamadı: ${redact(String((e as Error).message), ai.apiKey)}`);
    } finally {
      clearTimeout(timer);
    }
  });
}
