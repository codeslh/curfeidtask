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

createApp().listen(config.port, () => {
  console.log(`Sunucu hazır: ${config.publicUrl}`);
  console.log(config.aiMock
    ? 'Yapay zeka DEMO modunda (ANTHROPIC_API_KEY tanımlı değil veya AI_MOCK=1).'
    : `Yapay zeka modeli: ${config.aiModel}`);
});
