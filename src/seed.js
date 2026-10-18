// Default listing sources for an empty database.
// Run directly (`npm run seed`) or via `npm run setup`.
import './boot.js';
import { pathToFileURL } from 'node:url';

const { get, openDb } = await import('./db.js');
const { seedSources } = await import('./services/sources.js');

export function seedDefaults() {
  openDb();
  const had = get('SELECT id FROM sources LIMIT 1');
  seedSources();
  return had ? [] : ['ilan kaynakları'];
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const added = seedDefaults();
  console.log(added.length ? `Örnek veriler eklendi: ${added.join(', ')}` : 'Örnek veriler zaten var.');
}
