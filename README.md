<p align="center"><img src="public/brand/kalfa-logo.svg" alt="Kalfa" height="64"></p>

# Kalfa

> **Usta sensin, işi Kalfa yapar.**

Kalfa, freelancerlar için yapay zeka destekli bir CRM ve otomatik yazılım üretim sistemidir: müşteriyle satış temsilcisi gibi konuşur, iş ilanlarını tarar, işi geliştirir, demoyu yayınlar ve ödemeyi takip eder.

**1. Bölüm – Yapay zekalı CRM:** WhatsApp/web sohbetinden gelen müşterilere yapay zeka bir satış temsilcisi gibi cevap verir, fiyat tablosuna göre fiyat verir, örnek ürünleri gösterir. Müşteri memnun kalmazsa, yetkili isterse, yapay zekanın token bütçesi/kredisi biterse veya bir hata olursa konuşma **admine aktarılır ve e-posta gönderilir**; admin konuşmayı panelden devralıp kendisi yönetir.

**2. Bölüm – İş bulma ve otomatik üretim:** Freelancer platformları admin'in belirlediği kapsamda taranır. İlanda iletişim bilgisi varsa yapay zeka müşteriyle iletişime geçer, yoksa admine e-posta gider. İş alınınca yapay zeka istenen ürünü üretir, arada admine haber verir, bitince kontrole sunar. Admin düzeltme isterse yapay zeka yeni sürüm üretir. Onaylanan sürüm demo olarak internete yayınlanır, müşteriye gönderilir; müşteri beğenirse IBAN/ödeme bilgisi otomatik iletilir, ödeme alınınca fatura kesilir.

## Özellikler

| Alan | Neler var |
|---|---|
| Satış asistanı | WhatsApp Cloud API webhook'u, web sohbet sayfası (`/chat`), fiyat tablosuna bağlı fiyatlandırma, indirim sınırı, örnek/demo linkleri, anlaşma sağlanınca otomatik proje açma |
| Admine aktarma | Müşteri yetkili isterse, art arda memnuniyetsizlik, aylık token bütçesi dolarsa, API kredisi biterse / limit / hata / ret durumunda; admin "Konuşmayı devral" / "Yapay zekaya devret" |
| Kısayollar | Temalar, programlama dilleri ve örnek ürünler hem admin sohbet ekranında hem müşteri sohbetinde tek tık kısayol |
| Platform tarama | Demo, Freelancer.com (açık API), herhangi bir RSS beslemesi; anahtar kelime, hariç kelime, bütçe aralığı, para birimi, ilan yaşı, tarama başına limit |
| Bölge taraması | Çevrenizdeki işletmeleri (OpenStreetMap, ücretsiz; isteğe bağlı Google Places) haritada bulur, web sitelerini tek tek inceler (site var mı, sadece Instagram mı, HTTPS, mobil uyum, © yılı, hız), yapay zekayla "web sitesine ihtiyacı var mı?" diye 0-100 puanlar ve işletmeye özel mesaj taslağı yazar. E-posta, WhatsApp şablonu veya tek tık "WhatsApp'ta aç" ile gönderim; İPTAL yazanlar kalıcı olarak engellenir |
| Proje üretimi | Plan → kod üretimi (Claude), sürüm geçmişi, imzalı önizleme linkleri, admin düzeltme döngüsü, demo yayını (`/demo/...`), müşteri onayı / değişiklik talebi |
| Ödeme | IBAN ile otomatik ödeme talebi (referans kodlu), isteğe bağlı Stripe kart ödemesi + webhook, ödeme geçmişi, kısmi/tam iade, satış ve iade faturaları (PDF) |
| CRM / raporlar | Aylık net/brüt ciro, gider (yapay zeka maliyeti otomatik), kâr, yeni müşteri, dönüşüm, 12 aylık grafik, ürün performansı, yapay zeka durum değerlendirmesi ve çözüm önerileri, aylık PDF özet |
| Güvenlik | İki adımlı doğrulama (QR + kurtarma kodları), roller (Yönetici / Operatör / İzleyici), denetim kaydı, şifremi unuttum, oturum yönetimi, IP izin listesi, hız sınırları, şüpheli işlem uyarıları, yedek ve CSV — ayrıntılar aşağıda |
| Zamanlanmış görevler | 13 otomatik görev: tarama, takip mesajı, ödeme hatırlatma, günlük özet, aylık PDF rapor, yedek, güvenlik taraması… — ayrıntılar aşağıda |

