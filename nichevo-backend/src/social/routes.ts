// /v1/social/* uç noktaları. Kimlik doğrulama app.ts'ten gelir; ayrıca yalnızca izin listesindeki e-postalar kullanabilir
// (kazıma, sunucu makinesindeki tek bir test hesabı oturumunu kullandığı için herkese açık değildir).
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { normalizeHandle } from "./parse.js";
import type { SocialService } from "./service.js";
import { PLATFORMS, SocialError, isPlatform, type Platform } from "./types.js";

export interface SocialRouteDeps {
  service: SocialService;
  /** Küçük harfli izinli e-postalar */
  allowedEmails: Set<string>;
  authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
  now?: () => number;
}

const STATUS: Record<SocialError["code"], number> = {
  NOT_CONNECTED: 409,
  LOGIN_REQUIRED: 409,
  BUSY: 409,
  BLOCKED: 429,
  NOT_FOUND: 404,
  PARSE: 502,
};

const platformSchema = z.enum(["x", "instagram"]);
const searchQuery = z.object({
  platform: platformSchema,
  kind: z.enum(["posts", "accounts", "hashtags"]),
  q: z.string().min(1).max(200),
  mode: z.enum(["top", "latest"]).optional(),
});
const trendQuery = z.object({ platform: platformSchema, q: z.string().min(1).max(200) });
const watchBody = z.object({ platform: platformSchema, handle: z.string().min(1).max(120) });

