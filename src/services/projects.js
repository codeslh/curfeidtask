import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config, dataPath } from '../config.js';
import { all, get, insert, run, update } from '../db.js';
import { AiUnavailableError, callClaude, mockGuard } from './ai.js';
import { isLocalUrl, netlifyReady, publishToNetlify } from './deploy.js';
import { notifyAdmin } from './notify.js';
import { sign } from './secret.js';
import { createPaymentRequest } from './payments.js';
import { addMessage, sendToCustomer } from './sales.js';
import { getSection } from './settings.js';

/*
 * Project lifecycle:
 *   won -> building -> review (admin checks) -> [revision -> building -> review]* -> approved
 *   -> demo_live (sent to customer) -> [changes_requested -> admin feedback -> building ...]
 *   -> customer_approved -> awaiting_payment -> paid -> delivered
 *   build_failed / cancelled are side exits.
 */
export const STATUS_LABELS = {
  won: 'İş alındı',
  building: 'Yapay zeka geliştiriyor',
  build_failed: 'Geliştirme başarısız',
  review: 'Admin kontrolü bekliyor',
  revision: 'Revizyon bekliyor',
  approved: 'Admin onayladı',
  demo_live: 'Demo müşteride',
  changes_requested: 'Müşteri değişiklik istedi',
  customer_approved: 'Müşteri onayladı',
  awaiting_payment: 'Ödeme bekleniyor',
  paid: 'Ödendi',
  delivered: 'Teslim edildi',
  cancelled: 'İptal',
};

const BUILD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'files'],
  properties: {
    summary: { type: 'string', description: 'Bu sürümde yapılanların kısa Türkçe özeti' },
    files: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'content'],
        properties: { path: { type: 'string' }, content: { type: 'string' } },
      },
    },
  },
};

const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['plan', 'customer_update'],
  properties: {
    plan: { type: 'string', description: 'Sayfalar, bileşenler ve dosya yapısını içeren geliştirme planı' },
    customer_update: { type: 'string', description: 'Müşteriye gönderilecek kısa ilerleme mesajı' },
  },
};

const MAX_FILES = 60;
const MAX_FILE_BYTES = 512 * 1024;

export function logEvent(projectId, type, message) {
  insert('project_events', { project_id: projectId, type, message });
}

function setStatus(projectId, status, message) {
  run(`UPDATE projects SET status = ?, updated_at = datetime('now') WHERE id = ?`, status, projectId);
  logEvent(projectId, 'status', message || STATUS_LABELS[status] || status);
}

export function getProject(id) {
  return get(`SELECT p.*, c.name AS customer_name, t.name AS theme_name, t.style_guide, l.name AS language_name
              FROM projects p
              LEFT JOIN customers c ON c.id = p.customer_id
              LEFT JOIN themes t ON t.id = p.theme_id
              LEFT JOIN languages l ON l.id = p.language_id
              WHERE p.id = ?`, id);
}

/** Signed, cookie-less link: sandboxed pages cannot send the admin cookie for their sub-resources. */
export function previewUrl(projectId, version) {
  return `${config.publicUrl}/preview/${projectId}/${version}/${sign(`${projectId}:${version}`)}/`;
}

export function versionDir(projectId, version) {
  return dataPath('projects', String(projectId), `v${version}`);
}

/** Resolve a model-provided relative path inside `root`, refusing anything that escapes it. */
export function safeJoin(root, rel) {
  const clean = String(rel).replace(/\\/g, '/').replace(/^\/+/, '');
  if (!clean || clean.split('/').some((seg) => seg === '..')) return null;
  const full = path.resolve(root, clean);
  return full.startsWith(path.resolve(root) + path.sep) ? full : null;
}

export function readVersionFiles(projectId, version) {
  const root = versionDir(projectId, version);
  if (!fs.existsSync(root)) return [];
  const out = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else out.push({ path: path.relative(root, full).split(path.sep).join('/'), content: fs.readFileSync(full, 'utf8') });
    }
  };
  walk(root);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

function writeVersionFiles(projectId, version, files) {
  const root = versionDir(projectId, version);
  fs.mkdirSync(root, { recursive: true });
  let count = 0;
  for (const f of files.slice(0, MAX_FILES)) {
    const target = safeJoin(root, f.path);
    if (!target || Buffer.byteLength(f.content) > MAX_FILE_BYTES) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, f.content);
    count++;
  }
  return count;
}

