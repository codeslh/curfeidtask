// Runs before anything touches node:sqlite: checks the Node.js version with a clear
// message and silences the "SQLite is experimental" warning without CLI flags
// (so `node src/server.js` works the same on Windows, macOS and Linux).
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`\n  Kalfa için Node.js 22.13 veya üzeri gerekiyor (sizdeki: ${process.versions.node}).`);
  console.error('  İndirin: https://nodejs.org  (LTS sürümünü seçin), sonra terminali kapatıp yeniden açın.\n');
  process.exit(1);
}

const emit = process.emitWarning;
process.emitWarning = function (warning, ...args) {
  const type = typeof args[0] === 'string' ? args[0] : args[0]?.type;
  if (type === 'ExperimentalWarning' || warning?.name === 'ExperimentalWarning') return;
  return emit.call(process, warning, ...args);
};