## Marka

| Dosya | Kullanım |
|---|---|
| `public/brand/kalfa-mark.svg` | Uygulama ikonu / favicon (degrade zeminli "K") |
| `public/brand/kalfa-logo.svg` | İkon + "kalfa" yazısı (açık zemin) |
| `public/brand/kalfa-glyph.svg` | Tek renkli işaret (`currentColor`), koyu zeminler ve baskı için |

Logo, "K" harfi ile üst köşedeki yapay zeka kıvılcımından oluşur: ustanın yanında işi yapan kalfa. Renkler: `#7C5CFF` → `#D45CFF` degrade; yazı Geist SemiBold.

## Arayüz

Modern, çerçevesiz (Bootstrap vb. kullanılmadan) kendi tasarım sistemiyle yazılmış bir panel:

- **Görsel dil:** Geist yazı tipi, nötr tonlar, yalnızca yapay zeka öğelerinde kullanılan mor vurgu; uygulama yumuşak bir zemin üzerinde yüzen bir yüzeyde durur. Açık / koyu / sistem teması.
- **⌘K / Ctrl+K komut paleti:** sayfalara, müşterilere, projelere ve konuşmalara arayarak gidin; "Şimdi tara", "Yeni proje", "Yapay zeka analizi", tema değiştirme gibi komutları klavyeden çalıştırın. `/` tuşu sayfadaki aramaya odaklanır.
- **Genel bakış:** önceki aya göre değişim yüzdeli kartlar, ciro alan grafiği, ciro/gider grafiği, satış hunisi, proje hattı, son etkinlikler ve yapay zeka içgörü kartı.
- **Konuşmalar:** gelen kutusu + sohbet + müşteri bilgi paneli; Enter ile gönderme, tema/dil/ürün kısayolları.
- **Projeler:** Kanban panosu veya liste; proje sayfasında aşama göstergesi, "sıradaki adım" kartı, yapay zekaya düzeltme gönderme, sürümler ve geçmiş.
- **İş ilanları ve katalog** kart görünümünde; tüm listelerde anlık arama; onay ve formlar için modal pencereler; daraltılabilir menü; mobil uyumlu.
- Yazı tipi ve ikonlar (Lucide) sunucudan servis edilir, dışarıya istek atılmaz. Müşteri sohbet sayfası (`/chat`) aynı tasarım dilindedir.

## Güvenlik

