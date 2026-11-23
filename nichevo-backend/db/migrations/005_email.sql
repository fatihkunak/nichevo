-- E-posta doğrulaması ve parola sıfırlama kodları.
-- Mevcut hesaplar "doğrulanmamış" başlar ama hiçbir şey engellenmez (yumuşak doğrulama).
ALTER TABLE users ADD COLUMN email_verified boolean NOT NULL DEFAULT false;
-- Google ile açılan hesapların e-postası Google tarafından zaten doğrulanmıştır
UPDATE users SET email_verified = true WHERE google_sub IS NOT NULL;

-- 6 haneli, kısa ömürlü, tek kullanımlık kodlar. Kodun kendisi saklanmaz, yalnızca özeti.
CREATE TABLE email_codes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose    text NOT NULL CHECK (purpose IN ('pwreset', 'verify')),
  code_hash  text NOT NULL,
  -- Yanlış deneme sayısı; sınıra ulaşınca kod kilitlenir (6 haneli kodu kaba kuvvetten korur)
  attempts   integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_codes_lookup_idx ON email_codes (user_id, purpose, created_at DESC);
