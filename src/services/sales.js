import { config } from '../config.js';
import { all, get, insert, run, update } from '../db.js';
import { AiUnavailableError, callClaude, mockGuard } from './ai.js';
import { notifyAdmin, sendMail } from './notify.js';
import { getSection } from './settings.js';
import { sendWhatsApp } from './whatsapp.js';

// Imported lazily to avoid circular imports (projects/prospecting -> sales -> ...).
const projects = () => import('./projects.js');
const prospecting = () => import('./prospecting.js');

const SALES_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reply', 'customer_sentiment', 'intent', 'needs_human', 'needs_human_reason',
    'recommended_product_ids', 'deal', 'demo_decision', 'change_requests'],
  properties: {
    reply: { type: 'string', description: 'Müşteriye gönderilecek mesaj' },
    customer_sentiment: { type: 'string', enum: ['positive', 'neutral', 'negative'] },
    intent: { type: 'string', enum: ['greeting', 'browsing', 'pricing', 'negotiating', 'ready_to_buy', 'complaint', 'support', 'other'] },
    needs_human: { type: 'boolean' },
    needs_human_reason: { type: 'string' },
    recommended_product_ids: { type: 'array', items: { type: 'integer' } },
    deal: {
      type: 'object',
      additionalProperties: false,
      required: ['agreed', 'title', 'requirements', 'theme_name', 'language_name', 'price', 'currency'],
      properties: {
        agreed: { type: 'boolean' },
        title: { type: 'string' },
        requirements: { type: 'string' },
        theme_name: { type: 'string' },
        language_name: { type: 'string' },
        price: { type: 'number' },
        currency: { type: 'string' },
      },
    },
    demo_decision: { type: 'string', enum: ['none', 'approved', 'changes_requested'] },
    change_requests: { type: 'string' },
  },
};

export function catalog() {
  return {
    products: all('SELECT id, name, description, category, price, currency, features, demo_url FROM products WHERE active = 1 ORDER BY id'),
    themes: all('SELECT id, name, description, preview_url FROM themes WHERE active = 1 ORDER BY name'),
    languages: all('SELECT id, name, description FROM languages WHERE active = 1 ORDER BY name'),
  };
}

function systemPrompt(conv) {
  const business = getSection('business');
  const ai = getSection('ai');
  const { products, themes, languages } = catalog();
  const project = conv.project_id ? get('SELECT * FROM projects WHERE id = ?', conv.project_id) : null;
  const lines = [
    `Sen "${business.name}" adlı yazılım/web tasarım işletmesinin satış temsilcisisin. Kişiliğin: ${ai.sales_persona}`,
    'Görevin müşteriyi anlamak, ihtiyacına uygun ürünü önermek, fiyat tablosuna göre fiyat vermek ve satışı kapatmak.',
    'Kurallar:',
    '- Müşterinin yazdığı dilde, kısa ve doğal mesajlar yaz (WhatsApp tarzı, en fazla birkaç paragraf).',
    '- Fiyatları YALNIZCA aşağıdaki fiyat tablosundan ver. Tabloda olmayan bir iş için tahmini fiyat uydurma; needs_human=true yap.',
    `- En fazla %${ai.max_discount_percent} indirim yapabilirsin. Daha fazlası istenirse needs_human=true yap.`,
    '- Örnek göstermek istersen ürünün demo bağlantısını paylaş.',
    '- Müşteri gerçek bir insanla görüşmek isterse, ciddi şikayeti varsa veya emin olmadığın bir konu varsa needs_human=true yap.',
    '- Müşteri net olarak bir ürünü/işi ve fiyatı kabul ettiğinde deal.agreed=true yap; title, requirements (tüm istekleri ayrıntılı yaz), tema, dil/teknoloji, price ve currency alanlarını doldur. Aksi halde deal.agreed=false ve diğer alanları boş/0 bırak.',
    '- Tema veya teknoloji seçilmediyse müşteriye aşağıdaki seçeneklerden sor.',
    '- Ödeme bilgisi (IBAN vb.) kendin yazma; sistem bunu otomatik gönderir.',
    '',
    `FİYAT TABLOSU / ÜRÜNLER (JSON): ${JSON.stringify(products)}`,
    `TEMALAR: ${JSON.stringify(themes)}`,
    `PROGRAMLAMA DİLİ / TEKNOLOJİ SEÇENEKLERİ: ${JSON.stringify(languages)}`,
  ];
  if (project) {
    lines.push('', `Bu müşterinin aktif projesi var: ${JSON.stringify({ title: project.title, status: project.status, demo_url: project.demo_url, price: project.price, currency: project.currency })}`);
    if (project.status === 'demo_live') {
      lines.push('Demo müşteriye gönderildi. Müşteri demoyu beğendiğini açıkça söylerse demo_decision="approved", değişiklik isterse demo_decision="changes_requested" yap ve istekleri change_requests alanına yaz. Aksi halde "none".');
    } else {
      lines.push('Proje durumu hakkında soru sorulursa durumu nazikçe açıkla. demo_decision="none" kullan.');
    }
  } else {
    lines.push('', 'demo_decision her zaman "none" olmalı.');
  }
  return lines.join('\n');
}

