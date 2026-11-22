// "Nichevo sunucusu" yapay zekâ sağlayıcısının taşıyıcısı: sohbet isteği Nichevo sunucusuna (oturumla yetkili) gider,
// sunucu EVREN LLM'e KENDİ anahtarıyla bağlanır. Cihaza anahtar girilmez/gelmez. Yalnızca izin listesindeki hesaplar kullanabilir.
import { ApiError, authedRequest } from "@/lib/api";
import { AiError, setServerTransport } from "@/lib/ai-providers";

setServerTransport({
  async chat(system, turns, model, maxTokens) {
    try {
      const r = await authedRequest<{ text: string }>("/v1/ai/chat", "POST", { system, messages: turns, model, maxTokens }, 100_000); // EVREN düşünen modeller 15-45 sn sürebilir
      return r.text;
    } catch (e) {
      if (e instanceof ApiError) throw new AiError("HTTP", e.message);
      throw e;
    }
  },
});
