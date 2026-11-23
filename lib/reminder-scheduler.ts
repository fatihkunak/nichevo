// Planlama hatırlatmalarını cihaza (yerel, haftalık bildirim) yazar. Saf mantık: lib/reminders.ts.
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { buildReminders, clampHour, DEFAULT_REMINDER_HOUR, REMINDER_PREFIX, type PlanEventLite } from "@/lib/reminders";

const KEY = "nichevo.planner.remind";
const CHANNEL = "plan";

export interface RemindSettings {
  on: boolean;
  hour: number;
}

export type SyncResult = { ok: true; scheduled: number } | { ok: false; reason: "permission" | "error" };

// Uygulama açıkken de bildirim görünsün
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export async function loadRemind(): Promise<RemindSettings> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) {
      const o = JSON.parse(raw) as Partial<RemindSettings>;
      return { on: o.on === true, hour: clampHour(o.hour ?? DEFAULT_REMINDER_HOUR) };
    }
  } catch {}
  return { on: false, hour: DEFAULT_REMINDER_HOUR };
}

export async function saveRemind(s: RemindSettings): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(s)).catch(() => {});
}

async function cancelOurs(): Promise<void> {
  const all = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    all
      .filter((n) => n.identifier.startsWith(REMINDER_PREFIX))
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
  );
}

/** Önce bizim hatırlatmaları siler, sonra (açıksa) takvime göre yeniden kurar. */
export async function syncReminders(events: PlanEventLite[], s: RemindSettings): Promise<SyncResult> {
  try {
    await cancelOurs();
    if (!s.on) return { ok: true, scheduled: 0 };
    const specs = buildReminders(events);
    if (specs.length === 0) return { ok: true, scheduled: 0 };

    let perm = await Notifications.getPermissionsAsync();
    if (!perm.granted) perm = await Notifications.requestPermissionsAsync();
    if (!perm.granted) return { ok: false, reason: "permission" };

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync(CHANNEL, {
        name: "Plan hatırlatmaları",
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    const hour = clampHour(s.hour);
    for (const spec of specs) {
      await Notifications.scheduleNotificationAsync({
        identifier: spec.id,
        content: { title: spec.title, body: spec.body },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
          weekday: spec.weekday,
          hour,
          minute: 0,
          channelId: CHANNEL,
        },
      });
    }
    return { ok: true, scheduled: specs.length };
  } catch {
    return { ok: false, reason: "error" };
  }
}
