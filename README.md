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
| Güvenlik | Giriş/çıkış kayıtları, aktif oturumlar ve oturum sonlandırma, şifre değiştirme (diğer oturumlar kapanır), hatalı denemede kilit + e-posta, yeni IP uyarısı, IBAN/admin e-posta değişikliği uyarısı, iade kaydı |

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

Testler demo modunda tüm akışı uçtan uca dener: sohbet → anlaşma → üretim → revizyon → demo → müşteri onayı → IBAN → ödeme → fatura → iade, admine aktarma, giriş kilidi, tarama kapsamı.

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
               notify.js (e-posta), whatsapp.js, settings.js, platforms/
public/        index.html + app.js (admin paneli), chat.html (müşteri sohbeti)
test/          uçtan uca testler
```
