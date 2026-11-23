import { describe, expect, it } from "vitest";

import { buildReminders, clampHour, expoWeekday, REMINDER_PREFIX } from "../lib/reminders";

describe("reminders", () => {
  it("expoWeekday: Pzt=0..Paz=6 -> expo (Pazar=1, Pazartesi=2 ... Cumartesi=7)", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(expoWeekday)).toEqual([2, 3, 4, 5, 6, 7, 1]);
  });

  it("clampHour 0-23 aralığına sıkıştırır, geçersizde 9 döner", () => {
    expect(clampHour(-3)).toBe(0);
    expect(clampHour(30)).toBe(23);
    expect(clampHour(8.7)).toBe(9);
    expect(clampHour(NaN)).toBe(9);
  });

  it("içeriği olmayan günlere hatırlatma üretmez", () => {
    expect(buildReminders([])).toEqual([]);
  });

  it("gün başına tek hatırlatma: sayı başlıkta, içerik başlıkları gövdede", () => {
    const r = buildReminders(
      [
        { day: 0, title: "AI araçları videosu" },
        { day: 0, title: "Shorts denemesi" },
        { day: 4, title: "Haftalık özet" },
      ],
    );
    expect(r).toHaveLength(2);
    const mon = r.find((x) => x.weekday === 2)!;
    expect(mon.id).toBe(REMINDER_PREFIX + "0");
    expect(mon.title).toBe("Bugün 2 içerik planlı");
    expect(mon.body).toBe("AI araçları videosu; Shorts denemesi");
    const fri = r.find((x) => x.weekday === 6)!;
    expect(fri.title).toBe("Bugün 1 içerik planlı");
    expect(fri.body).toBe("Haftalık özet");
  });

  it("3'ten fazla içerikte ilk üçünü ve 'daha' sayısını yazar", () => {
    const events = ["a", "b", "c", "d", "e"].map((t) => ({ day: 2, title: t }));
    const r = buildReminders(events)[0];
    expect(r.body).toBe("a; b; c +2 daha");
  });

  it("boş başlıkları yok sayar", () => {
    expect(buildReminders([{ day: 1, title: "  " }])).toEqual([]);
  });
});
