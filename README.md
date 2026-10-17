# Freelance Otomasyon

Freelancerlar için yapay zeka destekli CRM + otomatik yazılım üretim sistemi.

**1. Bölüm – Yapay zekalı CRM:** WhatsApp/web sohbetinden gelen müşterilere yapay zeka bir satış temsilcisi gibi cevap verir, fiyat tablosuna göre fiyat verir, örnek ürünleri gösterir. Müşteri memnun kalmazsa, yetkili isterse, yapay zekanın token bütçesi/kredisi biterse veya bir hata olursa konuşma **admine aktarılır ve e-posta gönderilir**; admin konuşmayı panelden devralıp kendisi yönetir.

**2. Bölüm – İş bulma ve otomatik üretim:** Freelancer platformları admin'in belirlediği kapsamda taranır. İlanda iletişim bilgisi varsa yapay zeka müşteriyle iletişime geçer, yoksa admine e-posta gider. İş alınınca yapay zeka istenen ürünü üretir, arada admine haber verir, bitince kontrole sunar. Admin düzeltme isterse yapay zeka yeni sürüm üretir. Onaylanan sürüm demo olarak internete yayınlanır, müşteriye gönderilir; müşteri beğenirse IBAN/ödeme bilgisi otomatik iletilir, ödeme alınınca fatura kesilir.

## Özellikler

| Alan | Neler var |
|---|---|
| Satış asistanı | WhatsApp Cloud API webhook'u, web sohbet sayfası (`/chat`), fiyat tablosuna bağlı fiyatlandırma, indirim sınırı, örnek/demo linkleri, anlaşma sağlanınca otomatik proje açma |
| Admine aktarma | Müşteri yetkili isterse, art arda memnuniyetsizlik, aylık token bütçesi dolarsa, API kredisi biterse / limit / hata / ret durumunda; admin "Konuşmayı devral" / "Yapay zekaya devret" |
| Kısayollar | Temalar, programlama dilleri ve örnek ürünler hem admin sohbet ekranında hem müşteri sohbetinde tek tık kısayol |
| Platform tarama | Demo, Freelancer.com (açık API), herhangi bir RSS beslemesi; anahtar kelime, hariç kelime, bütçe aralığı, para birimi, ilan yaşı, tarama başına limit |
| Proje üretimi | Plan → kod üretimi (Claude), sürüm geçmişi, imzalı önizleme linkleri, admin düzeltme döngüsü, demo yayını (`/demo/...`), müşteri onayı / değişiklik talebi |
| Ödeme | IBAN ile otomatik ödeme talebi (referans kodlu), isteğe bağlı Stripe kart ödemesi + webhook, ödeme geçmişi, kısmi/tam iade, satış ve iade faturaları (PDF) |
| CRM / raporlar | Aylık net/brüt ciro, gider (yapay zeka maliyeti otomatik), kâr, yeni müşteri, dönüşüm, 12 aylık grafik, ürün performansı, yapay zeka durum değerlendirmesi ve çözüm önerileri, aylık PDF özet |
| Güvenlik | İki adımlı doğrulama (QR + kurtarma kodları), roller (Yönetici / Operatör / İzleyici), denetim kaydı, şifremi unuttum, oturum yönetimi, IP izin listesi, hız sınırları, şüpheli işlem uyarıları, yedek ve CSV — ayrıntılar aşağıda |
| Zamanlanmış görevler | 10 otomatik görev: tarama, takip mesajı, ödeme hatırlatma, günlük özet, aylık PDF rapor, yedek, güvenlik taraması… — ayrıntılar aşağıda |

## Arayüz

