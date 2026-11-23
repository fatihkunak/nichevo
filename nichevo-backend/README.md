# nichevo-backend

Nichevo'nun yerel hesap sunucusu. Scenefx'teki "her şey kendi makinemde" yaklaşımının hafif hali:
**Docker'da Postgres + küçük bir Fastify API** (Supabase yok, bulut yok).

```
telefon ──(adb reverse / Cloudflare Tunnel)──▶ Fastify :3102 ──▶ Postgres (Docker) :5545
```

## Ne yapar
Yalnızca **hesap**: kayıt, giriş (e-posta + şifre ya da Google), jeton yenileme, çıkış, profil, şifre değiştirme, hesap silme.
API anahtarları (YouTube/AI sağlayıcıları) **cihazda kalır**, sunucuya hiç gönderilmez.

| Uç nokta | Açıklama |
|---|---|
| `GET /healthz` | Sunucu + DB durumu |
| `POST /v1/auth/register` | `{email, password(≥8), name, channelName?}` → oturum |
| `POST /v1/auth/login` | `{email, password}` → oturum (10 deneme/15 dk sınırı) |
| `POST /v1/auth/refresh` | `{refreshToken}` → yeni oturum (jeton döndürülür; eski jeton yeniden kullanılırsa tüm aile kapanır) |
| `POST /v1/auth/logout` | `{refreshToken}` → 204 |
| `POST /v1/auth/change-password` | Bearer + `{currentPassword, newPassword}`; eski tüm oturumlar ölür |
| `GET /v1/auth/providers` | `{google: bool}`: Google girişi bu sunucuda açık mı (istemci düğmeyi buna göre gösterir) |
| `GET /v1/auth/google/start?redirect=` | Google'a yönlendirir. `redirect` yalnızca izinli adreslerden biri olabilir (`nichevo://auth`, `https://nichevo.fatihgo.com/auth/callback`, yerel geliştirme) |
| `GET /v1/auth/google/callback` | Google'ın geri dönüşü: kodu sunucuda değiştirir, kimliği doğrular, kullanıcıyı bulur/açar ve istemciye **tek kullanımlık kod** ile döner |
| `POST /v1/auth/google/exchange` | `{code}` → normal oturum (2 dk geçerli, bir kez kullanılabilir) |
| `GET/PATCH/DELETE /v1/me` | Profil; `DELETE` şifre ister (Google hesabı için `{confirm: true}`), hesabı ve jetonları siler. `plan` istemciden değiştirilemez |

