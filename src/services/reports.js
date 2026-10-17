import PDFDocument from 'pdfkit';
import path from 'node:path';
import { config, ROOT } from '../config.js';
import { all, get } from '../db.js';
import { callClaude, mockGuard } from './ai.js';
import { getSection, toBase } from './settings.js';

const FONT_DIR = path.join(ROOT, 'node_modules', 'dejavu-fonts-ttf', 'ttf');
const round2 = (n) => Math.round(n * 100) / 100;

/** 'YYYY-MM' -> [start, end) ISO-ish strings comparable with SQLite datetime('now') values. */
export function monthRange(month) {
  const [y, m] = (month || new Date().toISOString().slice(0, 7)).split('-').map(Number);
  const pad = (n) => String(n).padStart(2, '0');
  const start = `${y}-${pad(m)}-01`;
  const end = m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`;
  return { month: `${y}-${pad(m)}`, start, end };
}

const sumBase = (rows, field = 'amount') => round2(rows.reduce((s, r) => s + toBase(r[field], r.currency), 0));

export function monthStats(month) {
  const { start, end, month: label } = monthRange(month);
  const base = getSection('business').base_currency;
  const usdRate = getSection('business').fx_rates.USD || 1;

  const paid = all(`SELECT amount, currency FROM payments WHERE paid_at >= ? AND paid_at < ?`, start, end);
  const refunds = all(`SELECT r.amount, p.currency FROM refunds r JOIN payments p ON p.id = r.payment_id WHERE r.created_at >= ? AND r.created_at < ?`, start, end);
  const expenses = all(`SELECT category, amount, currency FROM expenses WHERE created_at >= ? AND created_at < ?`, start, end);
  const ai = get(`SELECT COALESCE(SUM(cost_usd),0) AS usd, COALESCE(SUM(input_tokens+output_tokens),0) AS tokens FROM ai_usage WHERE created_at >= ? AND created_at < ?`, start, end);
  const count = (sql) => get(sql, start, end).n;

  const grossRevenue = sumBase(paid);
  const refunded = sumBase(refunds);
  const aiCost = round2(ai.usd * (base === 'USD' ? 1 : usdRate));
  const otherExpenses = sumBase(expenses);
  const byCategory = {};
  for (const e of expenses) byCategory[e.category] = round2((byCategory[e.category] || 0) + toBase(e.amount, e.currency));
  byCategory.ai = round2((byCategory.ai || 0) + aiCost);

  const conversations = count(`SELECT COUNT(*) AS n FROM conversations WHERE created_at >= ? AND created_at < ?`);
  const projectsWon = count(`SELECT COUNT(*) AS n FROM projects WHERE created_at >= ? AND created_at < ?`);
  const totalExpenses = round2(aiCost + otherExpenses);
  const revenue = round2(grossRevenue - refunded);

  return {
    month: label,
    currency: base,
    revenue,
    gross_revenue: grossRevenue,
    refunded,
    expenses: totalExpenses,
    expenses_by_category: byCategory,
    profit: round2(revenue - totalExpenses),
    ai_tokens: ai.tokens,
    new_customers: count(`SELECT COUNT(*) AS n FROM customers WHERE created_at >= ? AND created_at < ?`),
    conversations,
    escalations: count(`SELECT COUNT(*) AS n FROM messages WHERE sender = 'system' AND body LIKE 'Konuşma yöneticiye aktarıldı%' AND created_at >= ? AND created_at < ?`),
    leads: count(`SELECT COUNT(*) AS n FROM leads WHERE created_at >= ? AND created_at < ?`),
    leads_contacted: count(`SELECT COUNT(*) AS n FROM leads WHERE status IN ('contacted','won') AND created_at >= ? AND created_at < ?`),
    projects_won: projectsWon,
    payments_count: paid.length,
    conversion_rate: conversations ? round2((projectsWon / conversations) * 100) : 0,
    average_order: paid.length ? round2(grossRevenue / paid.length) : 0,
  };
}

export function trend(months = 12) {
  const out = [];
  const d = new Date();
  d.setUTCDate(1);
  for (let i = months - 1; i >= 0; i--) {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)).toISOString().slice(0, 7);
    const s = monthStats(m);
    out.push({ month: m, revenue: s.revenue, expenses: s.expenses, profit: s.profit, new_customers: s.new_customers, projects_won: s.projects_won });
  }
  return out;
}

export function productPerformance() {
  // How often the AI recommended each product vs. how many projects carry its name.
  const products = all('SELECT id, name, price, currency FROM products WHERE active = 1');
  const recs = all(`SELECT meta FROM messages WHERE sender = 'ai' AND meta IS NOT NULL AND created_at >= datetime('now', '-90 days')`);
  const counts = {};
  for (const r of recs) for (const id of JSON.parse(r.meta).recommended_product_ids || []) counts[id] = (counts[id] || 0) + 1;
  return products.map((p) => ({
    ...p,
    recommended: counts[p.id] || 0,
    sold: get(`SELECT COUNT(*) AS n FROM projects WHERE title = ? AND status IN ('paid','delivered')`, p.name).n,
  }));
}

function mockAnalysis(current, previous, products) {
  mockGuard('analysis');
  const lines = ['## Durum değerlendirmesi', ''];
  const diff = current.revenue - previous.revenue;
  lines.push(`- Bu ay ciro ${current.revenue} ${current.currency} (${diff >= 0 ? '+' : ''}${round2(diff)} geçen aya göre).`);
  lines.push(`- Kâr: ${current.profit} ${current.currency}, giderler: ${current.expenses} ${current.currency}.`);
  lines.push(`- Dönüşüm oranı: %${current.conversion_rate}.`, '', '## Öneriler', '');
  if (diff < 0) lines.push('- Satışlar düştü: en çok önerilip az satılan ürünlerin fiyatını ve açıklamasını gözden geçirin.');
  for (const p of products.filter((x) => x.recommended > 2 && x.sold === 0)) {
    lines.push(`- "${p.name}" sık öneriliyor ama satılmıyor: fiyatı (${p.price} ${p.currency}) veya demo örneğini iyileştirin.`);
  }
  if (current.escalations > 3) lines.push('- Çok sayıda konuşma yöneticiye aktarıldı: fiyat tablosunu ve ürün açıklamalarını netleştirin.');
  if (current.leads && current.leads_contacted / current.leads < 0.2) lines.push('- Taranan ilanların az kısmına ulaşılabildi: tarama kapsamını (anahtar kelimeler, bütçe) daraltın.');
  if (lines[lines.length - 1] === '') lines.push('- Belirgin bir sorun görünmüyor; mevcut stratejiye devam edin.');
  return lines.join('\n');
}

export async function aiAnalysis(month) {
  const current = monthStats(month);
  const { start } = monthRange(month);
  const prevMonth = new Date(`${start}T00:00:00Z`);
  prevMonth.setUTCMonth(prevMonth.getUTCMonth() - 1);
  const previous = monthStats(prevMonth.toISOString().slice(0, 7));
  const products = productPerformance();
  if (config.aiMock) return mockAnalysis(current, previous, products);
  return callClaude({
    purpose: 'analysis', effort: 'high', maxTokens: 8000,
    system: 'Sen küçük bir freelance yazılım işletmesinin iş analistisin. Verilen metriklere dayanarak Türkçe, Markdown formatında kısa bir durum değerlendirmesi ve somut, uygulanabilir çözüm önerileri yaz. Satış düşükse hangi ürünlerde (fiyat, açıklama, özellik, demo) neyin değişmesi gerektiğini belirt. Veride olmayan bilgiyi uydurma.',
    messages: [{ role: 'user', content: JSON.stringify({ bu_ay: current, gecen_ay: previous, son_12_ay: trend(12), urun_performansi: products }) }],
  });
}

/** Stream a monthly summary PDF into `out` (an http response or any writable). */
export function monthlyPdf(month, out, analysisText = '') {
  const s = monthStats(month);
  const b = getSection('business');
  const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `${b.name} - ${s.month} özeti` } });
  doc.registerFont('regular', path.join(FONT_DIR, 'DejaVuSans.ttf'));
  doc.registerFont('bold', path.join(FONT_DIR, 'DejaVuSans-Bold.ttf'));
  doc.pipe(out);

  doc.font('bold').fontSize(20).text(`${b.name}`, { continued: false });
  doc.font('regular').fontSize(12).fillColor('#555').text(`Aylık özet: ${s.month}`).moveDown();
  doc.fillColor('#000');

  const money = (n) => `${n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${s.currency}`;
  const rows = [
    ['Net ciro', money(s.revenue)],
    ['Brüt ciro', money(s.gross_revenue)],
    ['İadeler', money(s.refunded)],
    ['Toplam gider', money(s.expenses)],
    ['Kâr', money(s.profit)],
    ['Yeni müşteri', String(s.new_customers)],
    ['Konuşma', String(s.conversations)],
    ['Yöneticiye aktarılan', String(s.escalations)],
    ['Taranan ilan / ulaşılan', `${s.leads} / ${s.leads_contacted}`],
    ['Alınan iş', String(s.projects_won)],
    ['Dönüşüm oranı', `%${s.conversion_rate}`],
    ['Ortalama sipariş', money(s.average_order)],
    ['Yapay zeka token kullanımı', s.ai_tokens.toLocaleString('tr-TR')],
  ];
  doc.font('bold').fontSize(14).text('Özet').moveDown(0.5);
  for (const [k, v] of rows) {
    const y = doc.y;
    doc.font('regular').fontSize(11).text(k, 50, y);
    doc.font('bold').text(v, 300, y, { width: 245, align: 'right' });
    doc.moveDown(0.3);
  }
  doc.moveDown().font('bold').fontSize(14).text('Gider dağılımı', 50).moveDown(0.5);
  for (const [k, v] of Object.entries(s.expenses_by_category)) {
    const y = doc.y;
    doc.font('regular').fontSize(11).text(k, 50, y);
    doc.text(money(v), 300, y, { width: 245, align: 'right' });
    doc.moveDown(0.3);
  }

  const payments = all(`SELECT pay.reference, pay.amount, pay.currency, pay.status, pay.paid_at, c.name FROM payments pay
                        LEFT JOIN customers c ON c.id = pay.customer_id WHERE pay.paid_at >= ? AND pay.paid_at < ? ORDER BY pay.paid_at`,
  monthRange(month).start, monthRange(month).end);
  if (payments.length) {
    doc.moveDown().font('bold').fontSize(14).text('Ödemeler', 50).moveDown(0.5);
    for (const p of payments) {
      doc.font('regular').fontSize(10).text(`${p.paid_at.slice(0, 10)}  ${p.reference}  ${p.name || '-'}  ${p.amount} ${p.currency}  (${p.status})`, 50);
    }
  }
  if (analysisText) {
    doc.addPage().font('bold').fontSize(14).text('Yapay zeka değerlendirmesi').moveDown(0.5);
    doc.font('regular').fontSize(11).text(analysisText.replace(/^#+\s*/gm, '').replace(/\*\*/g, ''));
  }
  doc.end();
}

export function invoicePdf(invoiceId, out) {
  const inv = get(`SELECT i.*, c.name AS customer_name, c.email AS customer_email, p.title AS project_title, pay.reference
                   FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id LEFT JOIN projects p ON p.id = i.project_id
                   LEFT JOIN payments pay ON pay.id = i.payment_id WHERE i.id = ?`, invoiceId);
  if (!inv) return false;
  const b = getSection('business');
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  doc.registerFont('regular', path.join(FONT_DIR, 'DejaVuSans.ttf'));
  doc.registerFont('bold', path.join(FONT_DIR, 'DejaVuSans-Bold.ttf'));
  doc.pipe(out);
  doc.font('bold').fontSize(20).text(inv.kind === 'refund' ? 'İADE BELGESİ' : 'FATURA');
  doc.font('regular').fontSize(11).text(`No: ${inv.number}`).text(`Tarih: ${inv.issued_at.slice(0, 10)}`).moveDown();
  doc.font('bold').text('Satıcı').font('regular').text(b.name).text(b.owner_name).moveDown();
  doc.font('bold').text('Alıcı').font('regular').text(inv.customer_name || '-').text(inv.customer_email || '').moveDown();
  doc.font('bold').text('Hizmet').font('regular').text(inv.project_title || '-').text(`Ödeme referansı: ${inv.reference || '-'}`).moveDown();
  const money = (n) => `${n.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ${inv.currency}`;
  for (const [k, v] of [['Ara toplam', inv.subtotal], [`KDV (%${inv.tax_rate})`, inv.tax_amount], ['Genel toplam', inv.total]]) {
    const y = doc.y;
    doc.font(k === 'Genel toplam' ? 'bold' : 'regular').text(k, 300, y).text(money(v), 400, y, { width: 145, align: 'right' });
    doc.moveDown(0.3);
  }
  doc.moveDown(2).font('regular').fontSize(9).fillColor('#666')
    .text('Bu belge sistem tarafından oluşturulmuştur. Resmi e-Fatura/e-Arşiv yükümlülükleriniz için entegratörünüzü kullanın.');
  doc.end();
  return true;
}
