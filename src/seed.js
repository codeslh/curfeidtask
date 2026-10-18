// Example products, themes and languages for an empty database.
// Run directly (`npm run seed`) or via `npm run setup`.
import './boot.js';
import { pathToFileURL } from 'node:url';

const { get, insert, openDb } = await import('./db.js');

export function seedDefaults() {
  openDb();
  const added = [];
  if (!get('SELECT id FROM products LIMIT 1')) {
    insert('products', { name: 'Tanıtım Sitesi', category: 'Web', price: 7500, currency: 'TRY', description: '5 sayfaya kadar kurumsal tanıtım sitesi, mobil uyumlu, iletişim formu.', features: 'Ana sayfa, Hakkımızda, Hizmetler, Galeri, İletişim' });
    insert('products', { name: 'Landing Page', category: 'Web', price: 4000, currency: 'TRY', description: 'Kampanya/ürün için tek sayfalık dönüşüm odaklı sayfa.', features: 'Hero, özellikler, SSS, form' });
    insert('products', { name: 'E-Ticaret Sitesi', category: 'E-ticaret', price: 25000, currency: 'TRY', description: 'Ürün listeleme, sepet ve ödeme entegrasyonlu mağaza.', features: 'Ürün yönetimi, sepet, ödeme, kargo takibi' });
    insert('products', { name: 'Özel Web Uygulaması', category: 'Yazılım', price: 40000, currency: 'TRY', description: 'İhtiyaca özel panel/uygulama. Kapsama göre fiyatlandırılır (başlangıç fiyatı).', features: 'Admin paneli, kullanıcı girişi, raporlar' });
    added.push('ürünler');
  }
  if (!get('SELECT id FROM themes LIMIT 1')) {
    insert('themes', { name: 'Minimal', description: 'Beyaz, ferah, tipografi odaklı', style_guide: 'Arka plan #ffffff, metin #111827, vurgu #2563eb, font: Inter/system-ui, bol boşluk' });
    insert('themes', { name: 'Kurumsal', description: 'Lacivert tonlar, güven veren', style_guide: 'Ana renk #1e3a8a, ikincil #f59e0b, kart tabanlı bölümler, serif başlıklar' });
    insert('themes', { name: 'Koyu Modern', description: 'Koyu arka plan, neon vurgular', style_guide: 'Arka plan #0f172a, metin #e2e8f0, vurgu #22d3ee, büyük başlıklar, gradyanlar' });
    added.push('temalar');
  }
  if (!get('SELECT id FROM languages LIMIT 1')) {
    for (const [name, description] of [
      ['HTML/CSS/JavaScript', 'Statik site, her yerde barındırılabilir'],
      ['React', 'Tek sayfa uygulama (Vite)'],
      ['Next.js', 'SEO dostu React framework'],
      ['Laravel', 'PHP tabanlı full-stack'],
      ['Node.js (Express)', 'JavaScript API/sunucu'],
      ['Python (Django)', 'Python tabanlı full-stack'],
    ]) insert('languages', { name, description });
    added.push('teknolojiler');
  }
  return added;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const added = seedDefaults();
  console.log(added.length ? `Örnek veriler eklendi: ${added.join(', ')}` : 'Örnek veriler zaten var.');
}
