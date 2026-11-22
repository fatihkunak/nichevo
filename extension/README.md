# Nichevo X Okuyucu (tarayıcı eklentisi)

Nichevo **web** uygulamasının X (Twitter) sayfalarını senin tarayıcında, senin oturumunla **okumasını** sağlar.
(Telefon uygulaması bunu kendi içindeki tarayıcıyla yapar; web sayfaları tarayıcı güvenlik kuralları yüzünden x.com'u okuyamaz, eklenti bu kuralın içinden izinle geçer.)

## Ne yapar, ne yapmaz
- Nichevo'da X araması / hesap takibi / trend istediğinde küçük bir **görünür pencere** açar, X sayfasını okur ve pencereyi kapatır.
- X'e giriş yapman gerekirse o pencerede yaparsın; giriş **tarayıcında** kalır, şifren Nichevo'ya ya da eklentiye gelmez.
- **Yalnızca okur:** beğenme, takip, paylaşma, mesaj yok. Başka hiçbir siteyi okumaz.
- Yalnızca `https://nichevo.fatihgo.com` ve `http://localhost:8081` sayfalarıyla konuşur; başka sitelerdeki sayfalar eklentiyi kullanamaz.
- Dışarıdan adres ya da kod kabul etmez: gelen görev doğrulanır (arama metni / kullanıcı adı), X adresi eklentinin içinde üretilir.

## Durum ve sınırlar
- **Gerçek X'te ve gerçek (kararlı) Chrome'da denenmedi.** Testler yerel sahte "x.com" ile Playwright'ın paketlenmiş Chromium'unda yapıldı (köprü, okuma, giriş duvarından devam, kötü görevlerin reddi, başka sitelerde köprü yok, Nichevo sekmesi kapanınca iptal). X arayüzü sahte sayfadan farklıysa seçiciler (shared/x-dom.ts) güncellenmeli.
- Chromium tabanlı tarayıcılar için yazıldı; Edge/Brave'de denenmedi.
- Geliştirme içindir: `http://localhost:8081` izinli kaynaklar arasındadır, mağazaya göndermeden önce kaldırılmalı; simge (icons) yok.

## Kurulum (bir kez, Chromium tabanlı tarayıcı)
1. Adres çubuğuna `chrome://extensions` yaz (Edge: `edge://extensions`).
2. Sağ üstten **Geliştirici modu**'nu aç.
3. **Paketlenmemiş öğe yükle**'ye bas ve bu `extension` klasörünü seç.
4. Nichevo'yu yenile. Sosyal > Bağlantı'da X kartı "tarayıcı eklentisi bağlı" yazmalı.

Ayrıca hesap: X için **ana hesabını değil, ayrı bir test hesabı** kullan; platformlar otomatik gezinmeyi hesap kilidiyle cezalandırabilir.

## Geliştirme
`generated/` klasörü `shared/x-dom.ts`'ten üretilir (seçiciler ve okuma betiği tek kaynak, telefon ve sunucuyla ortak):
```bash
npm run build:extension
```
Test (gerçek Chromium'a eklentiyi yükler, sahte yerel "x.com" kullanır): `cd nichevo-backend && npx vitest run test/social-extension.test.ts`
Not: Chrome 137+ kararlı sürümü komut satırından eklenti yüklemeyi kapattı, o yüzden testler Playwright'ın paketlenmiş Chromium'unu kullanır; kullanıcı kurulumu yukarıdaki gibi arayüzden yapılır.