- **İki adımlı doğrulama (2FA):** Güvenlik sayfasından QR kodu Google/Microsoft Authenticator veya Authy ile okutun. Girişte şifreden sonra 6 haneli kod istenir; kullanılmış kod tekrar kabul edilmez. 8 adet tek kullanımlık kurtarma kodu verilir. Ayarlar'dan yöneticiler için 2FA zorunlu yapılabilir.
- **Ekip ve roller:** *Yönetici* her şeyi yapar. *Operatör* konuşma, ilan, proje, müşteri ve ürünlerle çalışır; ödeme onayı, iade, ayar, ekip, yedek işlemlerini yapamaz. *İzleyici* yalnızca görüntüler. Yetkiler sunucu tarafında kontrol edilir; menüde yalnızca izin verilen sayfalar görünür.
- **Denetim kaydı:** Panelden yapılan her değişiklik kim, ne zaman, hangi IP'den ve sonucuyla kaydedilir; şifre, kod, token ve IBAN alanları maskelenir.
- **Giriş koruması:** Hesap başına ve IP başına hatalı deneme sınırı (aşılınca 15 dk kilit + e-posta), giriş uç noktalarında hız sınırı, yeni IP'den girişte uyarı, hareketsiz oturumun otomatik kapanması, isteğe bağlı IP izin listesi.
- **Şifre:** Şifremi unuttum (30 dk geçerli, tek kullanımlık e-posta bağlantısı; hesap var mı yok mu belli etmez), şifre değişince diğer oturumların kapanması, yöneticinin ekip üyesine şifre ataması veya 2FA'sını sıfırlaması.
- **Şüpheli işlem uyarıları:** IBAN veya admin e-postası değişikliği, yüksek tutarlı iade, günde çok sayıda iade, bir hesabın aynı anda çok sayıda IP'den kullanılması, 2FA'nın kapatılması, kurtarma koduyla giriş, yedek indirilmesi.
- **Diğer:** Sıkı güvenlik başlıkları (CSP, HSTS, nosniff), JSON dışı istekleri reddeden CSRF koruması, müşteri sohbetinde spam sınırı, panelden veritabanı yedeği ve CSV dışa aktarma (Excel formül enjeksiyonuna karşı korumalı).

## Zamanlanmış görevler

"Zamanlanmış görevler" sayfasından her görev açılıp kapatılabilir, zamanı (aralıklı / her gün / her ay) değiştirilebilir, elle çalıştırılabilir ve çalışma geçmişi görülebilir. Saatler Ayarlar'daki saat dilimine göredir (varsayılan Europe/Istanbul). Eşikler Ayarlar → Otomasyon bölümündedir. Başarısız olan her görev admine bildirilir.

| Görev | Varsayılan | Ne yapar |
|---|---|---|
| Freelancer platform taraması | 30 dk (`SCANNER_ENABLED=1` ile açık) | İlanları tarar, müşteriye yazar veya admine bildirir |
| Bölge taraması | Her gün 10:30 (kapalı başlar) | Kayıtlı bölgeyi tarar, yeni işletmeleri puanlar; "Otomatik gönder" açıksa günlük sınır içinde yazar |
| Gelen e-postalar | 2 dk | IMAP gelen kutusundaki cevapları konuşmalara ekler (yalnızca tanıdık adresler) |
| Kart ödemesi kontrolü | 5 dk | Bekleyen Stripe ödemelerini sorgular; webhook gerekmez |
| Cevapsız müşteriye takip | Saatlik | 24 saat cevap vermeyen müşteriye yapay zeka nazik bir takip mesajı yazar |
| Ödeme hatırlatmaları | Her gün 10:00 | Bekleyen ödemelere IBAN bilgisiyle hatırlatma; vadesi geçenleri admine bildirir |
| Bekleyen konuşma uyarısı | 30 dk | Admine aktarılıp yanıtlanmayan konuşmalar için tekrar uyarır |
| Günlük özet | Her gün 08:30 | Dünkü satış, konuşma, ilan, ödeme ve güvenlik olaylarını e-postayla özetler |
| Aylık rapor | Her ayın 1'i 09:00 | Geçen ayın PDF raporunu yapay zeka yorumuyla e-postaya ekler |
| Yapay zeka bütçe takibi | Saatlik | Token bütçesinin %80'i ve %100'ü aşılınca ayda bir kez uyarır |
| Güvenlik taraması | 30 dk | Olağan dışı iade, çoklu IP, azalan kurtarma kodu, sık yedek indirme |
| Veritabanı yedeği | Her gün 03:00 | `data/backups` içine yedek alır, son 14 taneyi tutar |
| Temizlik | Her gün 04:00 | Süresi dolmuş oturum/doğrulama kayıtlarını, eski bildirim ve logları siler |

## Bilgisayarınızda çalıştırma

Ayrı bir veritabanı, Docker veya sunucu kurmanız gerekmez; her şey tek klasörde çalışır.

### 1. Node.js kurun (bir kez)