function findByName(table, name) {
  if (!name) return null;
  return get(`SELECT id FROM ${table} WHERE active = 1 AND lower(name) = lower(?)`, name)?.id
    ?? get(`SELECT id FROM ${table} WHERE active = 1 AND lower(name) LIKE lower(?)`, `%${name}%`)?.id
    ?? null;
}

export async function createProject({ customerId, conversationId = null, leadId = null, title, requirements, themeId = null, languageId = null, price = 0, currency }) {
  const id = insert('projects', {
    customer_id: customerId, conversation_id: conversationId, lead_id: leadId, title, requirements,
    theme_id: themeId, language_id: languageId, price, currency: currency || getSection('business').base_currency,
    status: 'won',
  });
  if (conversationId) update('conversations', conversationId, { project_id: id });
  if (leadId) update('leads', leadId, { status: 'won' });
  logEvent(id, 'created', `Proje oluşturuldu: ${title}`);
  await notifyAdmin('project_won', `Yeni iş alındı: ${title}`,
    `Fiyat: ${price} ${currency || ''}\nGereksinimler:\n${requirements}`, `/projects/${id}`);
  if (getSection('ai').auto_build) startBuild(id);
  return id;
}

export async function createProjectFromDeal(conv, deal) {
  return createProject({
    customerId: conv.customer_id,
    conversationId: conv.id,
    title: deal.title,
    requirements: deal.requirements,
    themeId: findByName('themes', deal.theme_name),
    languageId: findByName('languages', deal.language_name),
    price: deal.price,
    currency: deal.currency,
  });
}

// --- AI builder -------------------------------------------------------------

function buildBrief(project, feedback, previous) {
  const lines = [
    `Proje: ${project.title}`,
    `Gereksinimler:\n${project.requirements}`,
    `Teknoloji: ${project.language_name || 'Saf HTML/CSS/JavaScript (statik site)'}`,
    `Tema: ${project.theme_name || 'Modern, sade, mobil uyumlu'}${project.style_guide ? `\nTema rehberi: ${project.style_guide}` : ''}`,
  ];
  if (previous.length) {
    lines.push('', 'ÖNCEKİ SÜRÜMÜN DOSYALARI (JSON):', JSON.stringify(previous));
  }
  if (feedback) lines.push('', `DÜZELTİLMESİ İSTENENLER (yöneticiden):\n${feedback}`);
  return lines.join('\n');
}

const BUILDER_SYSTEM = [
  'Sen deneyimli bir full-stack geliştiricisin. Müşteri için istenen ürünü eksiksiz ve çalışır şekilde üretirsin.',
  'Kurallar:',
  '- Tarayıcıda doğrudan açılabilen bir demo üret: kök dizinde index.html olmalı; göreli yollar kullan.',
  '- Seçilen teknoloji sunucu tarafı gerektiriyorsa (ör. Laravel, Node API), kaynak kodunu üret ve ayrıca demo için statik bir index.html önizlemesi ekle.',
  '- Gerçek görünümlü içerik yaz (lorem ipsum değil), erişilebilir ve mobil uyumlu ol.',
  '- Gizli anahtar, şifre veya harici izleme kodu ekleme.',
  '- Revizyonda önceki sürümü temel al, istenen düzeltmeleri uygula ve tüm dosyaların SON halini döndür.',
].join('\n');

function mockBuild(project, feedback, version) {
  mockGuard('build');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const html = `<!doctype html>
<html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(project.title)}</title><link rel="stylesheet" href="style.css"></head>
<body><header><h1>${esc(project.title)}</h1><p>Sürüm ${version}${project.theme_name ? ` · Tema: ${esc(project.theme_name)}` : ''}</p></header>
<main><section><h2>Hakkımızda</h2><p>${esc(project.requirements).replace(/\n/g, '<br>')}</p></section>
${feedback ? `<section><h2>Bu sürümdeki düzeltmeler</h2><p>${esc(feedback)}</p></section>` : ''}
<section><h2>İletişim</h2><form><input placeholder="Adınız"><input placeholder="E-posta"><button type="button">Gönder</button></form></section></main>
<footer>© ${new Date().getFullYear()}</footer></body></html>`;
  const css = 'body{font-family:system-ui,sans-serif;margin:0;color:#1f2937}header{background:#4f46e5;color:#fff;padding:48px 24px}main{max-width:860px;margin:auto;padding:24px}input,button{display:block;margin:8px 0;padding:10px;width:100%;max-width:360px}footer{text-align:center;padding:24px;color:#6b7280}';
  return { summary: feedback ? `Revizyon uygulandı: ${feedback}` : 'İlk sürüm oluşturuldu.', files: [{ path: 'index.html', content: html }, { path: 'style.css', content: css }] };
}