Koyu kenar menülü, açık/koyu/sistem temalı (üst çubuktaki düğmeyle değişir) modern bir panel; mobilde açılır menü. Yazı tipi (Inter) ve ikonlar (Lucide) sunucunun kendisinden servis edilir, dışarıya istek atılmaz. Müşteri sohbet sayfası (`/chat`) "yazıyor…" göstergesi ve hızlı seçim düğmeleriyle bir sohbet penceresi görünümündedir.

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
| Cevapsız müşteriye takip | Saatlik | 24 saat cevap vermeyen müşteriye yapay zeka nazik bir takip mesajı yazar |
| Ödeme hatırlatmaları | Her gün 10:00 | Bekleyen ödemelere IBAN bilgisiyle hatırlatma; vadesi geçenleri admine bildirir |
| Bekleyen konuşma uyarısı | 30 dk | Admine aktarılıp yanıtlanmayan konuşmalar için tekrar uyarır |
| Günlük özet | Her gün 08:30 | Dünkü satış, konuşma, ilan, ödeme ve güvenlik olaylarını e-postayla özetler |
| Aylık rapor | Her ayın 1'i 09:00 | Geçen ayın PDF raporunu yapay zeka yorumuyla e-postaya ekler |
| Yapay zeka bütçe takibi | Saatlik | Token bütçesinin %80'i ve %100'ü aşılınca ayda bir kez uyarır |
| Güvenlik taraması | 30 dk | Olağan dışı iade, çoklu IP, azalan kurtarma kodu, sık yedek indirme |
| Veritabanı yedeği | Her gün 03:00 | `data/backups` içine yedek alır, son 14 taneyi tutar |
| Temizlik | Her gün 04:00 | Süresi dolmuş oturum/doğrulama kayıtlarını, eski bildirim ve logları siler |

## Kurulum

Gereksinim: **Node.js 22.13+** (yerleşik SQLite kullanılır, ayrı veritabanı kurmanız gerekmez).

```bash
npm install
cp .env.example .env      # anahtarları doldurun
npm run seed              # örnek ürün, tema ve dilleri ekler (isteğe bağlı)
npm start                 # http://localhost:3000
```

İlk açılışta tarayıcıda yönetici hesabını oluşturursunuz (veya `.env` içinde `ADMIN_PASSWORD` verin).
Ardından **Ayarlar** sayfasından IBAN, admin e-postası, yapay zeka ve tarama kapsamını girin; **Ürün & fiyatlar** sayfasından fiyat tablonuzu, temaları ve dilleri düzenleyin.

`ANTHROPIC_API_KEY` tanımlı değilse sistem **demo modunda** çalışır: yapay zeka yanıtları basit kurallarla üretilir, böylece tüm akışı ücretsiz deneyebilirsiniz.

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
- **Platformlar:** `src/services/platforms/` altına `{ name, label, fetchLeads(scope) }` biçiminde yeni bir dosya ekleyip `index.js`'e kaydederek yeni platform eklenebilir.

## Bilmeniz gerekenler

- **Platform kuralları:** Upwork, Fiverr, Bionluk gibi platformların çoğu otomatik tarama ve platform dışı iletişimi yasaklar. Hazır gelen adaptörler yalnızca açık API (Freelancer.com) ve RSS kullanır; platform üzerinden mesajlaşma gereken ilanlar admine bırakılır. Yeni bir adaptör eklerken ilgili platformun kullanım şartlarına uyun.
- **Fatura:** Sistem fatura belgesi (PDF) üretir ama resmi e-Fatura/e-Arşiv değildir; yasal yükümlülükler için bir entegratör kullanın.
- **Havale iadeleri:** IBAN ile alınan bir ödemeyi iade ettiğinizde sistem kaydı ve iade belgesini oluşturur, parayı bankanızdan sizin göndermeniz gerekir. Stripe ödemelerinde iade otomatik yapılır.
- **Demolar:** Yapay zekanın ürettiği siteler `sandbox` CSP başlığıyla sunulur; panelin oturum çerezlerine erişemezler. Dilerseniz `PUBLIC_URL` için ayrı bir alt alan adı kullanın.
- **Yedekleme:** Tüm veriler `DATA_DIR` (varsayılan `data/`) klasöründedir; düzenli yedekleyin.
- **Sunucu gerektiren projeler** (Laravel, Django vb.): yapay zeka kaynak kodunu ve statik bir önizlemeyi üretir; canlı sunucuya kurulumu admin yapar.

## Proje yapısı

```
src/
  server.js, app.js, config.js, db.js, seed.js
  routes/      auth.js, admin.js (panel API), public.js (webhook, sohbet, demo)
  services/    ai.js (Claude), sales.js (satış asistanı), projects.js (üretim/demo),
               payments.js, reports.js (istatistik, PDF), scanner.js, security.js,
               totp.js (2FA), ratelimit.js, scheduler.js + jobs.js (zamanlanmış görevler),
               notify.js (e-posta), whatsapp.js, settings.js, platforms/
public/        index.html + app.js (admin paneli), chat.html + chat.js + chat.css (müşteri sohbeti),
               styles.css (tasarım sistemi: açık/koyu tema, Inter yazı tipi, Lucide ikonları)
test/          uçtan uca testler
```
