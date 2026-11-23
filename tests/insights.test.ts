import { describe, expect, it } from "vitest";

import { channelHealth, channelScore, forecastViews, formatCount, formatMultiple, sentiment, topKeywords, topPhrases } from "../lib/insights";

describe("insights", () => {
  it("formatCount kısaltır", () => {
    expect(formatCount(999)).toBe("999");
    expect(formatCount(1500)).toBe("1.5K");
    expect(formatCount(2_000_000)).toBe("2M");
    expect(formatCount(1_827_500_000)).toBe("1.8B");
    expect(formatCount(19_488_400)).toBe("19.5M");
  });

  it("channelScore 0-100 aralığında kalır ve videosuz kanalda 0 döner", () => {
    expect(channelScore({ subs: 100, views: 0, videos: 0 })).toBe(0);
    const big = channelScore({ subs: 50_000_000, views: 5e10, videos: 1000 });
    expect(big).toBeLessThanOrEqual(100);
    expect(big).toBeGreaterThan(90);
    const small = channelScore({ subs: 100, views: 5000, videos: 10 });
    expect(small).toBeLessThan(big);
  });

  it("forecastViews artan, 6 elemanlı seri üretir", () => {
    const f = forecastViews(1000, 5);
    expect(f).toHaveLength(6);
    expect(f[0]).toBe(1000);
    for (let i = 1; i < f.length; i++) expect(f[i]).toBeGreaterThan(f[i - 1]);
  });

  it("sentiment yüzdeleri 100'e tamamlanır", () => {
    const s = sentiment(["harika video", "çok kötü", "ilk", "great stuff", "boring"]);
    expect(s.positive + s.neutral + s.negative).toBe(100);
    expect(s.positive).toBe(40);
    expect(s.negative).toBe(40);
    expect(sentiment([])).toEqual({ positive: 0, neutral: 100, negative: 0 });
  });

  it("topKeywords sık geçen kelimeleri sıralar, kısa/stop kelimeleri atar", () => {
    const k = topKeywords(["yapay zeka ve yapay zeka araçları", "zeka the a"]);
    expect(k[0]).toEqual({ word: "zeka", count: 3 });
    expect(k[1]).toEqual({ word: "yapay", count: 2 });
    expect(k.find((x) => x.word === "ve" || x.word === "the")).toBeUndefined();
  });

  it("formatMultiple oranı kat olarak yazar", () => {
    expect(formatMultiple(48)).toBe("0.5×");
    expect(formatMultiple(300)).toBe("3×");
    expect(formatMultiple(3_045_168.1)).toBe("30.5K×");
  });

  it("topPhrases tam etiketleri sayar, genel/kısa olanları atar", () => {
    const p = topPhrases(["minecraft", "Minecraft", "official", "gta", "yapay zeka", "2026", "fragman", "yapay zeka"], 3);
    expect(p).toEqual(["Minecraft", "Yapay zeka", "Fragman"]);
  });

  describe("channelHealth", () => {
    const day = 86_400_000;
    const base = Date.UTC(2026, 10, 1);
    const v = (i: number, views: number, likes = 0, comments = 0) => ({
      id: "v" + i,
      title: "Video " + i,
      views,
      likes,
      comments,
      publishedAt: new Date(base - i * 3 * day).toISOString(), // i=0 en yeni, 3 günde bir
    });

    it("video yoksa null döner", () => {
      expect(channelHealth([], 1000)).toBeNull();
    });

    it("ortalama, medyan, en iyi video ve aboneye oranı hesaplar", () => {
      const h = channelHealth([v(0, 100), v(1, 300), v(2, 200)], 1000)!;
      expect(h.avgViews).toBe(200);
      expect(h.medianViews).toBe(200);
      expect(h.best).toEqual({ title: "Video 1", views: 300 });
      expect(h.viewsPerSubPct).toBeCloseTo(20, 5);
    });

    it("yükleme sıklığını ayda kaç video olarak verir", () => {
      // 3 video, 3 günde bir: aralık 6 gün, 2 aralık -> 30/3 = 10 video/ay
      const h = channelHealth([v(0, 10), v(1, 10), v(2, 10)], 100)!;
      expect(h.uploadsPerMonth).toBeCloseTo(10, 5);
    });

    it("tek videoda sıklık ve eğilim null olur", () => {
      const h = channelHealth([v(0, 50)], 100)!;
      expect(h.uploadsPerMonth).toBeNull();
      expect(h.trendPct).toBeNull();
    });

    it("son yarıyı önceki yarıyla karşılaştırır (eğilim yüzdesi)", () => {
      // yeniler 200, eskiler 100 -> +100%
      const h = channelHealth([v(0, 200), v(1, 200), v(2, 100), v(3, 100)], 1000)!;
      expect(h.trendPct).toBeCloseTo(100, 5);
      const down = channelHealth([v(0, 50), v(1, 50), v(2, 100), v(3, 100)], 1000)!;
      expect(down.trendPct).toBeCloseTo(-50, 5);
    });

    it("etkileşim oranı (beğeni+yorum)/görüntülenme", () => {
      const h = channelHealth([v(0, 1000, 40, 10), v(1, 1000, 30, 20)], 500)!;
      expect(h.engagementPct).toBeCloseTo(5, 5);
    });

    it("aboneler gizliyse (0) aboneye oranı 0 olur, bölme hatası vermez", () => {
      const h = channelHealth([v(0, 100)], 0)!;
      expect(h.viewsPerSubPct).toBe(0);
    });

    it("sırasız gelen videoları tarihe göre sıralar", () => {
      const h = channelHealth([v(3, 100), v(0, 200), v(2, 100), v(1, 200)], 1000)!;
      expect(h.trendPct).toBeCloseTo(100, 5);
    });
  });
});
