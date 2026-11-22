import { describe, expect, it } from "vitest";

import { collectIgMedia, normalizeIgLinks, normalizeIgProfilePage } from "../src/social/instagram.js";
import { cleanQuery, extractHashtags, isoOrNull, normalizeHandle, parseCount } from "../src/social/parse.js";
import { aggregateHashtags } from "../src/social/service.js";
import { SocialError, type SocialPost } from "../src/social/types.js";
import { normalizeXProfile, normalizeXTweet, normalizeXUserCell } from "../src/social/x.js";

describe("parseCount", () => {
  it("düz, binlik ayraçlı ve kısaltmalı sayıları çevirir", () => {
    expect(parseCount("1,234")).toBe(1234);
    expect(parseCount("1.234.567")).toBe(1234567);
    expect(parseCount("1.2K")).toBe(1200);
    expect(parseCount("3,4 Mn")).toBe(3_400_000);
    expect(parseCount("12 B")).toBe(12_000_000_000); // en-US: B = milyar (arayüz dili en-US'e sabit)
    expect(parseCount("98 Likes. Like")).toBe(98);
    expect(parseCount("1234 views. View post analytics")).toBe(1234);
    expect(parseCount(42)).toBe(42);
  });
  it("sayı yoksa null", () => {
    expect(parseCount("")).toBeNull();
    expect(parseCount("Like")).toBeNull();
    expect(parseCount(undefined)).toBeNull();
    expect(parseCount(Number.NaN)).toBeNull();
  });
});

describe("metin yardımcıları", () => {
  it("hashtag çıkarır (Türkçe harfler, tekrarsız, küçük harf)", () => {
    expect(extractHashtags("Merhaba #Kişisel_Finans ve #yapayzeka #YapayZeka! #1")).toEqual(["kişisel_finans", "yapayzeka", "1"]);
  });
  it("kullanıcı adını bağlantıdan ve @'dan temizler, geçersizi reddeder", () => {
    expect(normalizeHandle("@mrbeast")).toBe("mrbeast");
    expect(normalizeHandle("https://x.com/elonmusk/status/1")).toBe("elonmusk");
    expect(normalizeHandle("https://www.instagram.com/some.user/")).toBe("some.user");
    expect(normalizeHandle("a b")).toBeNull();
    expect(normalizeHandle("../etc")).toBeNull();
    expect(normalizeHandle("")).toBeNull();
  });
  it("arama metnini temizler ve kısaltır", () => {
    expect(cleanQuery("  a\u0000b \n c  ")).toBe("a b c");
    expect(cleanQuery("x".repeat(500))).toHaveLength(100);
  });
  it("zaman damgasını ISO'ya çevirir", () => {
    expect(isoOrNull(1_700_000_000)).toBe("2023-11-14T22:13:20.000Z");
    expect(isoOrNull("2026-11-20T10:00:00.000Z")).toBe("2026-11-20T10:00:00.000Z");
    expect(isoOrNull("saçma")).toBeNull();
    expect(isoOrNull(null)).toBeNull();
  });
});

describe("X ayrıştırma", () => {
  const raw = {
    href: "/foo/status/1234567890",
    text: "  Yeni video #YapayZeka #araçlar  ",
    datetime: "2026-11-20T10:00:00.000Z",
    reply: "5 Replies. Reply",
    repost: "7 reposts. Repost",
    like: "1.2K Likes. Like",
    views: "45K views. View post analytics",
  };
  it("tweeti normalleştirir", () => {
    expect(normalizeXTweet(raw)).toMatchObject({
      platform: "x",
      id: "1234567890",
      url: "https://x.com/foo/status/1234567890",
      author: "foo",
      text: "Yeni video #YapayZeka #araçlar",
      likes: 1200,
      replies: 5,
      reposts: 7,
      views: 45000,
      hashtags: ["yapayzeka", "araçlar"],
    });
  });
  it("etiketi sayısız metrikleri 0, eksik öğeyi null sayar", () => {
    const p = normalizeXTweet({ ...raw, like: "Like", reply: "", views: "" })!;
    expect(p.likes).toBe(0);
    expect(p.replies).toBeNull();
    expect(p.views).toBeNull();
  });
  it("durum bağlantısı olmayan (reklam vb.) kartı atar", () => {
    expect(normalizeXTweet({ ...raw, href: "/i/ads" })).toBeNull();
    expect(normalizeXTweet({ ...raw, href: "" })).toBeNull();
  });
  it("hesap kartını çözer", () => {
    const a = normalizeXUserCell({ href: "/foo", lines: ["Foo Bar", "@foo", "Follow", "AI araçları üzerine", "her gün"], verified: true })!;
    expect(a).toMatchObject({ handle: "foo", name: "Foo Bar", bio: "AI araçları üzerine her gün", verified: true, url: "https://x.com/foo" });
    expect(normalizeXUserCell({ href: "/i/lists", lines: [], verified: false })).toBeNull();
  });
  it("profili çözer", () => {
    const p = normalizeXProfile(
      "foo",
      { name: "Foo Bar\n@foo", bio: "bio", followers: "1.5M Followers", following: "120 Following", posts: "3,400", verified: false, missing: false },
      [],
    );
    expect(p.account).toMatchObject({ handle: "foo", name: "Foo Bar", followers: 1_500_000 });
    expect(p.following).toBe(120);
    expect(p.postsCount).toBe(3400);
  });
});

