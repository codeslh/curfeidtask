// One-time local setup: `npm run setup`
// Creates .env from .env.example (with fresh random secrets), prepares the data
// folder and loads example products/themes/languages.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../src/boot.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(root, '.env');

console.log('\n  Kalfa kurulumu\n');

if (!fs.existsSync(path.join(root, 'node_modules'))) {
  console.error('  Önce bağımlılıkları kurun:  npm install\n');
  process.exit(1);
}

if (fs.existsSync(envFile)) {
  console.log('  ✓ .env zaten var, dokunulmadı');
} else {
  const example = fs.readFileSync(path.join(root, '.env.example'), 'utf8')
    .replace(/^WHATSAPP_VERIFY_TOKEN=.*$/m, `WHATSAPP_VERIFY_TOKEN=${crypto.randomBytes(12).toString('hex')}`);
  fs.writeFileSync(envFile, example);
  console.log('  ✓ .env oluşturuldu (.env.example kopyalandı)');
}

const { seedDefaults } = await import('../src/seed.js');
const added = seedDefaults();
console.log(added.length ? `  ✓ Örnek veriler eklendi: ${added.join(', ')}` : '  ✓ Veritabanı hazır (örnek veriler zaten var)');

console.log(`
  Kurulum tamam. Başlatmak için:

    npm start

  Sonra tarayıcıda http://localhost:${process.env.PORT || 3000} adresini açın ve yönetici hesabınızı oluşturun.
  E-posta göndermek ve cevapları okumak için .env dosyasına SMTP_* ve IMAP_* bilgilerini girin.
`);