[nodejs.org](https://nodejs.org) adresinden **LTS** sürümünü indirip kurun (en az **22.13**; 24 LTS önerilir).
Kurulumdan sonra terminali kapatıp açın ve kontrol edin:

```bash
node -v      # v22.13 veya üzeri görmelisiniz
```

### 2. Projeyi indirin

```bash
git clone https://github.com/codeslh/curfeidtask.git kalfa
cd kalfa
git checkout ccr-6bf895f3-gn9pwm   # (birleştirilene kadar kod bu dalda)
```

Git kullanmıyorsanız GitHub'da **Code → Download ZIP** ile indirip bir klasöre açın.

### 3a. En kolay yol: çift tıklayın

| Sistem | Dosya |
|---|---|
| Windows | `baslat.bat` |
| macOS | `baslat.command` (ilk seferde sağ tık → Aç) |
| Linux | terminalde `sh baslat.command` |

Betik gerekirse bağımlılıkları kurar, ilk kurulumu yapar, sunucuyu başlatır ve tarayıcıyı açar.

### 3b. Terminalden

```bash
npm install        # bağımlılıklar (ilk seferde)
npm run setup      # .env dosyasını ve örnek ürün/tema/teknolojileri oluşturur (ilk seferde)
npm start          # sunucuyu başlatır
```

Ardından tarayıcıda **http://localhost:3000** adresini açın:

1. İlk açılışta yönetici hesabınızı oluşturun.
2. **Ayarlar → İşletme**'den işletme adınızı, IBAN'ınızı ve bildirim e-postanızı girin.
3. **Katalog**'dan fiyat tablonuzu düzenleyin.
4. Müşteri gözünden denemek için **http://localhost:3000/chat** adresini açıp yazışın.

Durdurmak için terminalde `Ctrl+C`. Tekrar başlatmak için yalnızca `npm start` (veya çift tıklama) yeterli; verileriniz `data/` klasöründe kalır.

| Komut | Ne yapar |
|---|---|
| `npm start` | Uygulamayı başlatır |
| `npm run dev` | Kod değiştikçe kendini yeniden başlatır (geliştirme için) |
| `npm run setup` | İlk kurulum (.env + örnek veriler); tekrar çalıştırmak zararsızdır |
| `npm test` | Tüm testleri çalıştırır |

### Yapay zeka, e-posta ve diğer anahtarlar

Hiçbir anahtar girmeden uygulama **demo modunda** tam çalışır: yapay zeka cevapları basit kurallarla üretilir, e-postalar terminal penceresine yazılır ve panelde bildirim olarak görünür. Gerçek kullanım için proje klasöründeki `.env` dosyasını bir metin düzenleyiciyle açıp doldurun, sonra uygulamayı yeniden başlatın:

- `ANTHROPIC_API_KEY` — gerçek yapay zeka (Claude). [console.anthropic.com](https://console.anthropic.com) üzerinden alınır.
- `SMTP_*` — size bildirim e-postası gitmesi için (ör. Gmail uygulama şifresi).
- `IMAP_*` — müşterilerin e-postayla verdiği cevapları okumak için (Gmail: `imap.gmail.com`, aynı uygulama şifresi).
- `WHATSAPP_*`, `STRIPE_*`, `NETLIFY_TOKEN`, `GOOGLE_PLACES_API_KEY` — isteğe bağlı entegrasyonlar (aşağıda).

Ayarlar → İşletme sayfasının en üstündeki **Bağlantılar** listesi hangilerinin hazır olduğunu gösterir.

### Kendi bilgisayarınızda neler çalışır?

Her şey. İnternetten size gelen istek (webhook) gereken yerler için yerel alternatifler var:

| Özellik | Sunucuda | Bilgisayarınızda |
|---|---|---|
| WhatsApp | Cloud API webhook'u | **Aracı modu:** müşterinin mesajını konuşmaya "Müşteri mesajı ekle" ile yapıştırırsınız, yapay zekanın cevabını balonun altındaki "WhatsApp'ta gönder" ile kendi WhatsApp'ınızdan iletirsiniz |
| E-posta cevapları | IMAP | IMAP (aynı) — 2 dakikada bir okunur |
| Kart ödemesi | Stripe webhook | Stripe durumu 5 dakikada bir sorgulanır |
| Demo yayını | `PUBLIC_URL/demo/...` | `NETLIFY_TOKEN` girerseniz demo otomatik olarak `*.netlify.app` adresine yüklenir; girmezseniz demo yalnızca sizin bilgisayarınızda açılır (proje sayfasında uyarı çıkar) |
| Bölge taraması | OpenStreetMap | OpenStreetMap (aynı), ek kurulum yok |

### Sık karşılaşılan sorunlar

| Belirti | Çözüm |
|---|---|
| "Kalfa için Node.js 22.13 veya üzeri gerekiyor" | Node.js'in güncel LTS sürümünü kurun, terminali yeniden açın. |
| "3000 portu başka bir uygulama tarafından kullanılıyor" | `.env` içinde `PORT=3001` ve `PUBLIC_URL=http://localhost:3001` yazın. |
| `npm` komutu bulunamıyor (Windows) | Node.js kurulumundan sonra bilgisayarı veya terminali yeniden başlatın. |
| Şifremi unuttum, e-posta gelmiyor | SMTP ayarlı değilse sıfırlama bağlantısı terminal penceresine yazılır. |
| Her şeyi sıfırlamak istiyorum | Uygulamayı durdurun, `data/` klasörünü silin, `npm run setup` çalıştırın. |

WhatsApp ve Stripe webhook'ları internetten erişilebilir bir adres ister; yerelde denemek için [ngrok](https://ngrok.com) veya Cloudflare Tunnel ile `PUBLIC_URL`'i dışarı açabilirsiniz.

### Testler

```bash
npm test
```

Testler demo modunda tüm akışı uçtan uca dener: sohbet → anlaşma → üretim → revizyon → demo → müşteri onayı → IBAN → ödeme → fatura → iade, admine aktarma, tarama kapsamı; 2FA, roller, denetim kaydı, oturum zaman aşımı, IP listesi, şifre sıfırlama, hız sınırı; tüm zamanlanmış görevler ve saat dilimi hesapları.

## Entegrasyonlar

- **Claude (yapay zeka):** `ANTHROPIC_API_KEY`. Varsayılan model `claude-opus-5-5`. Güvenlik nedeniyle reddedilen istekler sunucu tarafında otomatik yedek modele yönlendirilir (`fallbacks: "default"`). Token kullanımı ve maliyeti **Giderler** sayfasında görünür; aylık token bütçesi Ayarlar'dan sınırlanır.
- **WhatsApp:** Meta Business'ta bir WhatsApp Cloud API uygulaması açın, webhook adresi `https://alanadiniz.com/webhooks/whatsapp`, doğrulama kelimesi `WHATSAPP_VERIFY_TOKEN`. `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET` girin.
- **E-posta:** SMTP bilgileri. Girilmezse bildirimler konsola yazılır ve panelde görünmeye devam eder.
- **Stripe (isteğe bağlı):** Ayarlar → Ödeme → "Stripe" seçin, `STRIPE_SECRET_KEY` ve webhook (`/webhooks/stripe`, olay: `checkout.session.completed`) için `STRIPE_WEBHOOK_SECRET` girin. Para doğrudan sizin Stripe hesabınıza gelir. Havale/EFT ödemelerini panelden "Ödendi işaretle" ile onaylarsınız.
- **Bölge taraması:** Varsayılan kaynak OpenStreetMap'tir (Nominatim + Overpass, anahtar gerekmez; yoğun kullanımda kendi Overpass sunucunuzu `OVERPASS_URL` ile verebilirsiniz). Google Places daha çok işletme ve telefon bilgisi verir; `GOOGLE_PLACES_API_KEY` girip kaynak olarak seçin (ücretlidir). WhatsApp'tan *otomatik* ilk mesaj için Meta'da onaylı bir şablon gerekir: `WHATSAPP_OUTREACH_TEMPLATE` (gövdesinde `{{1}}` = işletme adı) ve `WHATSAPP_TEMPLATE_LANG`.
- **Netlify:** app.netlify.com → User settings → Applications → Personal access token; `NETLIFY_TOKEN` olarak girin. Her proje kendi sitesine yüklenir, yeniden yayında aynı adres kullanılır.
- **Platformlar:** `src/services/platforms/` altına `{ name, label, fetchLeads(scope) }` biçiminde yeni bir dosya ekleyip `index.js`'e kaydederek yeni platform eklenebilir.

## Bilmeniz gerekenler

- **Platform kuralları:** Upwork, Fiverr, Bionluk gibi platformların çoğu otomatik tarama ve platform dışı iletişimi yasaklar. Hazır gelen adaptörler yalnızca açık API (Freelancer.com) ve RSS kullanır; platform üzerinden mesajlaşma gereken ilanlar admine bırakılır. Yeni bir adaptör eklerken ilgili platformun kullanım şartlarına uyun.
- **Bölge taraması ve ticari ileti kuralları:** Türkiye'de işletmelere izinsiz tanıtım mesajı göndermek 6563 sayılı kanun / İYS ve KVKK kapsamındadır; WhatsApp da istenmeyen mesajları kısıtlar. Bu yüzden Kalfa varsayılan olarak hiçbir şeyi kendiliğinden göndermez: her mesajı siz onaylarsınız, günlük gönderim sınırı vardır, her mesajın sonuna "İPTAL yazın" cümlesi eklenir ve İPTAL yazanların telefonu/e-postası kalıcı olarak engellenir. Zincir markalar düşük puan alır. Kurallara uymak sizin sorumluluğunuzdadır. İşletme siteleri incelenirken yerel ağ adreslerine istek atılmaz.
- **Fatura:** Sistem fatura belgesi (PDF) üretir ama resmi e-Fatura/e-Arşiv değildir; yasal yükümlülükler için bir entegratör kullanın.
- **Havale iadeleri:** IBAN ile alınan bir ödemeyi iade ettiğinizde sistem kaydı ve iade belgesini oluşturur, parayı bankanızdan sizin göndermeniz gerekir. Stripe ödemelerinde iade otomatik yapılır.
- **Demolar:** Yapay zekanın ürettiği siteler `sandbox` CSP başlığıyla sunulur; panelin oturum çerezlerine erişemezler. Dilerseniz `PUBLIC_URL` için ayrı bir alt alan adı kullanın.
- **Yedekleme:** Tüm veriler `DATA_DIR` (varsayılan `data/`) klasöründedir; düzenli yedekleyin.
- **Sunucu gerektiren projeler** (Laravel, Django vb.): yapay zeka kaynak kodunu ve statik bir önizlemeyi üretir; canlı sunucuya kurulumu admin yapar.

## Proje yapısı

```
src/
  server.js (giriş: Node sürüm kontrolü) → main.js, boot.js, app.js, config.js, db.js, seed.js
  routes/      auth.js, admin.js (panel API), public.js (webhook, sohbet, demo)
  services/    ai.js (Claude), sales.js (satış asistanı), projects.js (üretim/demo),
               payments.js, reports.js (istatistik, PDF), scanner.js, security.js,
               totp.js (2FA), ratelimit.js, scheduler.js + jobs.js (zamanlanmış görevler),
               notify.js (e-posta), whatsapp.js, settings.js, platforms/,
               prospecting.js (bölge taraması), mailbox.js (IMAP), deploy.js (Netlify),
               http.js (dış istekler + iç ağ koruması)
public/        index.html + js/ (admin paneli: core, charts, shell + komut paleti, views/*),
               styles.css (tasarım sistemi), chat.html + chat.js + chat.css (müşteri sohbeti)
scripts/       setup.js (npm run setup)
baslat.bat, baslat.command   çift tıklamayla başlatma (Windows / macOS-Linux)
test/          uçtan uca testler
```
