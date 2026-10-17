const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const linkify = (s) => esc(s).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const msgs = document.getElementById('msgs');
let token = null;
try { token = localStorage.getItem('chatToken'); } catch {}
let lastId = 0;

const info = await fetch('/api/chat/info').then((r) => r.json());
document.getElementById('title').textContent = info.business;
document.title = `${info.business} · Canlı destek`;
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
  el.className = `msg ${m.sender === 'customer' ? 'customer' : 'agent'}`;
  el.innerHTML = `<div class="who">${esc(who)}</div>${linkify(m.body)}`;
  msgs.insertBefore(el, typingEl.isConnected ? typingEl : null);
  if (m.sender !== 'customer') typing(false);
  msgs.scrollTop = msgs.scrollHeight;
}

// "Typing…" bubble while we wait for the assistant's answer.
const typingEl = document.createElement('div');
typingEl.className = 'typing';
typingEl.setAttribute('aria-label', 'Yazıyor');
typingEl.innerHTML = '<span></span><span></span><span></span>';
function typing(on) {
  if (on) { msgs.append(typingEl); msgs.scrollTop = msgs.scrollHeight; } else typingEl.remove();
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
  // Show the message right away; the server copy replaces it on the next poll.
  const pending = document.createElement('div');
  pending.className = 'msg customer';
  pending.innerHTML = `<div class="who">Siz</div>${linkify(text)}`;
  msgs.append(pending);
  typing(true);
  const r = await post(`/api/chat/${token}/messages`, { text }).catch(() => ({ error: 'Mesaj gönderilemedi, tekrar deneyin.' }));
  pending.remove();
  if (r.reply === null || r.error) typing(false); // a human will answer, or the send failed
  await poll();
  if (r.error) {
    const el = document.createElement('div');
    el.className = 'msg system';
    el.textContent = r.error;
    msgs.append(el);
  }
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
