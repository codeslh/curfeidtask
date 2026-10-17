const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const linkify = (s) => esc(s).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const msgs = document.getElementById('msgs');
let token = null;
try { token = localStorage.getItem('chatToken'); } catch {}
let lastId = 0;

const info = await fetch('/api/chat/info').then((r) => r.json());
document.getElementById('title').textContent = `${info.business} · Canlı destek`;
const chips = [
  ...info.shortcuts.themes.map((t) => [`Tema: ${t.name}`, `${t.name} temasını görmek istiyorum`]),
  ...info.shortcuts.languages.map((l) => [l.name, `Projemde ${l.name} kullanmak istiyorum`]),
  ['Fiyatlar', 'Fiyatlarınızı öğrenebilir miyim?'],
];
document.getElementById('sc').innerHTML = chips.map(([label, text]) => `<button class="chip" data-text="${esc(text)}">${esc(label)}</button>`).join('');
document.querySelectorAll('.chip').forEach((b) => { b.onclick = () => send(b.dataset.text); });

function add(m) {
  if (m.id <= lastId) return;
  lastId = m.id;
  const who = { customer: 'Siz', ai: info.business, admin: info.business }[m.sender] || '';
  const el = document.createElement('div');
  el.className = `msg ${m.sender === 'customer' ? 'customer' : 'ai'}`;
  el.style.alignSelf = m.sender === 'customer' ? 'flex-end' : 'flex-start';
  el.innerHTML = `<div class="who">${esc(who)}</div>${linkify(m.body)}`;
  msgs.append(el);
  msgs.scrollTop = msgs.scrollHeight;
}

async function poll() {
  if (!token) return;
  const r = await fetch(`/api/chat/${token}/messages?after=${lastId}`);
  if (r.status === 404) { token = null; try { localStorage.removeItem('chatToken'); } catch {} return showStart(); }
  (await r.json()).messages.forEach(add);
}

async function send(text) {
  text = text.trim();
  if (!text) return;
  document.getElementById('text').value = '';
  await post(`/api/chat/${token}/messages`, { text });
  await poll();
}

function showStart() { document.getElementById('start').hidden = false; document.getElementById('chat').hidden = true; }
function showChat() { document.getElementById('start').hidden = true; document.getElementById('chat').hidden = false; poll(); }

document.getElementById('start').onsubmit = async (e) => {
  e.preventDefault();
  token = (await post('/api/chat/start', Object.fromEntries(new FormData(e.target)))).token;
  try { localStorage.setItem('chatToken', token); } catch {}
  showChat();
  send('Merhaba');
};
document.getElementById('send').onsubmit = (e) => { e.preventDefault(); send(document.getElementById('text').value); };
if (token) showChat();
setInterval(() => poll().catch(() => {}), 3000);
