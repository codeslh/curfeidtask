import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { get, insert } from '../db.js';
import { getSection } from './settings.js';

// USD per 1M tokens [input, output]; used for the expense dashboard.
const PRICES = {
  'claude-opus-5-5': [4, 20],
  'claude-sonnet-5-5': [2, 10],
  'claude-haiku-5-5': [0.1, 0.5],
  'claude-fable-5-1': [10, 50],
};

/** Raised whenever the AI cannot answer; `reason` drives the admin escalation message. */
export class AiUnavailableError extends Error {
  constructor(reason, message) {
    super(message);
    this.reason = reason; // disabled | budget | credit | rate_limit | auth | refusal | overloaded | error
  }
}

export const AI_REASON_TEXT = {
  disabled: 'Yapay zeka ayarlardan kapatılmış.',
  budget: 'Aylık yapay zeka token bütçesi doldu.',
  credit: 'Yapay zeka hesabının kredisi bitti.',
  rate_limit: 'Yapay zeka istek limiti aşıldı.',
  auth: 'Yapay zeka API anahtarı geçersiz veya yetkisiz.',
  refusal: 'Yapay zeka bu isteği yanıtlamayı reddetti.',
  overloaded: 'Yapay zeka servisi şu an aşırı yoğun.',
  error: 'Yapay zeka servisinde beklenmeyen bir hata oluştu.',
};

let client;
function getClient() {
  client ??= new Anthropic({ apiKey: config.anthropicApiKey || undefined });
  return client;
}

export function monthTokenUsage() {
  const row = get(`SELECT COALESCE(SUM(input_tokens + output_tokens), 0) AS t FROM ai_usage
                   WHERE created_at >= datetime('now', 'start of month')`);
  return row.t;
}

function recordUsage(purpose, model, usage) {
  const [pin, pout] = PRICES[model] || PRICES['claude-opus-5-5'];
  const input = (usage?.input_tokens || 0) + (usage?.cache_creation_input_tokens || 0) + (usage?.cache_read_input_tokens || 0);
  const output = usage?.output_tokens || 0;
  insert('ai_usage', {
    purpose, model,
    input_tokens: input,
    output_tokens: output,
    cost_usd: (input * pin + output * pout) / 1e6,
  });
}

function guard() {
  const ai = getSection('ai');
  if (!ai.enabled) throw new AiUnavailableError('disabled', AI_REASON_TEXT.disabled);
  if (ai.monthly_token_budget > 0 && monthTokenUsage() >= ai.monthly_token_budget) {
    throw new AiUnavailableError('budget', AI_REASON_TEXT.budget);
  }
}

function classify(err) {
  if (err instanceof AiUnavailableError) return err;
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new AiUnavailableError('auth', AI_REASON_TEXT.auth);
  }
  if (err instanceof Anthropic.RateLimitError) return new AiUnavailableError('rate_limit', AI_REASON_TEXT.rate_limit);
  if (err instanceof Anthropic.BadRequestError) {
    // An exhausted credit balance surfaces as a 400 invalid_request_error.
    const credit = /credit balance/i.test(err.message);
    return new AiUnavailableError(credit ? 'credit' : 'error', credit ? AI_REASON_TEXT.credit : `${AI_REASON_TEXT.error} (${err.message})`);
  }
  if (err instanceof Anthropic.InternalServerError) return new AiUnavailableError('overloaded', AI_REASON_TEXT.overloaded);
  if (err instanceof Anthropic.APIError) return new AiUnavailableError('error', `${AI_REASON_TEXT.error} (${err.message})`);
  return new AiUnavailableError('error', `${AI_REASON_TEXT.error} (${err.message})`);
}

/**
 * One Claude call. With `schema` the reply is parsed JSON, otherwise plain text.
 * Long generations (project builds) stream so they do not hit HTTP timeouts.
 */
export async function callClaude({ purpose, system, messages, schema, maxTokens = 16000, effort = 'medium', stream = false }) {
  guard();
  if (config.aiMock) throw new Error('callClaude must not run in mock mode');
  const params = {
    model: config.aiModel,
    max_tokens: maxTokens,
    system,
    messages,
    output_config: { effort, ...(schema ? { format: { type: 'json_schema', schema } } : {}) },
    // On a safety decline the API re-runs the request on Anthropic's recommended fallback model.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
  };
  let response;
  try {
    response = stream
      ? await getClient().beta.messages.stream(params).finalMessage()
      : await getClient().beta.messages.create(params);
  } catch (err) {
    throw classify(err);
  }
  recordUsage(purpose, response.model || config.aiModel, response.usage);

  if (response.stop_reason === 'refusal') throw new AiUnavailableError('refusal', AI_REASON_TEXT.refusal);
  if (response.stop_reason === 'max_tokens') {
    throw new AiUnavailableError('error', `${AI_REASON_TEXT.error} (yanıt token sınırına takıldı)`);
  }
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  if (!schema) return text;
  try {
    return JSON.parse(text);
  } catch {
    throw new AiUnavailableError('error', `${AI_REASON_TEXT.error} (geçersiz JSON yanıtı)`);
  }
}

/** Mock mode guard shared by the feature modules: still honours disabled/budget settings. */
export function mockGuard(purpose) {
  guard();
  recordUsage(purpose, config.aiModel, { input_tokens: 0, output_tokens: 0 });
}
