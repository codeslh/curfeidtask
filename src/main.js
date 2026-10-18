import { createApp } from './app.js';
import { config } from './config.js';
import { get, openDb } from './db.js';
import './services/jobs.js';
import { startScheduler } from './services/scheduler.js';
import { createUser } from './services/security.js';

openDb();

if (!get('SELECT id FROM users LIMIT 1') && config.admin.password) {
  await createUser({ email: config.admin.email, name: config.admin.name, password: config.admin.password });
  console.log(`Admin hesabı oluşturuldu: ${config.admin.email}`);
}

startScheduler();

const server = createApp().listen(config.port, () => {
  const hasUser = !!get('SELECT id FROM users LIMIT 1');
  console.log('');
  console.log('  Kalfa çalışıyor');
  console.log(`  Yönetim paneli : ${config.publicUrl}`);
  console.log(`  Müşteri sohbeti: ${config.publicUrl}/chat`);
  console.log(`  Yapay zeka     : ${config.aiMock ? 'DEMO modu (ANTHROPIC_API_KEY yok) — cevaplar örnek kurallarla üretilir' : config.aiModel}`);
  console.log(`  E-posta        : ${config.smtp.host ? config.smtp.host : 'SMTP ayarlı değil — e-postalar bu pencereye yazılır'}`);
  if (!hasUser) console.log('\n  İlk açılış: tarayıcıda yukarıdaki adresi açıp yönetici hesabınızı oluşturun.');
  console.log('\n  Durdurmak için Ctrl+C\n');
});
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  ${config.port} portu başka bir uygulama tarafından kullanılıyor.`);
    console.error('  .env dosyasında PORT=3001 gibi başka bir port yazıp tekrar deneyin.\n');
    process.exit(1);
  }
  throw err;
});
