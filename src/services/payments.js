import crypto from 'node:crypto';
import { config } from '../config.js';
import { all, get, insert, run, tx, update } from '../db.js';
import { notifyAdmin } from './notify.js';
import { logEvent } from './projects.js';
import { sendToCustomer } from './sales.js';
import { getSection, toBase } from './settings.js';

const round2 = (n) => Math.round(n * 100) / 100;

// --- Stripe (optional card payments) ----------------------------------------

async function stripe(pathname, params) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) body.append(k, String(v));
  const res = await fetch(`https://api.stripe.com/v1/${pathname}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.stripe.secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Stripe: ${data.error?.message || res.status}`);
  return data;
}

export function verifyStripeSignature(rawBody, header) {
  if (!config.stripe.webhookSecret || !header) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  if (!parts.t || !parts.v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) return false;
  const expected = crypto.createHmac('sha256', config.stripe.webhookSecret).update(`${parts.t}.${rawBody}`).digest('hex');
  return parts.v1.length === expected.length && crypto.timingSafeEqual(Buffer.from(parts.v1), Buffer.from(expected));
}

const useStripe = () => getSection('payments').provider === 'stripe' && config.stripe.secretKey;

// --- Payment requests ---------------------------------------------------------

export function paymentInstructions(payment) {
  const b = getSection('business');
  const lines = [`Ödeme tutarı: ${payment.amount} ${payment.currency}`];
  if (b.iban) {
    lines.push('', 'Havale/EFT bilgileri:', `Alıcı: ${b.iban_holder || b.name}`, `IBAN: ${b.iban}`);
    if (b.bank_name) lines.push(`Banka: ${b.bank_name}`);
    lines.push(`Açıklama: ${payment.reference} (lütfen açıklamaya bu kodu yazın)`);
  }
  if (payment.checkout_url) lines.push('', `Kartla ödemek için: ${payment.checkout_url}`);
  lines.push('', `Son ödeme tarihi: ${getSection('payments').payment_due_days} gün içinde.`);
  return lines.join('\n');
}

export async function createPaymentRequest(projectId) {
  const project = get('SELECT * FROM projects WHERE id = ?', projectId);
  if (!project) throw new Error('Proje bulunamadı');
  const existing = get(`SELECT * FROM payments WHERE project_id = ? AND status = 'pending'`, projectId);
  if (existing) return existing.id;

  const reference = `PRJ${projectId}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const id = insert('payments', {
    project_id: projectId, customer_id: project.customer_id, amount: project.price, currency: project.currency,
    method: useStripe() ? 'stripe' : 'iban', reference,
  });
  if (useStripe()) {
    try {
      const session = await stripe('checkout/sessions', {
        mode: 'payment',
        'line_items[0][quantity]': 1,
        'line_items[0][price_data][currency]': project.currency.toLowerCase(),
        'line_items[0][price_data][unit_amount]': Math.round(project.price * 100),
        'line_items[0][price_data][product_data][name]': project.title,
        client_reference_id: String(id),
        'metadata[payment_id]': id,
        success_url: `${config.publicUrl}/pay/success`,
        cancel_url: `${config.publicUrl}/pay/cancel`,
      });
      update('payments', id, { provider_ref: session.id, checkout_url: session.url });
    } catch (err) {
      await notifyAdmin('payment_error', 'Kartla ödeme bağlantısı oluşturulamadı', err.message, `/payments`);
    }
  }
  const payment = get('SELECT * FROM payments WHERE id = ?', id);
  if (!getSection('business').iban && !payment.checkout_url) {
    await notifyAdmin('payment_error', 'IBAN tanımlı değil', 'Ödeme talebi oluştu ama ayarlarda IBAN veya kart ödemesi tanımlı değil. Müşteriye ödeme bilgisi gönderilemedi.', '/settings');
  } else {
    const project2 = get('SELECT conversation_id FROM projects WHERE id = ?', projectId);
    if (project2.conversation_id) await sendToCustomer(project2.conversation_id, paymentInstructions(payment));
  }
  run(`UPDATE projects SET status = 'awaiting_payment', updated_at = datetime('now') WHERE id = ?`, projectId);
  logEvent(projectId, 'status', `Ödeme talebi oluşturuldu (${reference})`);
  return id;
}

// --- Invoices -----------------------------------------------------------------

function nextInvoiceNumber(kind) {
  const year = new Date().getFullYear();
  const prefix = kind === 'refund' ? `IADE-${year}-` : `FTR-${year}-`;
  const last = get('SELECT number FROM invoices WHERE number LIKE ? ORDER BY id DESC LIMIT 1', `${prefix}%`);
  const n = last ? Number(last.number.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(n).padStart(5, '0')}`;
}

function createInvoice(payment, total, kind) {
  // Prices are VAT-inclusive; split the tax out of the gross amount.
  const taxRate = getSection('business').tax_rate;
  const subtotal = round2(total / (1 + taxRate / 100));
  return insert('invoices', {
    number: nextInvoiceNumber(kind), kind,
    payment_id: payment.id, project_id: payment.project_id, customer_id: payment.customer_id,
    subtotal, tax_rate: taxRate, tax_amount: round2(total - subtotal), total: round2(total), currency: payment.currency,
  });
}

// --- State changes ------------------------------------------------------------