async function aiPlan(project, feedback, previous) {
  if (config.aiMock) {
    mockGuard('plan');
    return { plan: 'Tek sayfa: başlık, hakkımızda, iletişim formu.', customer_update: `"${project.title}" projeniz üzerinde çalışmaya başladık. Kısa süre içinde demo bağlantısını paylaşacağız.` };
  }
  return callClaude({
    purpose: 'plan', system: BUILDER_SYSTEM, schema: PLAN_SCHEMA, maxTokens: 8000, effort: 'medium',
    messages: [{ role: 'user', content: `${buildBrief(project, feedback, previous)}\n\nÖnce kısa bir geliştirme planı çıkar.` }],
  });
}

async function aiBuild(project, feedback, previous, plan, version) {
  if (config.aiMock) return mockBuild(project, feedback, version);
  return callClaude({
    purpose: 'build', system: BUILDER_SYSTEM, schema: BUILD_SCHEMA, maxTokens: 64000, effort: 'high', stream: true,
    messages: [{ role: 'user', content: `${buildBrief(project, feedback, previous)}\n\nPLAN:\n${plan}\n\nŞimdi tüm dosyaları üret.` }],
  });
}

const running = new Map();

/** Kick off a build in the background. Returns the promise (tests await it). */
export function startBuild(projectId, feedback = null) {
  if (running.has(projectId)) return running.get(projectId);
  const job = runBuild(projectId, feedback).finally(() => running.delete(projectId));
  running.set(projectId, job);
  return job;
}

/** Resolves when the current build (if any) finishes. */
export function waitForBuild(projectId) {
  return running.get(projectId) ?? Promise.resolve();
}

export function isBuilding(projectId) {
  return running.has(projectId);
}

async function runBuild(projectId, feedback) {
  const project = getProject(projectId);
  if (!project) return;
  const version = project.current_version + 1;
  const previous = project.current_version ? readVersionFiles(projectId, project.current_version) : [];
  setStatus(projectId, 'building', `Sürüm ${version} geliştiriliyor${feedback ? ' (revizyon)' : ''}`);
  try {
    const { plan, customer_update } = await aiPlan(project, feedback, previous);
    logEvent(projectId, 'plan', plan);
    await notifyAdmin('build_progress', `Geliştirme başladı: ${project.title}`, `Sürüm ${version} planı:\n${plan}`, `/projects/${projectId}`);
    if (project.conversation_id && version === 1) await sendToCustomer(project.conversation_id, customer_update);

    const result = await aiBuild(project, feedback, previous, plan, version);
    const count = writeVersionFiles(projectId, version, result.files);
    if (!count || !fs.existsSync(path.join(versionDir(projectId, version), 'index.html'))) {
      throw new Error('Üretilen sürümde index.html bulunamadı');
    }
    insert('project_versions', { project_id: projectId, version, summary: result.summary, feedback, file_count: count });
    run(`UPDATE projects SET current_version = ?, updated_at = datetime('now') WHERE id = ?`, version, projectId);
    setStatus(projectId, 'review', `Sürüm ${version} hazır, admin kontrolü bekleniyor`);
    await notifyAdmin('build_ready', `Kontrol bekliyor: ${project.title} (v${version})`,
      `${result.summary}\n\nÖnizleme: ${previewUrl(projectId, version)}`, `/projects/${projectId}`);
  } catch (err) {
    const reason = err instanceof AiUnavailableError ? err.message : `Hata: ${err.message}`;
    setStatus(projectId, 'build_failed', `Sürüm ${version} üretilemedi. ${reason}`);
    await notifyAdmin('build_failed', `Geliştirme başarısız: ${project.title}`, reason, `/projects/${projectId}`);
  }
}

// --- Admin review / revision ------------------------------------------------

export function submitFeedback(projectId, feedback) {
  const project = getProject(projectId);
  if (!project) throw new Error('Proje bulunamadı');
  if (isBuilding(projectId)) throw new Error('Proje şu an geliştiriliyor');
  run('UPDATE project_versions SET feedback = COALESCE(feedback, ?) WHERE project_id = ? AND version = ?', feedback, projectId, project.current_version);
  setStatus(projectId, 'revision', `Admin düzeltme istedi: ${feedback}`);
  return startBuild(projectId, feedback);
}

