<p align="center"><img src="public/brand/kalfa-logo.svg" alt="Kalfa" height="64"></p>

# Kalfa

> **Müşteri bulma kalfanız.**

Kalfa, freelancerlar için bir **müşteri bulma aracıdır**. Kendi bilgisayarınızda çalışır, yapay zeka kullanmaz, ücretli bir servise ihtiyaç duymaz.

1. **İş ilanları:** Freelancer.com, R10.net, RSS beslemeleri ve izlediğiniz herhangi bir ilan sayfası düzenli taranır; anahtar kelimelerinize uyan yeni ilanlar listelenir, puanlanır ve size bildirilir. Bionluk, Armut gibi giriş gerektiren sitelerdeki ilanları tarayıcıdaki **"Kalfa'ya ekle"** yer imiyle tek tıkla kaydedersiniz.
2. **Bölge taraması:** Çevrenizdeki işletmeler (kuaför, diş kliniği, restoran, emlakçı…) haritada bulunur, web siteleri tek tek incelenir (site yok mu, sadece Instagram mı, eski mi, mobil uyumlu mu) ve "web sitesine ihtiyacı var mı?" diye 0–100 puanlanır.
3. **Yazma ve takip:** Her ilan ve işletme için hazır mesaj şablonunuz doldurulur. E-postayla gönderir, WhatsApp'ta açar veya kopyalayıp sitede teklif olarak verirsiniz. Gelen cevaplar Konuşmalar'da toplanır; cevap beklettiğiniz kişiler için hatırlatma gelir.

## Özellikler

| Alan | Neler var |
|---|---|
| İlan kaynakları | Freelancer.com (açık API), R10.net ve herkese açık her ilan sayfası (sayfa izleme, isteğe bağlı bağlantı filtresi), RSS/Atom (sayfada RSS varsa otomatik kullanılır), "Kalfa'ya ekle" yer imi (Bionluk, Armut, Upwork, Fiverr…), elle ilan ekleme |
| İlan filtresi | Anahtar kelime, hariç kelime, bütçe aralığı, para birimi, ilan yaşı; uygunluk puanı (başlıkta kelime, bütçe, iletişim bilgisi, yenilik); ilan metnindeki e-posta ve telefon otomatik bulunur |
| İlan takibi | Yeni → Yazıldı → Cevap verdi → Kazanıldı / Kaybedildi; notlar, CSV dışa aktarma |
| Bölge taraması | OpenStreetMap (ücretsiz) veya Google Places; harita, site incelemesi, kural tabanlı puan, zincir marka eleme, mesaj taslağı; günlük gönderim sınırı, İPTAL yazanları kalıcı engelleme |
| Mesaj şablonları | İşletme (site yok / sadece sosyal medya / eski site) ve ilan mesajları; `{ad}`, `{ilan}`, `{bulgu}`, `{isletmem}` gibi alanlar otomatik dolar |
| Konuşmalar | E-posta (SMTP + IMAP ile cevaplar otomatik gelir), WhatsApp (wa.me ile kendi telefonunuzdan veya Cloud API), elle gelen mesaj ekleme, cevap bekleyen hatırlatması |
| Güvenlik | İki adımlı doğrulama, roller (Yönetici / Operatör / İzleyici), denetim kaydı, oturum yönetimi, IP izin listesi, hız sınırları, şüpheli giriş uyarıları, yedek |
| Zamanlanmış görevler | İlan taraması, bölge taraması, gelen e-postalar, cevap bekleyen uyarısı, günlük özet, güvenlik taraması, yedek, temizlik |

## İlan siteleri nasıl çalışır?