Oturum: 15 dk'lık erişim jetonu (HS256 JWT, `token_version` ile iptal edilebilir) + 60 gün'lük döndürülen yenileme jetonu (DB'de yalnızca SHA-256 özeti). Parolalar Node'un yerleşik `scrypt`'i ile (N=2¹⁵).

## Sosyal tarama (X + Instagram, yalnızca okuma)
Opsiyonel. `.env`'de `SOCIAL_ALLOWED_EMAILS=hesap@ornek.com` (virgülle birden çok) **boşsa özellik tamamen kapalıdır** (`/v1/social/*` kayıtlı bile olmaz). Listedeki hesaplar dışındakiler `GET /v1/social/status` ile `{enabled:false}` görür, diğer uçlar 403 verir.

Nasıl çalışır: sunucu makinesindeki **test hesabı** oturumuyla (Chrome kalıcı profili, `.social-profile/`, git'e girmez) gizli Chrome gezdirir. Beğenme/takip/paylaşma/mesaj YOK. Tüm işlemler tek sırada, aralarında rastgele bekleme; arama 30 dk, trend 1 saat önbelleklenir; kullanıcı başına saatlik sınırlar var.
```powershell
powershell -File deploy/install-social-login-tasks.ps1   # bir kez: uygulamadaki "Giriş yap" düğmesi masaüstünde pencere açabilsin
npm run social:login -- x            # ya da instagram: elle giriş penceresi (TEST hesabıyla gir, ana hesabınla DEĞİL)
```
| Uç nokta | Açıklama |
|---|---|
| `GET /v1/social/status` | `{enabled, platforms:{x,instagram}:{connected, handle?, since?, loginInProgress}}` |
| `POST /v1/social/:platform/login` · `DELETE /v1/social/:platform/session` | Giriş penceresini aç / oturumu sil |
| `GET /v1/social/search?platform&kind=posts\|accounts\|hashtags&q&mode=top\|latest` | Niş araması |
| `GET /v1/social/trends?platform&q` | Hashtag + en çok etkileşim alan gönderiler |
| `GET/POST /v1/social/watch` · `DELETE /v1/social/watch/:id` · `POST /v1/social/watch/:id/refresh` | Takip listesi (en fazla 25), profil anlık görüntüleri, gönderiler. `SOCIAL_REFRESH_HOURS` (varsayılan 12) saatte bir otomatik yenilenir |
| `GET /v1/social/digest` | Asistanın okuduğu düz metin özet |

**X nasıl okunuyor:** X, otomatik (headless) Chrome'a her sayfada 403 veriyor (giriş sayfası dahil), bu yüzden sunucu X'i okumaz (`BLOCKED`); engeli aşmaya yönelik bir önlem YOK ve eklenmeyecek. Bunun yerine **telefon uygulaması X'i kendi tarayıcısıyla (WebView) okur**: kullanıcı görünür pencerede kendi hesabıyla giriş yapar, uygulama sayfayı okur ve sonucu sunucuya yollar:
- `POST /v1/social/watch/:id/ingest` `{profile}`: takip kaydına profil anlık görüntüsü + gönderiler yazar (platform/kullanıcı adı kayıtla eşleşmeli).
- `POST /v1/social/trends/ingest` `{platform, q, data}`: trend verisini önbelleğe yazar (asistan özetine girer).
İstemciden gelen veri güvenilmez sayılır: tüm alanlar zod ile sınırlı (uzunluk, sayı aralığı, yalnızca x.com/instagram.com bağlantıları, geçerli tarih, en fazla 30 gönderi). Web uygulamasında X yoktur (tarayıcı güvenlik modeli x.com'u okumaya izin vermez); web'de yalnızca Instagram çalışır. Okuma seçicileri `shared/x-dom.ts` içinde, backend ve uygulama aynı kodu kullanır.

**Instagram (23 Kas 2026 canlı testi, gerçek test hesabıyla):** profil takibi çalışır (takipçi/takip/gönderi sayısı `og:description` meta etiketinden, gönderi bağlantıları sayfadan) ve anahtar kelime gönderi araması çalışır (`/explore/search/keyword/`); ikisinde de beğeni/yorum sayısı ve çoğu zaman yazar bilgisi YOKTUR. Hesap araması ve hashtag araması çalışmaz: Instagram `topsearch` uç noktasını kapattı (kendi web uygulamasının isteği de 404 alıyor) ve hashtag sayfalarını anahtar kelime aramasına yönlendirdi; bunlar `PARSE` ("desteklenmiyor") olarak bildirilir.

**Bilinen sınırlar:** Sayfa yapıları değişebilir; okuyucular kırılırsa `PARSE` hatası verir. WebView ile X okuması cihazda gerçek hesapla uçtan uca doğrulanmadı (betikler gerçek Chrome'da sahte X sayfalarına karşı test edildi). Telefon uygulaması `react-native-webview` içerdiği için yeni APK derlemesi gerekir.

## Sunucu üzerinden yapay zekâ (EVREN LLM, anahtarsız)
Opsiyonel. `.env`'de `AI_API_KEY=...` (eski ad `EVREN_API_KEY` de çalışır) ve izin listesi (`AI_ALLOWED_EMAILS`, yoksa `SOCIAL_ALLOWED_EMAILS`) varsa sunucu, uygulamaya **anahtarsız** yapay zekâ sunar: anahtar yalnızca sunucuda durur, cihaza girilmez/gönderilmez. Uygulamada Profil > Yapay Zeka > "Nichevo sunucusu (EVREN LLM, anahtarsız)" seçilir.

**Sağlayıcı değiştirme (EVREN ücretsiz süresi 1 Aralık 2026'da bitiyor):** sunucu herhangi bir OpenAI uyumlu `/chat/completions` uç noktasına bağlanır; kod değişmez, yalnızca `.env`:
```
AI_BASE_URL=http://localhost:20128/v1   # örn. OmniRoute
AI_API_KEY=...                           # sağlayıcının anahtarı
AI_MODEL=coding                          # doluysa istemcinin model isteği yok sayılır (uygulama EVREN'e özgü qwen3.8-flash-next gönderiyor)
AI_PROVIDER_NAME=omniroute               # isteğe bağlı, yalnızca /v1/ai/status'ta görünür
```
Sunucu anahtarı hem `X-API-Key` (EVREN) hem `Authorization: Bearer` (OpenAI uyumlular) olarak gönderir. OmniRoute `coding` combo'su gerçek istekle doğrulandı (23 Kas 2026). `.env` değişince sunucuyu yeniden başlat; yalnızca kendi sürecini durdur.
| Uç nokta | Açıklama |
|---|---|
| `GET /v1/ai/status` | `{enabled, provider, defaultModel}` (izinsiz hesaba `enabled:false`) |
| `POST /v1/ai/chat` | `{system?, messages:[{role:user\|model, text}], model?, maxTokens?}` → `{text, model}` |
İzin listesi dışı 403; kullanıcı başına saatlik 60 istek; en fazla 30 mesaj, 12 bin karakter/mesaj, 4096 token; üst servis hata gövdesi anahtarı yansıtsa bile `***` ile temizlenir. Gerçek EVREN'de doğrulandı (23 Kas 2026): `auto` yönlendirmesi bazen yavaş görsel modele (`qwen3-vl-30b`, ~45 sn) düşer; varsayılan `qwen3.8-flash-next` (~15-18 sn, düşünen model). Yanıtlar 15-45 sn sürebilir, uygulama isteği 100 sn bekler.

## Kurulum (bir kez)
```bash
# 1) Postgres konteyneri (yeniden başlatmada otomatik kalkar, yalnızca 127.0.0.1)
docker run -d --name nichevo-postgres --restart unless-stopped \
  -p 127.0.0.1:5545:5432 -v nichevo-postgres-data:/var/lib/postgresql/data \
  -e POSTGRES_USER=nichevo_owner -e POSTGRES_PASSWORD=<güçlü-şifre> -e POSTGRES_DB=nichevo \
  postgres:16-alpine

# 2) .env: .env.example'ı kopyala, değerleri doldur (JWT_SECRET ≥ 32 karakter)
# 3) Bağımlılıklar + şema
npm install
npm run migrate
```
Portlar bilerek `5545`/`3102`: `5544` (pmbot-postgres), `5432` (migren-research-db), `3101` (GramiqApi) başka projelerin.

## Çalıştırma
```bash
npm start          # http://127.0.0.1:3102 (elle, geliştirme)
npm test           # gerçek Postgres'e karşı (ayrı nichevo_test veritabanı)
npm run check      # tsc
```

### Açılışta otomatik başlatma (Görev Zamanlayıcı `NichevoApi`)
```powershell
powershell -File deploy\install-tasks.ps1    # bir kez; NichevoApi + NichevoApiTunnel; yönetici gerekmez
Start-ScheduledTask -TaskName NichevoApi      # hemen başlat
Start-ScheduledTask -TaskName NichevoApiTunnel
```
Gramiq'teki düzen: `wscript` + `run-hidden.vbs` (pencere yok) + S4U (oturum açmadan). `start-backend.cmd` Docker/Postgres henüz hazır değilse 15 sn bekleyip yeniden dener; günlük `logs/backend.log`.
**Durdurmak** (yalnız kendi sürecini): `deploy\stop.flag` dosyasını oluştur, sonra `Get-NetTCPConnection -LocalPort 3102` → `OwningProcess` sürecini durdur. Yeniden açmak için bayrağı sil ve görevi başlat. (Süreci bayraksız öldürürsen döngü 15 sn sonra yeniden başlatır; bu yeniden başlatmak için de işe yarar.)
Not: yeniden başlatma (reboot) ile açılış henüz denenmedi.

### Şifre sıfırlama (yedek: komut satırı)
E-posta açıksa (aşağıya bak) kullanıcı uygulamada **Şifremi unuttum**'u kullanır. SMTP yokken ya da acil durumda yedek:
```bash
npm run reset-password -- kisi@mail.com   # rastgele geçici şifreyi bir kez yazdırır, tüm oturumları kapatır
```
Kullanıcı girişten sonra Profil > Şifre'den değiştirir.

## Telefon bağlantısı
**Geliştirme (USB):** `adb reverse tcp:3102 tcp:3102`, uygulamayı şu ortamla derle:
`NICHEVO_ALLOW_CLEARTEXT=1` (prebuild) ve `EXPO_PUBLIC_API_URL=http://127.0.0.1:3102` (gradle/bundle).
`EXPO_PUBLIC_API_URL` paketleme anında gömülür; verilmezse uygulama **yerel moda** düşer (şifre doğrulanmaz, hesap yalnızca cihazda).

**Gerçek kullanım (https):** ayrı Cloudflare tüneli `nichevo-api` (id `300d41d2…`, yapılandırma `~/.cloudflared/nichevo-api.yml`, kimlik dosyası git dışı) → `127.0.0.1:3102`. İki adres aynı tünele bağlı:
- **`https://nichevo-api.fatihgo.com`** ← uygulamaya gömülen ana adres (Gramiq/Stedora ile aynı düzen; DNS kaydı Cloudflare API ile eklendi)
- `https://nichevo-api.scenefxai.app` ← yedek/alternatif adres (DNS `cloudflared route dns` ile)

`sound-platform-dev`, `gramiq-api`, `stedora-api` tünellerine dokunmaz. Yayın sürümü **cleartext bayrağı olmadan** ve `EXPO_PUBLIC_API_URL=https://nichevo-api.fatihgo.com` ile derlenir. **Gradle önbelleği ortam değişkenini izlemez:** adres değişince `:app:createBundleReleaseJsAndAssets --rerun` ver ve APK'daki paketi `grep -a "https://nichevo-api" assets/index.android.bundle` ile doğrula.
Tüneli sıfırdan kurarsan: `cloudflared tunnel create nichevo-api`, sonra DNS için **`--config nichevo-api.yml` vererek** `cloudflared --config <yml> tunnel route dns -f <TÜNEL-ID> nichevo-api.scenefxai.app` (config vermezsen `~/.cloudflared/config.yml`'deki varsayılan tünel seçilir ve CNAME YANLIŞ tünele gider; günlükteki `tunnelID=` değerini kontrol et).
Not: hesaplar herkese açık kayıt alıyor; e-posta doğrulaması yumuşaktır (girişi engellemez, bkz. aşağıdaki bölüm). Hız sınırı var ama istenmeyen kayıt gelirse `/v1/auth/register`'ı kapatmayı düşün.

## Tuzaklar (scenefx'ten ders)
- **GRANT unutma:** çalışma rolü `nichevo_app` süper kullanıcı değil; yeni tablo eklerken `002_grants.sql`'deki `DEFAULT PRIVILEGES` kapsar, yine de testte kontrol et. Test, uygulamayı bu rolle çalıştırır.
- Migrasyonlar `nichevo_owner` ile, sunucu `nichevo_app` ile çalışır.
- `.env` git'e girmez.

## Parola sıfırlama ve e-posta doğrulaması

Opsiyonel. `.env`'de `SMTP_URL` (örn. `smtps://kullanici:parola@smtp.ornek.com:465`) ve `MAIL_FROM` (örn. `Nichevo <no-reply@ornek.com>`) **ikisi de** tanımlıysa açılır; yoksa kapalıdır (aşağıdaki uç noktalar 503 verir, `GET /v1/auth/providers` `email:false` döner ve uygulama düğmeleri göstermez; kayıt eskisi gibi çalışır). Herhangi bir SMTP sağlayıcısı olur. Yeni göç `005_email.sql` için `npm run migrate` çalıştırılmalıdır.

| Uç nokta | Ne yapar |
|---|---|
| `POST /v1/auth/forgot-password` `{email}` | Şifreli hesaba 6 haneli kod gönderir. Yanıt her durumda `202 {ok:true}` (hesap var mı belli olmaz); aynı e-posta için saatte 3, IP için saatte 10 istek |
| `POST /v1/auth/reset-password` `{email, code, newPassword}` | Kod doğruysa şifreyi değiştirir, tüm oturumları kapatır, yeni oturum döner. Kod 15 dk geçerli, tek kullanımlık, 5 yanlış denemede kilitlenir |
| `POST /v1/auth/verify-email` `{code}` (oturumlu) | E-postayı doğrulanmış yapar (`user.emailVerified`). Kayıtta kod otomatik gönderilir; doğrulama **girişi engellemez** |
| `POST /v1/auth/resend-verification` (oturumlu) | Kodu yeniden gönderir (saatte 3) |

**Nerede tutulur:** `SMTP_URL` ve `MAIL_FROM` `.env` içinde ya da ayrı `.env.mail` dosyasında olabilir (git dışı; `deploy\start-backend.cmd` ikisini de okur, `.env.mail` yoksa sorun olmaz). Bu kurulumda Brevo (`smtp-relay.brevo.com:587`, STARTTLS) kullanılıyor; anahtar süresi 1 yıl, 90 gün kullanılmazsa Brevo anahtarı kapatır. Anahtar yenilenince yalnızca `.env.mail` güncellenir.

**Yeniden başlatma uyarısı:** `start-backend.cmd` dosyasını düzenledikten sonra yeniden başlatmak için yalnızca node'u öldürmek yetmez (çalışan `.cmd` dosyası değişince satır konumları kayar). Döngü betiğini (`cmd.exe ... start-backend.cmd`) ve node'u birlikte durdurup `Start-ScheduledTask NichevoApi` ile görevi başlat.

Kodun kendisi veritabanında saklanmaz, yalnızca `JWT_SECRET` ile HMAC özeti. Google ile açılan hesaplar doğrulanmış sayılır ve şifresiz oldukları için sıfırlama kodu almaz.
