// Rakip kanalların cihazda saklanması ve (1 saat önbellekli) güncel durumu.
import AsyncStorage from "@react-native-async-storage/async-storage";

import type { Competitor } from "@/lib/competitors";
import type { RecentVideo } from "@/lib/insights";
import { cached } from "@/lib/market";
import { fetchChannelInfo, fetchRecentVideos } from "@/lib/youtube-extras";

const KEY = "nichevo.competitors.v1";
const HOUR = 3_600_000;

export interface CompetitorSnapshot {
  subs: number;
  newest: RecentVideo | null;
}

export async function loadCompetitors(): Promise<Competitor[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x) => x && typeof x.id === "string" && typeof x.title === "string")
      .map((x) => ({ id: x.id, title: x.title, lastSeenVideoId: x.lastSeenVideoId ?? null }));
  } catch {
    return [];
  }
}

export async function saveCompetitors(list: Competitor[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(list)).catch(() => {});
}

/** Abone sayısı + en yeni video; 1 saat önbellekli (kanal başına ~3 kota birimi). `force` önbelleği atlar. */
export async function loadSnapshot(id: string, apiKey: string, force = false) {
  const key = `nichevo.competitor.${id}.v1`;
  if (force) await AsyncStorage.removeItem(key).catch(() => {});
  const load = async (): Promise<CompetitorSnapshot> => {
    const [info, vids] = await Promise.all([fetchChannelInfo(id, apiKey), fetchRecentVideos(id, apiKey, 1)]);
    return { subs: info?.subs ?? 0, newest: vids[0] ?? null };
  };
  return cached<CompetitorSnapshot>(key, load, Date.now(), HOUR);
}

/** Kanal silinince önbelleğini de temizle. */
export async function dropSnapshot(id: string): Promise<void> {
  await AsyncStorage.removeItem(`nichevo.competitor.${id}.v1`).catch(() => {});
}