| Site | Nasıl | Not |
|---|---|---|
| **Freelancer.com** | Otomatik (açık API) | Anahtar kelimeleriniz arama sorgusu olur. Teklifi sitede verirsiniz. |
| **R10.net** | Sayfa izleme | Hizmet alım bölümünün adresini **Kaynaklar → R10.net → Sayfa ekle** ile girin; gerekirse bağlantı filtresi olarak konu adreslerinde geçen bir parça yazın. |
| **Bionluk** | Yer imi | Alıcı istekleri yalnızca giriş yapmış freelancerlara gösterilir ve sayfa tarayıcıda oluşturulur; otomatik okunamaz. İsteği açıp "Kalfa'ya ekle"ye tıklayın. |
| **Armut** | Yer imi | Talepler yalnızca hizmet veren hesabında (Armut Pro) görünür. Talebi açıp "Kalfa'ya ekle"ye tıklayın; teklifi Armut'ta verirsiniz. |
| **Hallederim** | Sayfa izleme veya yer imi | İlan listesi herkese açıksa adresini ekleyin, değilse yer imini kullanın. |
| **Diğer siteler** | Sayfa izleme / RSS / yer imi | Herkese açık her ilan listesi eklenebilir. Kaynak eklerken **Dene** düğmesi neyin okunduğunu gösterir. |

**"Kalfa'ya ekle" yer imi:** Kaynaklar sayfasındaki düğmeyi tarayıcınızın yer imleri çubuğuna sürükleyin. Bir ilan sayfasında (isterseniz açıklamayı fareyle seçip) yer imine tıklayınca Kalfa'da ilanın adresi, başlığı ve metni dolu bir "İlan ekle" formu açılır; içindeki e-posta/telefon otomatik bulunur.

> Sitelerin kullanım koşullarına uyun. Kalfa giriş gerektiren sayfalara erişmeye çalışmaz, şifrenizi istemez; herkese açık sayfaları seyrek okur (varsayılan: 30 dakikada bir).

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
2. **Ayarlar → İşletme**'den adınızı, telefonunuzu ve bildirim e-postanızı girin (mesaj imzasında kullanılır).
3. **Ayarlar → İş ilanları**'ndan anahtar kelimelerinizi yazın (ör. web sitesi, wordpress, e-ticaret).
4. **Kaynaklar** sayfasından izlemek istediğiniz ilan sayfalarını ekleyin ve "Kalfa'ya ekle" yer imini tarayıcınıza sürükleyin.
5. **Bölge taraması** sayfasında semtinizi yazıp **Tara**'ya basın.

Durdurmak için terminalde `Ctrl+C`. Tekrar başlatmak için yalnızca `npm start` (veya çift tıklama) yeterli; verileriniz `data/` klasöründe kalır.

| Komut | Ne yapar |
|---|---|
| `npm start` | Uygulamayı başlatır |
| `npm run dev` | Kod değiştikçe kendini yeniden başlatır (geliştirme için) |
| `npm run setup` | İlk kurulum (.env + varsayılan kaynak); tekrar çalıştırmak zararsızdır |
| `npm test` | Tüm testleri çalıştırır |

### E-posta ve diğer ayarlar

Hiçbir ayar girmeden uygulama tam çalışır; yalnızca e-postalar gönderilmez, terminal penceresine yazılır. Proje klasöründeki `.env` dosyasını bir metin düzenleyiciyle açıp doldurun, sonra uygulamayı yeniden başlatın:

- `SMTP_*` — işletmelere / ilan sahiplerine e-posta göndermek ve size bildirim gelmesi için (ör. Gmail uygulama şifresi).
- `IMAP_*` — size e-postayla gelen cevapları Konuşmalar'a eklemek için (Gmail: `imap.gmail.com`, aynı uygulama şifresi).
- `GOOGLE_PLACES_API_KEY` — bölge taramasında daha çok işletme bilgisi için (isteğe bağlı, ücretli).
- `WHATSAPP_*` — WhatsApp Cloud API (isteğe bağlı). Yoksa WhatsApp mesajları tek tıkla kendi WhatsApp'ınızdan gönderilir.