function historyMessages(convId, { keepTrailingAssistant = false } = {}) {
  const rows = all('SELECT sender, body FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 40', convId).reverse();
  const msgs = [];
  for (const r of rows) {
    if (r.sender === 'system') continue;
    const role = r.sender === 'customer' ? 'user' : 'assistant';
    const content = r.sender === 'admin' ? `[Yetkili mesajı] ${r.body}` : r.body;
    const last = msgs[msgs.length - 1];
    if (last && last.role === role) last.content += `\n${content}`;
    else msgs.push({ role, content });
  }
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  // Prefill is not supported: the conversation must end on the customer's turn.
  while (!keepTrailingAssistant && msgs.length && msgs[msgs.length - 1].role !== 'user') msgs.pop();
  return msgs;
}

function mockSalesReply(conv, text) {
  mockGuard('sales');
  const t = text.toLocaleLowerCase('tr');
  const { products } = catalog();
  const project = conv.project_id ? get('SELECT * FROM projects WHERE id = ?', conv.project_id) : null;
  const base = {
    reply: '', customer_sentiment: 'neutral', intent: 'other', needs_human: false, needs_human_reason: '',
    recommended_product_ids: [], demo_decision: 'none', change_requests: '',
    deal: { agreed: false, title: '', requirements: '', theme_name: '', language_name: '', price: 0, currency: '' },
  };
  if (/yetkili|insan|gerçek kişi|müdür/.test(t)) {
    return { ...base, reply: 'Elbette, sizi hemen bir yetkilimize aktarıyorum.', needs_human: true, needs_human_reason: 'Müşteri yetkili istedi', intent: 'support' };
  }
  if (/berbat|rezalet|memnun değil|kötü|şikayet/.test(t)) {
    return { ...base, reply: 'Yaşadığınız sorun için üzgünüm, nasıl yardımcı olabilirim?', customer_sentiment: 'negative', intent: 'complaint' };
  }
  if (project?.status === 'demo_live') {
    if (/beğendim|harika|onay|süper/.test(t)) return { ...base, reply: 'Çok sevindim! Ödeme bilgilerini hemen iletiyorum.', customer_sentiment: 'positive', demo_decision: 'approved' };
    if (/değiş|düzelt|olmamış/.test(t)) return { ...base, reply: 'Not aldım, değişiklikleri ekibimize iletiyorum.', demo_decision: 'changes_requested', change_requests: text };
  }
  if (/anlaştık|kabul|tamam(dır)? başla|sipariş/.test(t) && products[0] && !project) {
    const p = products[0];
    return {
      ...base, reply: `Harika! ${p.name} için ${p.price} ${p.currency} üzerinden anlaştık. Hemen çalışmaya başlıyoruz.`,
      customer_sentiment: 'positive', intent: 'ready_to_buy',
      deal: { agreed: true, title: p.name, requirements: `${p.description}\nMüşteri notu: ${text}`, theme_name: '', language_name: '', price: p.price, currency: p.currency },
    };
  }
  if (/fiyat|ücret|ne kadar|kaç para/.test(t)) {
    const list = products.map((p) => `• ${p.name}: ${p.price} ${p.currency}`).join('\n') || 'Fiyat tablomuz henüz hazır değil.';
    return { ...base, reply: `Fiyatlarımız şöyle:\n${list}\nHangisi ilginizi çeker?`, intent: 'pricing', recommended_product_ids: products.map((p) => p.id) };
  }
  return { ...base, reply: `Merhaba! ${getSection('business').name} olarak size nasıl yardımcı olabiliriz? Web sitesi, e-ticaret veya özel yazılım ihtiyacınızı anlatabilirsiniz.`, intent: 'greeting' };
}

