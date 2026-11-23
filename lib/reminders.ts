// Planlama hatırlatmaları: saf mantık (React Native'e bağımlı değil), vitest ile test edilir.

export const REMINDER_PREFIX = "nichevo-plan-";
export const DEFAULT_REMINDER_HOUR = 9;

export interface PlanEventLite {
  day: number; // Pzt=0 .. Paz=6
  title: string;
}

export interface ReminderSpec {
  id: string;
  weekday: number; // expo-notifications: Pazar=1 .. Cumartesi=7
  title: string;
  body: string;
}

/** Pzt=0..Paz=6 -> expo-notifications haftanın günü (Pazar=1 .. Cumartesi=7). */
export function expoWeekday(day: number): number {
  return ((day + 1) % 7) + 1;
}

export function clampHour(h: number): number {
  if (!Number.isFinite(h)) return DEFAULT_REMINDER_HOUR;
  return Math.min(23, Math.max(0, Math.round(h)));
}

/** İçeriği olan her gün için bir haftalık hatırlatma üretir. */
export function buildReminders(events: PlanEventLite[]): ReminderSpec[] {
  const out: ReminderSpec[] = [];
  for (let day = 0; day < 7; day++) {
    const titles = events.filter((e) => e.day === day).map((e) => e.title.trim()).filter(Boolean);
    if (titles.length === 0) continue;
    const shown = titles.slice(0, 3).join("; ");
    out.push({
      id: REMINDER_PREFIX + day,
      weekday: expoWeekday(day),
      title: `Bugün ${titles.length} içerik planlı`,
      body: titles.length > 3 ? `${shown} +${titles.length - 3} daha` : shown,
    });
  }
  return out;
}