Ayarlar → İşletme sayfasının en üstündeki **Bağlantılar** listesi hangilerinin hazır olduğunu gösterir.

### Sık karşılaşılan sorunlar

| Belirti | Çözüm |
|---|---|
| "Kalfa için Node.js 22.13 veya üzeri gerekiyor" | Node.js'in güncel LTS sürümünü kurun, terminali yeniden açın. |
| "3000 portu başka bir uygulama tarafından kullanılıyor" | `.env` içinde `PORT=3001` ve `PUBLIC_URL=http://localhost:3001` yazın. |
| `npm` komutu bulunamıyor (Windows) | Node.js kurulumundan sonra bilgisayarı veya terminali yeniden başlatın. |
| Şifremi unuttum, e-posta gelmiyor | SMTP ayarlı değilse sıfırlama bağlantısı terminal penceresine yazılır. |
| Her şeyi sıfırlamak istiyorum | Uygulamayı durdurun, `data/` klasörünü silin, `npm run setup` çalıştırın. |

WhatsApp Cloud API webhook'u internetten erişilebilir bir adres ister; gerekirse [ngrok](https://ngrok.com) veya Cloudflare Tunnel ile `PUBLIC_URL`'i dışarı açabilirsiniz. Bu olmadan da her şey çalışır.

### Testler

```bash
npm test
```

Testler dış servisleri taklit ederek tüm akışı dener: Freelancer.com / sayfa / RSS kaynakları, filtre ve puanlama, yer imiyle ekleme, ilan sahibine yazma, bölge taraması ve site incelemesi, İPTAL ile engelleme, IMAP cevapları; 2FA, roller, denetim kaydı, oturum zaman aşımı, IP listesi, şifre sıfırlama, hız sınırı; zamanlanmış görevler ve saat dilimi hesapları.

## Bilmeniz gerekenler

- **Ticari ileti kuralları:** Türkiye'de işletmelere izinsiz tanıtım mesajı göndermek 6563 sayılı kanun / İYS ve KVKK kapsamındadır; WhatsApp da istenmeyen mesajları kısıtlar. Bu yüzden Kalfa varsayılan olarak hiçbir şeyi kendiliğinden göndermez: her mesajı siz onaylarsınız, günlük gönderim sınırı vardır, işletme mesajlarının sonuna "İPTAL yazın" cümlesi eklenir ve İPTAL yazanların telefonu/e-postası kalıcı olarak engellenir. Kurallara uymak sizin sorumluluğunuzdadır.
- **OpenStreetMap:** Ücretsiz Nominatim ve Overpass servisleri kullanılır; yoğun kullanımda kendi sunucunuzu `NOMINATIM_URL` / `OVERPASS_URL` ile verebilirsiniz.
- **Güvenlik:** İşletme siteleri ve izlenen sayfalar okunurken yerel ağ adreslerine istek atılmaz.
- **Yedekleme:** Tüm veriler `DATA_DIR` (varsayılan `data/`) klasöründedir; günlük yedek `data/backups` içine alınır.

## Proje yapısı

```
src/
  server.js (giriş: Node sürüm kontrolü) → main.js, boot.js, app.js, config.js, db.js, seed.js
  routes/      auth.js, admin.js (panel API), public.js (WhatsApp webhook), assets.js
  services/    sources.js (ilan kaynakları, filtre, puan), prospecting.js (bölge taraması),
               inbox.js (konuşmalar), templates.js (mesaj şablonları), mailbox.js (IMAP),
               notify.js (e-posta), whatsapp.js, http.js (dış istekler + iç ağ koruması),
               security.js, totp.js (2FA), ratelimit.js, scheduler.js + jobs.js, settings.js
public/        index.html + js/ (panel: core, charts, shell + komut paleti, views/*), styles.css
scripts/       setup.js (npm run setup)
baslat.bat, baslat.command   çift tıklamayla başlatma (Windows / macOS-Linux)
test/          testler
```