async function salesReply(conv, lastText) {
  if (config.aiMock) return mockSalesReply(conv, lastText);
  const messages = historyMessages(conv.id);
  if (!messages.length) messages.push({ role: 'user', content: lastText });
  return callClaude({ purpose: 'sales', system: systemPrompt(conv), messages, schema: SALES_SCHEMA, maxTokens: 4000, effort: 'medium' });
}

/** Short, polite nudge for a customer who went quiet. Returns null when the AI is unavailable. */
export async function aiFollowup(conv) {
  try {
    if (config.aiMock) {
      mockGuard('followup');
      return 'Merhaba, size dönüş yapmak istedik. Aklınıza takılan bir soru varsa yardımcı olmaktan memnuniyet duyarız. 😊';
    }
    const messages = historyMessages(conv.id, { keepTrailingAssistant: true });
    messages.push({ role: 'user', content: '[Sistem notu: Müşteri bir süredir cevap vermedi. Ona kısa, baskıcı olmayan bir takip mesajı yaz. Sadece mesaj metnini döndür.]' });
    const system = systemPrompt(conv);
    return await callClaude({ purpose: 'followup', system, messages: mergeUserTurns(messages), effort: 'low', maxTokens: 1500 });
  } catch (err) {
    if (err instanceof AiUnavailableError) return null;
    throw err;
  }
}

