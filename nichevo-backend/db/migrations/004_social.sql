-- Sosyal tarama (X + Instagram, yalnızca okuma): takip listesi, profil anlık görüntüleri, gönderiler, arama önbelleği.
-- Tablo yetkileri 002_grants.sql'deki DEFAULT PRIVILEGES ile otomatik gelir.
CREATE TABLE social_watch (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform        text NOT NULL CHECK (platform IN ('x', 'instagram')),
  handle          text NOT NULL CHECK (handle ~ '^[A-Za-z0-9_][A-Za-z0-9._]{0,29}$'),
  display_name    text NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_checked_at timestamptz,
  last_error      text,
  UNIQUE (user_id, platform, handle)
);

-- Her yenilemede profilin sayıları: zaman içindeki değişimi (büyüme) göstermek için
CREATE TABLE social_snapshots (
  id          bigserial PRIMARY KEY,
  watch_id    uuid NOT NULL REFERENCES social_watch(id) ON DELETE CASCADE,
  taken_at    timestamptz NOT NULL DEFAULT now(),
  followers   bigint,
  following   bigint,
  posts_count bigint
);
CREATE INDEX social_snapshots_watch_idx ON social_snapshots (watch_id, taken_at DESC);

-- Takip edilen hesapların gönderileri (son görülen sayılarla)
CREATE TABLE social_posts (
  id          bigserial PRIMARY KEY,
  watch_id    uuid NOT NULL REFERENCES social_watch(id) ON DELETE CASCADE,
  post_id     text NOT NULL,
  url         text NOT NULL,
  text        text NOT NULL DEFAULT '',
  posted_at   timestamptz,
  likes       bigint,
  replies     bigint,
  reposts     bigint,
  views       bigint,
  hashtags    text[] NOT NULL DEFAULT '{}',
  fetched_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (watch_id, post_id)
);
CREATE INDEX social_posts_watch_idx ON social_posts (watch_id, posted_at DESC NULLS LAST);

-- Arama ve trend sonuçları kısa süre önbelleklenir: aynı sayfayı tekrar tekrar çekmek hesabı riske atar
CREATE TABLE social_cache (
  key        text PRIMARY KEY,
  payload    jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now()
);
