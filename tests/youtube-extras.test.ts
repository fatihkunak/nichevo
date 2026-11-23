import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchRecentVideos } from "../lib/youtube-extras";

const CH = "UC" + "a".repeat(22);

function mockFetch(responses: { status?: number; body?: unknown }[]) {
  const calls: string[] = [];
  const queue = [...responses];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      calls.push(url);
      const r = queue.shift() ?? { status: 500 };
      const status = r.status ?? 200;
      return { ok: status >= 200 && status < 300, status, json: async () => r.body };
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("fetchRecentVideos", () => {
  it("anahtar ya da geçersiz kanal kimliğinde istek atmadan boş döner", async () => {
    const calls = mockFetch([]);
    expect(await fetchRecentVideos(CH, null)).toEqual([]);
    expect(await fetchRecentVideos("@handle", "k")).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("UC kimliğinden UU yükleme listesini kullanır ve istatistikleri çevirir", async () => {
    const calls = mockFetch([
      { body: { items: [{ contentDetails: { videoId: "v1" } }, { contentDetails: { videoId: "v2" } }] } },
      {
        body: {
          items: [
            { id: "v1", snippet: { title: "A", publishedAt: "2026-11-01T00:00:00Z" }, statistics: { viewCount: "100", likeCount: "5", commentCount: "2" } },
            { id: "v2", snippet: { title: "B", publishedAt: "2026-10-01T00:00:00Z" }, statistics: { viewCount: "50" } },
          ],
        },
      },
    ]);
    const out = await fetchRecentVideos(CH, "KEY", 10);
    expect(calls[0]).toContain("playlistId=UU" + "a".repeat(22));
    expect(calls[1]).toContain("id=v1,v2");
    expect(out).toEqual([
      { id: "v1", title: "A", views: 100, likes: 5, comments: 2, publishedAt: "2026-11-01T00:00:00Z" },
      { id: "v2", title: "B", views: 50, likes: 0, comments: 0, publishedAt: "2026-10-01T00:00:00Z" },
    ]);
  });

  it("liste 404 ise boş döner, diğer hatada fırlatır", async () => {
    mockFetch([{ status: 404 }]);
    expect(await fetchRecentVideos(CH, "KEY")).toEqual([]);
    mockFetch([{ status: 403 }]);
    await expect(fetchRecentVideos(CH, "KEY")).rejects.toThrow("API Hatası: 403");
  });
});