function mergeUserTurns(msgs) {
  const out = [];
  for (const m of msgs) {
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content += `\n${m.content}`;
    else out.push({ ...m });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Conversation management
// ---------------------------------------------------------------------------

export function findOrCreateConversation({ channel, externalId, name = '', email = null, phone = null, platform = null }) {
  let conv = externalId
    ? get(`SELECT * FROM conversations WHERE channel = ? AND external_id = ? AND status != 'closed' ORDER BY id DESC LIMIT 1`, channel, externalId)
    : null;
  if (conv) return conv;
  let customer = phone ? get('SELECT * FROM customers WHERE phone = ?', phone) : null;
  customer ??= email ? get('SELECT * FROM customers WHERE email = ?', email) : null;
  const customerId = customer?.id ?? insert('customers', { name: name || phone || email || 'Ziyaretçi', email, phone, platform });
  const id = insert('conversations', { customer_id: customerId, channel, external_id: externalId });
  return get('SELECT * FROM conversations WHERE id = ?', id);
}

export function addMessage(conversationId, sender, body, meta = null) {
  const id = insert('messages', { conversation_id: conversationId, sender, body, meta: meta ? JSON.stringify(meta) : null });
  run(`UPDATE conversations SET last_message_at = datetime('now') WHERE id = ?`, conversationId);
  return id;
}

/** Push a message out through the conversation's channel. */
export async function deliver(conv, text) {
  const customer = get('SELECT * FROM customers WHERE id = ?', conv.customer_id);
  try {
    if (conv.channel === 'whatsapp') await sendWhatsApp(conv.external_id, text);
    else if (conv.channel === 'email' && customer?.email) {
      await sendMail({ to: customer.email, subject: `${getSection('business').name} - mesajınız var`, text });
    }
    // 'web' chats poll for new messages; 'platform' threads are relayed by the admin.
  } catch (err) {
    console.error('Mesaj iletilemedi:', err.message);
    await notifyAdmin('delivery_failed', 'Müşteriye mesaj iletilemedi', `Konuşma #${conv.id}: ${err.message}`, `/conversations/${conv.id}`);
  }
}

/** Send a system-authored message (payment info, demo link...) to the customer. */
export async function sendToCustomer(conversationId, text, sender = 'ai') {
  const conv = get('SELECT * FROM conversations WHERE id = ?', conversationId);
  if (!conv) return;
  addMessage(conv.id, sender, text);
  await deliver(conv, text);
}

export async function escalate(conv, reason, detail = '') {
  const customer = get('SELECT * FROM customers WHERE id = ?', conv.customer_id);
  const wasAi = conv.mode === 'ai';
  update('conversations', conv.id, { mode: 'human', status: 'escalated', escalation_reason: reason });
  addMessage(conv.id, 'system', `Konuşma yöneticiye aktarıldı: ${reason}${detail ? ` (${detail})` : ''}`);
  const last = get(`SELECT body FROM messages WHERE conversation_id = ? AND sender = 'customer' ORDER BY id DESC LIMIT 1`, conv.id);
  await notifyAdmin('escalation', `Konuşma devralınmayı bekliyor: ${customer?.name || '#' + conv.id}`,
    `Sebep: ${reason}${detail ? `\nAyrıntı: ${detail}` : ''}\nKanal: ${conv.channel}\nSon müşteri mesajı: ${last?.body || '-'}`,
    `/conversations/${conv.id}`);
  if (wasAi) {
    await sendToCustomer(conv.id, 'Size daha iyi yardımcı olabilmesi için talebinizi yetkili arkadaşımıza ilettim; en kısa sürede dönüş yapacak.', 'ai');
  }
}

function unsatisfiedStreak(convId) {
  const rows = all(`SELECT meta FROM messages WHERE conversation_id = ? AND sender = 'ai' AND meta IS NOT NULL ORDER BY id DESC LIMIT 5`, convId);
  let n = 0;
  for (const r of rows) {
    if (JSON.parse(r.meta).customer_sentiment === 'negative') n++;
    else break;
  }
  return n;
}

async function respondWithAi(conv, text) {
  let result;
  try {
    result = await salesReply(conv, text);
  } catch (err) {
    if (err instanceof AiUnavailableError) {
      await escalate(conv, err.message);
      return null;
    }
    throw err;
  }
  const meta = {
    customer_sentiment: result.customer_sentiment,
    intent: result.intent,
    recommended_product_ids: result.recommended_product_ids,
  };
  addMessage(conv.id, 'ai', result.reply, meta);
  await deliver(conv, result.reply);

  const p = await projects();
  if (result.needs_human) {
    await escalate(conv, 'Yapay zeka yetkili gerektiğine karar verdi', result.needs_human_reason);
  } else if (unsatisfiedStreak(conv.id) >= getSection('ai').escalate_after_unsatisfied) {
    await escalate(conv, 'Müşteri yanıtlardan memnun değil');
  }

  if (result.deal?.agreed && !conv.project_id) {
    if (!(result.deal.price > 0)) {
      await escalate(conv, 'Anlaşma sağlandı ama fiyat belirlenemedi', result.deal.title);
    } else {
      await p.createProjectFromDeal(conv, result.deal);
    }
  }
  if (conv.project_id && result.demo_decision === 'approved') await p.customerApproved(conv.project_id);
  if (conv.project_id && result.demo_decision === 'changes_requested') await p.customerRequestedChanges(conv.project_id, result.change_requests);
  return result.reply;
}

/**
 * Entry point for every inbound customer message (WhatsApp, web chat, e-mail...).
 * Returns the AI reply text, or null when a human handles the conversation.
 */
export async function handleIncoming({ channel, externalId, name, email, phone, text }) {
  const conv = findOrCreateConversation({ channel, externalId, name, email, phone });
  return handleInConversation(conv, text);
}

/** Process a customer message for a known conversation (also used for hand-relayed WhatsApp). */
export async function handleInConversation(conv, text) {
  addMessage(conv.id, 'customer', text);
  const customer = get('SELECT * FROM customers WHERE id = ?', conv.customer_id);
  const out = (await prospecting()).onInboundMessage(conv, customer, text);
  if (out.optedOut) {
    update('conversations', conv.id, { status: 'closed', mode: 'human' });
    const reply = 'Kaydınızı sildik, bundan sonra size mesaj gönderilmeyecek. İyi çalışmalar dileriz.';
    await sendToCustomer(conv.id, reply, 'ai');
    return { conversationId: conv.id, reply, optedOut: true };
  }
  if (conv.mode === 'human') {
    await notifyAdmin('customer_message', `Yeni müşteri mesajı: ${customer?.name || '#' + conv.id}`, text, `/conversations/${conv.id}`);
    return { conversationId: conv.id, reply: null };
  }
  const reply = await respondWithAi(conv, text);
  return { conversationId: conv.id, reply };
}

/** Let the AI open a conversation itself (e.g. first contact with a lead). */
export async function aiOpenConversation(convId, firstMessage) {
  await sendToCustomer(convId, firstMessage, 'ai');
}

export async function takeover(convId) {
  update('conversations', convId, { mode: 'human', status: 'open' });
  addMessage(convId, 'system', 'Yönetici konuşmayı devraldı.');
}

export async function releaseToAi(convId) {
  update('conversations', convId, { mode: 'ai', status: 'open', escalation_reason: null });
  addMessage(convId, 'system', 'Konuşma tekrar yapay zekaya devredildi.');
}

export async function adminSend(convId, text) {
  const conv = get('SELECT * FROM conversations WHERE id = ?', convId);
  if (!conv) throw new Error('Konuşma bulunamadı');
  if (conv.mode === 'ai') await takeover(convId);
  await sendToCustomer(convId, text, 'admin');
}
