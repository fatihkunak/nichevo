import { describe, expect, it } from "vitest";

import { addCompetitor, formatAgo, isNewVideo, markSeen, MAX_COMPETITORS, removeCompetitor, type Competitor } from "../lib/competitors";

const c = (n: number, extra: Partial<Competitor> = {}): Competitor => ({
  id: "UC" + String(n).padStart(22, "0"),
  title: "Kanal " + n,
  lastSeenVideoId: null,
  ...extra,
});

describe("competitors", () => {
  it("ekler, aynı kanalı ikinci kez eklemez", () => {
    const a = addCompetitor([], c(1));
    expect(a.ok).toBe(true);
    const b = addCompetitor(a.list, c(1));
    expect(b).toMatchObject({ ok: false, reason: "duplicate" });
    expect(b.list).toHaveLength(1);
  });

  it(`en fazla ${MAX_COMPETITORS} kanal tutar`, () => {
    let list: Competitor[] = [];
    for (let i = 1; i <= MAX_COMPETITORS; i++) list = addCompetitor(list, c(i)).list;
    const r = addCompetitor(list, c(99));
    expect(r).toMatchObject({ ok: false, reason: "full" });
    expect(r.list).toHaveLength(MAX_COMPETITORS);
  });

  it("siler ve girdiyi değiştirmez", () => {
    const list = [c(1), c(2)];
    const out = removeCompetitor(list, c(1).id);
    expect(out.map((x) => x.id)).toEqual([c(2).id]);
    expect(list).toHaveLength(2);
  });

  it("markSeen yalnız hedef kanalın son görülen videosunu günceller", () => {
    const out = markSeen([c(1), c(2)], c(2).id, "vid9");
    expect(out[0].lastSeenVideoId).toBeNull();
    expect(out[1].lastSeenVideoId).toBe("vid9");
  });

  it("isNewVideo: ilk eklemede (görülen yok) yeni sayılmaz, farklı video yeni sayılır", () => {
    expect(isNewVideo(c(1), "vidA")).toBe(false); // temel çizgi henüz kurulmadı
    expect(isNewVideo(c(1, { lastSeenVideoId: "vidA" }), "vidA")).toBe(false);
    expect(isNewVideo(c(1, { lastSeenVideoId: "vidA" }), "vidB")).toBe(true);
    expect(isNewVideo(c(1, { lastSeenVideoId: "vidA" }), null)).toBe(false);
  });

  it("formatAgo Türkçe göreli süre verir", () => {
    const now = Date.UTC(2026, 10, 23, 12, 0, 0);
    const ago = (ms: number) => new Date(now - ms).toISOString();
    expect(formatAgo(ago(30 * 60_000), now)).toBe("az önce");
    expect(formatAgo(ago(5 * 3_600_000), now)).toBe("5 saat önce");
    expect(formatAgo(ago(3 * 86_400_000), now)).toBe("3 gün önce");
    expect(formatAgo(ago(45 * 86_400_000), now)).toBe("1 ay önce");
    expect(formatAgo("bozuk", now)).toBe("");
  });
});