// Uygulamanın kendi tarayıcısından okuduğu veri (ingest): istemci güvenilmez sayılır, her alan sınırlanır
const count = z.number().int().min(0).max(1e12).nullable();
const safeUrl = z.string().max(300).refine((u) => /^https:\/\/(x\.com|www\.instagram\.com)\//.test(u), "geçersiz bağlantı");
const isoDate = z.string().max(40).refine((d) => !Number.isNaN(Date.parse(d)), "geçersiz tarih").nullable();
const ingestPost = z.object({
  platform: platformSchema,
  id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
  url: safeUrl,
  author: z.string().max(40),
  text: z.string().max(1000),
  postedAt: isoDate,
  likes: count,
  replies: count,
  reposts: count,
  views: count,
  hashtags: z.array(z.string().max(100)).max(30),
});
const ingestAccount = z.object({
  platform: platformSchema,
  handle: z.string().regex(/^[A-Za-z0-9_][A-Za-z0-9._]{0,29}$/),
  name: z.string().max(120),
  bio: z.string().max(500),
  followers: count,
  verified: z.boolean(),
  url: safeUrl,
});
const ingestProfileBody = z.object({
  profile: z.object({ account: ingestAccount, following: count, postsCount: count, posts: z.array(ingestPost).max(30) }),
});
const ingestTrendsBody = z.object({
  platform: platformSchema,
  q: z.string().min(1).max(200),
  data: z.object({
    hashtags: z
      .array(z.object({ tag: z.string().max(100), postCount: count, mentions: z.number().int().min(0).max(1e6), engagement: z.number().int().min(0).max(1e12) }))
      .max(30),
    topPosts: z.array(ingestPost).max(10),
    sampleSize: z.number().int().min(0).max(1000),
  }),
});
const INGEST_BODY_LIMIT = 256 * 1024;

export function registerSocialRoutes(app: FastifyInstance, deps: SocialRouteDeps) {
  const { service, allowedEmails, authenticate } = deps;
  const now = deps.now ?? Date.now;
  const driver = service.driver;

  const fail = (reply: FastifyReply, status: number, code: string, message: string) => reply.code(status).send({ error: { code, message } });

  // Kullanıcı başına kayan pencere sınırı: aşırı istek platform hesabını riske atar
  const hits = new Map<string, number[]>();
  const limited = (key: string, max: number, windowMs: number) => {
    const t = now();
    const arr = (hits.get(key) ?? []).filter((x) => t - x < windowMs);
    arr.push(t);
    hits.set(key, arr);
    return arr.length > max;
  };

  const allowed = async (req: FastifyRequest, reply: FastifyReply) => {
    await authenticate(req, reply);
    if (reply.sent) return;
    const email = String((req as FastifyRequest & { user?: { email: string } }).user?.email ?? "").toLowerCase();
    if (!allowedEmails.has(email)) return fail(reply, 403, "SOCIAL_NOT_ALLOWED", "Sosyal tarama bu hesap için açık değil.");
  };

  const handleErr = (reply: FastifyReply, e: unknown) => {
    if (e instanceof SocialError) return fail(reply, STATUS[e.code], e.code, e.message);
    throw e;
  };

  // Durum: yetkisiz ama giriş yapmış kullanıcıya 200 {enabled:false} döner (istemci sekmeyi gizler)
  app.get("/v1/social/status", { preHandler: authenticate }, async (req) => {
    const email = String((req as FastifyRequest & { user?: { email: string } }).user?.email ?? "").toLowerCase();
    if (!allowedEmails.has(email)) return { enabled: false };
    const platforms = Object.fromEntries(
      PLATFORMS.map((p) => [p, { ...driver.status(p), loginInProgress: driver.loginInProgress(p) }]),
    ) as Record<Platform, unknown>;
    return { enabled: true, platforms };
  });

  app.post("/v1/social/:platform/login", { preHandler: allowed }, async (req, reply) => {
    const { platform } = req.params as { platform: string };
    if (!isPlatform(platform)) return fail(reply, 404, "NOT_FOUND", "Bilinmeyen platform");
    if (limited(`login:${platform}`, 5, 10 * 60_000)) return fail(reply, 429, "RATE_LIMITED", "Çok sık deneme.");
    return driver.beginLogin(platform);
  });

  app.delete("/v1/social/:platform/session", { preHandler: allowed }, async (req, reply) => {
    const { platform } = req.params as { platform: string };
    if (!isPlatform(platform)) return fail(reply, 404, "NOT_FOUND", "Bilinmeyen platform");
    await driver.disconnect(platform);
    return reply.code(204).send();
  });

  app.get("/v1/social/search", { preHandler: allowed }, async (req, reply) => {
    const q = searchQuery.parse(req.query);
    if (limited(`search:${(req as any).user.id}`, 30, 60 * 60_000)) return fail(reply, 429, "RATE_LIMITED", "Saatlik arama sınırına ulaştın.");
    try {
      return await service.search(q.platform, q.kind, q.q, q.mode ?? "top");
    } catch (e) {
      return handleErr(reply, e);
    }
  });

  app.get("/v1/social/trends", { preHandler: allowed }, async (req, reply) => {
    const q = trendQuery.parse(req.query);
    if (limited(`trends:${(req as any).user.id}`, 20, 60 * 60_000)) return fail(reply, 429, "RATE_LIMITED", "Saatlik trend sınırına ulaştın.");
    try {
      return await service.trends(q.platform, q.q);
    } catch (e) {
      return handleErr(reply, e);
    }
  });

  app.get("/v1/social/watch", { preHandler: allowed }, async (req) => ({ items: await service.listWatch((req as any).user.id) }));

  app.post("/v1/social/watch", { preHandler: allowed }, async (req, reply) => {
    const b = watchBody.parse(req.body);
    const handle = normalizeHandle(b.handle);
    if (!handle) return fail(reply, 400, "VALIDATION", "Geçerli bir kullanıcı adı gir (örn. @hesap ya da profil bağlantısı).");
    try {
      const w = await service.addWatch((req as any).user.id, b.platform, handle);
      return reply.code(201).send({ id: w.id, platform: w.platform, handle: w.handle });
    } catch (e) {
      return handleErr(reply, e);
    }
  });

  app.delete("/v1/social/watch/:id", { preHandler: allowed }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const ok = await service.removeWatch((req as any).user.id, id);
    return ok ? reply.code(204).send() : fail(reply, 404, "NOT_FOUND", "Takip kaydı bulunamadı.");
  });

  app.post("/v1/social/watch/:id/refresh", { preHandler: allowed }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    if (limited(`refresh:${(req as any).user.id}`, 20, 60 * 60_000)) return fail(reply, 429, "RATE_LIMITED", "Saatlik yenileme sınırına ulaştın.");
    try {
      await service.refreshWatch((req as any).user.id, id);
      return { ok: true };
    } catch (e) {
      return handleErr(reply, e);
    }
  });

  // Uygulama (telefondaki kendi tarayıcısı) X'ten okuduğunu yollar: profil anlık görüntüsü ve trend verisi
  app.post("/v1/social/watch/:id/ingest", { preHandler: allowed, bodyLimit: INGEST_BODY_LIMIT }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const b = ingestProfileBody.parse(req.body);
    if (limited(`ingest:${(req as any).user.id}`, 120, 60 * 60_000)) return fail(reply, 429, "RATE_LIMITED", "Saatlik veri gönderme sınırına ulaştın.");
    try {
      await service.ingestProfile((req as any).user.id, id, b.profile);
      return { ok: true };
    } catch (e) {
      return handleErr(reply, e);
    }
  });

  app.post("/v1/social/trends/ingest", { preHandler: allowed, bodyLimit: INGEST_BODY_LIMIT }, async (req, reply) => {
    const b = ingestTrendsBody.parse(req.body);
    if (limited(`ingest:${(req as any).user.id}`, 120, 60 * 60_000)) return fail(reply, 429, "RATE_LIMITED", "Saatlik veri gönderme sınırına ulaştın.");
    try {
      await service.ingestTrends(b.platform, b.q, b.data);
      return { ok: true };
    } catch (e) {
      return handleErr(reply, e);
    }
  });

  // Asistanın okuyacağı kısa özet (takip listesi + son trendler)
  app.get("/v1/social/digest", { preHandler: allowed }, async (req) => service.digest((req as any).user.id));
}