describe("Instagram ayrıştırma", () => {
  it("profil sayfası meta bilgisinden sayıları ve adı çözer (canlı örnek metin)", () => {
    const p = normalizeIgProfilePage(
      "instagram",
      {
        og: "685M Followers, 178 Following, 8,656 Posts - See Instagram photos and videos from Instagram (@instagram)",
        ogTitle: "Instagram (@instagram) • Instagram photos and videos",
        notFound: false,
      },
      [],
    );
    expect(p.account).toMatchObject({ handle: "instagram", name: "Instagram", followers: 685_000_000, url: "https://www.instagram.com/instagram/" });
    expect(p.following).toBe(178);
    expect(p.postsCount).toBe(8656);
  });

  it("bulunamayan sayfa NOT_FOUND, tanınmayan meta PARSE fırlatır", () => {
    expect(() => normalizeIgProfilePage("yok", { og: null, ogTitle: null, notFound: true }, [])).toThrow(/bulunamadı/);
    try {
      normalizeIgProfilePage("x", { og: "başka bir metin", ogTitle: null, notFound: false }, []);
      expect.unreachable();
    } catch (e) {
      expect((e as SocialError).code).toBe("PARSE");
    }
  });

  it("gönderi bağlantılarını gönderiye çevirir (tekrarsız, geçersiz kodu atar, metrik null)", () => {
    const posts = normalizeIgLinks(
      [
        { author: "instagram", kind: "p", code: "Df-eXldGxRb" },
        { author: "instagram", kind: "reel", code: "Df2aGgPtPZQ" },
        { author: "", kind: "p", code: "Df-eXldGxRb" },
        { author: "x", kind: "p", code: "../etc" },
      ],
      "varsayilan",
    );
    expect(posts.map((p) => p.id)).toEqual(["Df-eXldGxRb", "Df2aGgPtPZQ"]);
    expect(posts[1]).toMatchObject({ url: "https://www.instagram.com/reel/Df2aGgPtPZQ/", author: "instagram", likes: null, text: "" });
    expect(normalizeIgLinks([{ author: "", kind: "p", code: "ABCDE12345" }], "varsayilan")[0]?.author).toBe("varsayilan");
  });

  it("graphql yanıtından medyayı şemaya bağlı kalmadan toplar (canlı şekil: edges[].node.media, user.username)", () => {
    const json = {
      data: {
        xdt_api__v1__feed__timeline__connection: {
          edges: [
            { node: { media: { code: "DgCUTHgoFPO", taken_at: 1_795_334_221, like_count: 3041, comment_count: 44, caption: { text: "The White Curtain Tour #tour" }, user: { username: "karsudonmez" } } } },
            { node: { media: { code: "BBB", like_count: -1, play_count: 500, owner: { username: "u2" }, caption: null } } },
            { node: { not_media: { code: "ZZZ" } } },
          ],
        },
      },
    };
    const posts = collectIgMedia(json);
    expect(posts.map((p) => p.id)).toEqual(["DgCUTHgoFPO", "BBB"]);
    expect(posts[0]).toMatchObject({ author: "karsudonmez", likes: 3041, replies: 44, hashtags: ["tour"] });
    expect(posts[1]).toMatchObject({ author: "u2", likes: null, views: 500, text: "" });
  });

  it("yazarı olmayan medya, varsayılan yazarla kabul edilir", () => {
    const posts = collectIgMedia({ items: [{ code: "CCC", like_count: 5, taken_at: 1_700_000_000 }] }, 30, "foo");
    expect(posts[0]).toMatchObject({ id: "CCC", author: "foo", likes: 5 });
    expect(collectIgMedia({ items: [{ code: "CCC", like_count: 5 }] })).toEqual([]);
  });
});

describe("aggregateHashtags", () => {
  const mk = (id: string, tags: string[], likes: number): SocialPost => ({
    platform: "x", id, url: "", author: "a", text: "", postedAt: null, likes, replies: 0, reposts: 0, views: null, hashtags: tags,
  });
  it("geçiş sayısına, eşitlikte etkileşime göre sıralar ve sorgunun kendisini atar", () => {
    const out = aggregateHashtags([mk("1", ["ai", "tool"], 10), mk("2", ["ai", "yeni"], 5), mk("3", ["tool"], 100)], "#AI");
    expect(out.map((h) => h.tag)).toEqual(["tool", "yeni"]);
    expect(out[0]).toMatchObject({ mentions: 2, engagement: 110 });
  });
});