export function rebuild(projectId) {
  if (isBuilding(projectId)) throw new Error('Proje şu an geliştiriliyor');
  return startBuild(projectId);
}

export function approve(projectId) {
  const project = getProject(projectId);
  if (!project?.current_version) throw new Error('Onaylanacak bir sürüm yok');
  setStatus(projectId, 'approved', `Sürüm ${project.current_version} admin tarafından onaylandı`);
}

// --- Demo deploy ------------------------------------------------------------

export function demoDir(slug) {
  return dataPath('demos', slug);
}

export async function deployDemo(projectId) {
  const project = getProject(projectId);
  if (!project?.current_version) throw new Error('Yayınlanacak bir sürüm yok');
  if (!['approved', 'demo_live', 'changes_requested'].includes(project.status)) throw new Error('Demo yayını için önce sürümü onaylayın');
  const slug = project.demo_slug || `${projectId}-${crypto.randomBytes(5).toString('hex')}`;
  const target = demoDir(slug);
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(versionDir(projectId, project.current_version), target, { recursive: true });
  let url = `${config.publicUrl}/demo/${slug}/`;
  if (netlifyReady()) {
    // Public copy so the customer can open it even when Kalfa runs on a laptop.
    const meta = JSON.parse(get(`SELECT value FROM settings WHERE key = ?`, `_netlify_${projectId}`)?.value || '{}');
    const pub = await publishToNetlify(target, { siteId: meta.siteId, name: meta.siteId ? undefined : `kalfa-demo-${slug}` });
    run(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, `_netlify_${projectId}`, JSON.stringify({ siteId: pub.siteId }));
    url = pub.url;
  } else if (isLocalUrl(url)) {
    logEvent(projectId, 'warning', 'Demo adresi yerel (localhost); müşteri bu bağlantıyı açamaz. NETLIFY_TOKEN ekleyin veya PUBLIC_URL\'i internete açın.');
  }
  update('projects', projectId, { demo_slug: slug, demo_url: url });
  setStatus(projectId, 'demo_live', `Demo yayınlandı: ${url}`);
  if (project.conversation_id) {
    await sendToCustomer(project.conversation_id,
      `Projeniz hazır! Demoyu buradan inceleyebilirsiniz: ${url}\nBeğendiyseniz bize haber verin; değişiklik isterseniz neyi değiştirmemizi istediğinizi yazabilirsiniz.`);
  }
  return url;
}

// --- Customer decisions -----------------------------------------------------

export async function customerApproved(projectId) {
  const project = getProject(projectId);
  if (!project || project.status !== 'demo_live') return;
  setStatus(projectId, 'customer_approved', 'Müşteri demoyu onayladı');
  await notifyAdmin('customer_approved', `Müşteri onayladı: ${project.title}`, 'Ödeme talebi oluşturuluyor.', `/projects/${projectId}`);
  if (getSection('payments').send_iban_automatically) await createPaymentRequest(projectId);
}

export async function customerRequestedChanges(projectId, changes) {
  const project = getProject(projectId);
  if (!project || project.status !== 'demo_live') return;
  setStatus(projectId, 'changes_requested', `Müşteri değişiklik istedi: ${changes}`);
  if (project.conversation_id) addMessage(project.conversation_id, 'system', `Değişiklik talebi admin onayına gönderildi: ${changes}`);
  await notifyAdmin('changes_requested', `Müşteri değişiklik istiyor: ${project.title}`,
    `${changes}\n\nPanelden düzeltmeyi yapay zekaya iletebilirsiniz.`, `/projects/${projectId}`);
}

export async function markDelivered(projectId) {
  const project = getProject(projectId);
  if (project?.status !== 'paid') throw new Error('Teslim için ödemenin alınmış olması gerekir');
  setStatus(projectId, 'delivered', 'Proje teslim edildi');
  if (project.conversation_id) {
    await sendToCustomer(project.conversation_id, `Ödemeniz için teşekkürler! "${project.title}" projeniz teslim edildi. Her türlü sorunuz için buradayız.`);
  }
}

export function listProjects() {
  return all(`SELECT p.id, p.title, p.status, p.price, p.currency, p.current_version, p.demo_url, p.updated_at, c.name AS customer_name
              FROM projects p LEFT JOIN customers c ON c.id = p.customer_id ORDER BY p.updated_at DESC`);
}
