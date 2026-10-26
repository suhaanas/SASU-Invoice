/**
 * AI provider for the payment assistant (OpenAI chat completions with strict
 * JSON-schema output). The assistant only writes and analyses text for a
 * person to review; it never changes invoices, payments or statuses.
 *
 * Data minimisation:
 *   - drafts get no client names, emails, addresses or amounts — only
 *     placeholders and facts like "12 days overdue";
 *   - text a user pastes (a client's reply) has emails, phone numbers and
 *     account/card numbers masked before it is sent.
 */

export interface AiRequest {
  system: string;
  user: string;
  schemaName: string;
  schema: Record<string, unknown>;
}

export interface AiResult {
  json: unknown;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export class AiError extends Error {
  constructor(
    message: string,
    readonly kind: 'not_configured' | 'provider' | 'refused' | 'invalid',
  ) {
    super(message);
  }
}

export interface AiProvider {
  readonly configured: boolean;
  complete(req: AiRequest): Promise<AiResult>;
}

export class OpenAiProvider implements AiProvider {
  readonly configured = true;
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async complete(req: AiRequest): Promise<AiResult> {
    let res: Response;
    try {
      res = await this.fetchFn('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          temperature: 0.4,
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: req.user },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: { name: req.schemaName, strict: true, schema: req.schema },
          },
        }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      throw new AiError(`AI request failed: ${(err as Error).name}`, 'provider');
    }
    const body = (await res.json().catch(() => null)) as {
      model?: string;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      choices?: { message?: { content?: string | null; refusal?: string | null } }[];
      error?: { message?: string };
    } | null;
    if (!res.ok) throw new AiError(`AI provider error ${res.status}`, 'provider');
    const message = body?.choices?.[0]?.message;
    if (message?.refusal) throw new AiError('The assistant declined this request.', 'refused');
    let json: unknown;
    try {
      json = JSON.parse(message?.content ?? '');
    } catch {
      throw new AiError('The assistant returned an unreadable answer.', 'invalid');
    }
    return {
      json,
      model: body?.model ?? this.model,
      inputTokens: body?.usage?.prompt_tokens ?? 0,
      outputTokens: body?.usage?.completion_tokens ?? 0,
    };
  }
}

export class NotConfiguredAi implements AiProvider {
  readonly configured = false;
  complete(): Promise<AiResult> {
    return Promise.reject(
      new AiError('The AI assistant is not set up yet (OPENAI_API_KEY missing).', 'not_configured'),
    );
  }
}

/** Set OPENAI_MODEL to a current model that supports structured outputs. */
export const DEFAULT_MODEL = 'gpt-4.1-mini';

export function aiFromEnv(fetchFn?: typeof fetch): AiProvider {
  const key = Deno.env.get('OPENAI_API_KEY');
  return key
    ? new OpenAiProvider(key, Deno.env.get('OPENAI_MODEL') || DEFAULT_MODEL, fetchFn)
    : new NotConfiguredAi();
}

/** Mask personal and financial identifiers in free text before it leaves our servers. */
export function redact(text: string): string {
  return text
    .replace(/[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}/gi, '[email]')
    .replace(/\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?\b/g, '[account number]')
    .replace(/\b(?:\d[ -]?){13,19}\b/g, '[card or account number]')
    .replace(/(?:\+|\b)\d[\d ()-]{7,}\d\b/g, '[phone]');
}

// --- Schemas (strict mode: every property required; optional values are nullable) ---------

export const DRAFT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['subject', 'body'],
  properties: {
    subject: { type: 'string' },
    body: { type: 'string' },
  },
};

export const ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'summary',
    'intent',
    'dispute',
    'dispute_reason',
    'proposed_payment_date',
    'suggested_actions',
    'suggested_reply',
  ],
  properties: {
    summary: { type: 'string' },
    intent: {
      type: 'string',
      enum: ['will_pay', 'paid_already', 'dispute', 'question', 'needs_more_time', 'other'],
    },
    dispute: { type: 'boolean' },
    dispute_reason: { type: ['string', 'null'] },
    proposed_payment_date: {
      type: ['string', 'null'],
      description: 'YYYY-MM-DD, only if the client states one',
    },
    suggested_actions: { type: 'array', items: { type: 'string' } },
    suggested_reply: { type: 'string' },
  },
};

export const EXPLAIN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'highlights'],
  properties: {
    summary: { type: 'string' },
    highlights: { type: 'array', items: { type: 'string' } },
  },
};

export const WRITING_RULES = `Rules you must follow:
- Write plain text emails. No markdown, no HTML.
- Use these placeholders exactly where the information belongs, and never invent names, amounts, dates or links: {{client_name}}, {{invoice_number}}, {{amount_due}}, {{due_date}}, {{days_overdue}}, {{link}}, {{signature}}.
- Always include {{link}} on its own line, and end with {{signature}}.
- Never threaten, and never mention legal action, courts, debt collectors, credit scores, fees or penalties that aren't stated, or any "final warning". Firm means clear and direct, still polite.
- Never claim the client has or hasn't paid beyond the facts given. Allow for the possibility that payment crossed in the post.
- Keep it under 150 words. Subject under 80 characters.`;
