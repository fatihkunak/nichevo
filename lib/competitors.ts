// Rakip kanal takibi: saf mantık (React Native'e bağımlı değil), vitest ile test edilir.

export const MAX_COMPETITORS = 5;

export interface Competitor {
  id: string; // YouTube kanal kimliği (UC...)
  title: string;
  /** Kullanıcının en son "gördüm" dediği (ya da eklenirken görülen) video. null = temel çizgi henüz kurulmadı. */
  lastSeenVideoId: string | null;
}

export type AddResult = { ok: true; list: Competitor[] } | { ok: false; reason: "duplicate" | "full"; list: Competitor[] };

export function addCompetitor(list: Competitor[], next: Competitor): AddResult {
  if (list.some((x) => x.id === next.id)) return { ok: false, reason: "duplicate", list };
  if (list.length >= MAX_COMPETITORS) return { ok: false, reason: "full", list };
  return { ok: true, list: [...list, next] };
}

export function removeCompetitor(list: Competitor[], id: string): Competitor[] {
  return list.filter((x) => x.id !== id);
}

export function markSeen(list: Competitor[], id: string, videoId: string): Competitor[] {
  return list.map((x) => (x.id === id ? { ...x, lastSeenVideoId: videoId } : x));
}

/** Yeni video: temel çizgi kurulmuşsa ve en yeni video görülenden farklıysa. */
export function isNewVideo(c: Competitor, newestVideoId: string | null): boolean {
  if (!c.lastSeenVideoId || !newestVideoId) return false;
  return c.lastSeenVideoId !== newestVideoId;
}

/** "5 saat önce", "3 gün önce", "1 ay önce"; geçersiz tarihte "". */
export function formatAgo(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const h = Math.max(0, now - t) / 3_600_000;
  if (h < 1) return "az önce";
  if (h < 24) return `${Math.floor(h)} saat önce`;
  const d = h / 24;
  if (d < 30) return `${Math.floor(d)} gün önce`;
  return `${Math.floor(d / 30)} ay önce`;
}