export async function markPaid(paymentId, { providerRef = null, note = null } = {}) {
  const payment = get('SELECT * FROM payments WHERE id = ?', paymentId);
  if (!payment) throw new Error('Ödeme bulunamadı');
  if (payment.status !== 'pending') return payment;
  const invoiceId = tx(() => {
    update('payments', paymentId, { status: 'paid', paid_at: new Date().toISOString(), provider_ref: providerRef || payment.provider_ref, note });
    const inv = createInvoice(payment, payment.amount, 'sale');
    if (payment.project_id) {
      run(`UPDATE projects SET status = 'paid', updated_at = datetime('now') WHERE id = ?`, payment.project_id);
      logEvent(payment.project_id, 'status', `Ödeme alındı: ${payment.amount} ${payment.currency}`);
    }
    return inv;
  });
  const invoice = get('SELECT number FROM invoices WHERE id = ?', invoiceId);
  await notifyAdmin('payment_received', `Ödeme alındı: ${payment.amount} ${payment.currency}`,
    `Referans: ${payment.reference}\nFatura: ${invoice.number}`, '/payments');
  const project = payment.project_id ? get('SELECT conversation_id FROM projects WHERE id = ?', payment.project_id) : null;
  if (project?.conversation_id) {
    await sendToCustomer(project.conversation_id, `Ödemeniz alındı, teşekkür ederiz! Fatura numaranız: ${invoice.number}`);
  }
  return get('SELECT * FROM payments WHERE id = ?', paymentId);
}

export async function refund(paymentId, amount, reason, userId) {
  const payment = get('SELECT * FROM payments WHERE id = ?', paymentId);
  if (!payment) throw new Error('Ödeme bulunamadı');
  if (!['paid', 'partially_refunded'].includes(payment.status)) throw new Error('Sadece alınmış ödemeler iade edilebilir');
  const refundable = round2(payment.amount - payment.refunded_amount);
  amount = round2(Number(amount) || refundable);
  if (amount <= 0 || amount > refundable) throw new Error(`İade tutarı 0 ile ${refundable} arasında olmalı`);

  let providerRef = null;
  if (payment.method === 'stripe' && payment.provider_ref && config.stripe.secretKey) {
    // provider_ref holds the checkout session id until the webhook stores the payment intent.
    const params = payment.provider_ref.startsWith('pi_')
      ? { payment_intent: payment.provider_ref }
      : { payment_intent: (await (await fetch(`https://api.stripe.com/v1/checkout/sessions/${payment.provider_ref}`, {
        headers: { Authorization: `Bearer ${config.stripe.secretKey}` },
      })).json()).payment_intent };
    const r = await stripe('refunds', { ...params, amount: Math.round(amount * 100) });
    providerRef = r.id;
  }
  tx(() => {
    insert('refunds', { payment_id: paymentId, amount, reason, provider_ref: providerRef, created_by: userId });
    const total = round2(payment.refunded_amount + amount);
    update('payments', paymentId, { refunded_amount: total, status: total >= payment.amount ? 'refunded' : 'partially_refunded' });
    createInvoice(payment, -amount, 'refund');
    if (payment.project_id) logEvent(payment.project_id, 'refund', `İade: ${amount} ${payment.currency} (${reason || '-'})`);
  });
  const { large_refund_amount } = getSection('security');
  if (large_refund_amount > 0 && toBase(amount, payment.currency) >= large_refund_amount) {
    await notifyAdmin('security', `Yüksek tutarlı iade: ${amount} ${payment.currency}`,
      `Ödeme ${payment.reference} için ${amount} ${payment.currency} iade yapıldı (eşik: ${large_refund_amount}).\nSebep: ${reason || '-'}\nBu işlemi siz yapmadıysanız hemen şifrenizi değiştirin.`, '/payments');
  }
  await notifyAdmin('refund', `İade yapıldı: ${amount} ${payment.currency}`,
    `Ödeme ${payment.reference}\nSebep: ${reason || '-'}${payment.method === 'iban' ? '\nHavale ile alınan ödeme: iadeyi bankanızdan manuel göndermeyi unutmayın.' : ''}`, '/payments');
  return get('SELECT * FROM payments WHERE id = ?', paymentId);
}

export function cancelPayment(paymentId) {
  const payment = get('SELECT * FROM payments WHERE id = ?', paymentId);
  if (payment?.status !== 'pending') throw new Error('Sadece bekleyen ödemeler iptal edilebilir');
  update('payments', paymentId, { status: 'cancelled' });
}

export async function handleStripeEvent(event) {
  if (event.type !== 'checkout.session.completed') return;
  const session = event.data.object;
  const paymentId = Number(session.metadata?.payment_id || session.client_reference_id);
  if (paymentId && session.payment_status === 'paid') {
    await markPaid(paymentId, { providerRef: session.payment_intent || session.id });
  }
}

export function listPayments() {
  return all(`SELECT pay.*, c.name AS customer_name, p.title AS project_title,
                (SELECT number FROM invoices i WHERE i.payment_id = pay.id AND i.kind = 'sale') AS invoice_number
              FROM payments pay
              LEFT JOIN customers c ON c.id = pay.customer_id
              LEFT JOIN projects p ON p.id = pay.project_id
              ORDER BY pay.id DESC`);
}
