// GENERATED from src/core by scripts/sync-functions-core.mjs. Do not edit.
/**
 * Email templates for invoices and RecoverFlow reminders. Pure and shared:
 * the dashboard previews with it and the Edge Functions send with it, so what
 * people preview is what clients receive.
 *
 * Templates are plain text with {{placeholders}}. Values are filled in on the
 * server at send time; the HTML version is escaped text, never markup.
 */

export const EMAIL_KINDS = [
  'new_invoice',
  'due_soon',
  'due_today',
  'overdue',
  'follow_up',
  'payment_received',
] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];

export const EMAIL_KIND_LABELS: Record<EmailKind, string> = {
  new_invoice: 'New invoice',
  due_soon: 'Due soon',
  due_today: 'Due today',
  overdue: 'Overdue',
  follow_up: 'Follow-up',
  payment_received: 'Payment received',
};

export const TONES = ['friendly', 'professional', 'neutral', 'firm'] as const;
export type Tone = (typeof TONES)[number];

export const TONE_LABELS: Record<Tone, string> = {
  friendly: 'Friendly',
  professional: 'Professional',
  neutral: 'Neutral',
  firm: 'Firm but respectful',
};

/** Opening/closing lines per tone. Firm is direct, never threatening. */
const TONE_LINES: Record<Tone, { opening: string; closing: string }> = {
  friendly: {
    opening: 'I hope you’re well!',
    closing: 'Thanks so much, and let me know if you have any questions.',
  },
  professional: {
    opening: 'I hope this message finds you well.',
    closing: 'Thank you for your attention to this. Please let me know if you have any questions.',
  },
  neutral: {
    opening: 'This is a note about the invoice below.',
    closing: 'Let me know if anything needs clarifying.',
  },
  firm: {
    opening: 'I’m writing about an outstanding balance that needs your attention.',
    closing:
      'Please arrange payment as soon as possible, or reply to let me know when it will be made. If there is a problem with the invoice, tell me so we can resolve it.',
  },
};

export const PLACEHOLDERS = [
  'client_name',
  'business_name',
  'invoice_number',
  'amount_due',
  'total',
  'due_date',
  'days_overdue',
  'link',
  'signature',
  'tone_opening',
  'tone_closing',
] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];
export type TemplateVars = Partial<Record<Placeholder, string>>;

export interface EmailTemplate {
  subject: string;
  body: string;
}

export const DEFAULT_TEMPLATES: Record<EmailKind, EmailTemplate> = {
  new_invoice: {
    subject: 'Invoice {{invoice_number}} from {{business_name}}',
    body: `Hello {{client_name}},

Please find invoice {{invoice_number}} for {{amount_due}}, due on {{due_date}}.

View and download it here:
{{link}}

Thank you for your business.

{{signature}}`,
  },
  due_soon: {
    subject: 'Reminder: invoice {{invoice_number}} is due on {{due_date}}',
    body: `Hello {{client_name}},

{{tone_opening}} Invoice {{invoice_number}} for {{amount_due}} is due on {{due_date}}.

You can view it and find payment details here:
{{link}}

{{tone_closing}}

{{signature}}`,
  },
  due_today: {
    subject: 'Invoice {{invoice_number}} is due today',
    body: `Hello {{client_name}},

{{tone_opening}} Invoice {{invoice_number}} for {{amount_due}} is due today.

View it and pay here:
{{link}}

{{tone_closing}}

{{signature}}`,
  },
  overdue: {
    subject: 'Invoice {{invoice_number}} is now overdue',
    body: `Hello {{client_name}},

{{tone_opening}} Invoice {{invoice_number}} was due on {{due_date}} and {{amount_due}} is still outstanding.

View it here:
{{link}}

If you’ve already paid, thank you, and please ignore this message.

{{tone_closing}}

{{signature}}`,
  },
  follow_up: {
    subject: 'Following up: invoice {{invoice_number}}',
    body: `Hello {{client_name}},

{{tone_opening}} I’m following up on invoice {{invoice_number}}, which is {{days_overdue}} days past its due date with {{amount_due}} outstanding.

View it here:
{{link}}

If you’ve already paid, thank you, and please ignore this message.

{{tone_closing}}

{{signature}}`,
  },
  payment_received: {
    subject: 'Payment received for invoice {{invoice_number}}',
    body: `Hello {{client_name}},

Thank you, we’ve received your payment for invoice {{invoice_number}}. The remaining balance is {{amount_due}}.

You can view the invoice here:
{{link}}

{{signature}}`,
  },
};

export const MAX_SUBJECT = 200;
export const MAX_BODY = 5000;

export function toneVars(tone: Tone): TemplateVars {
  const t = TONE_LINES[tone];
  return { tone_opening: t.opening, tone_closing: t.closing };
}

/** Replace only the tone lines, keeping every other placeholder for the server to fill. */
export function applyTone(text: string, tone: Tone): string {
  const t = TONE_LINES[tone];
  return text
    .replace(/\{\{\s*tone_opening\s*\}\}/g, t.opening)
    .replace(/\{\{\s*tone_closing\s*\}\}/g, t.closing);
}

/** Placeholders used in a template that we don't know how to fill. */
export function unknownPlaceholders(text: string): string[] {
  const known = new Set<string>(PLACEHOLDERS);
  return [...new Set([...text.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]!))].filter(
    (k) => !known.has(k),
  );
}

/** Fill {{placeholders}}. Missing values become empty; unknown ones are left visible. */
export function fill(text: string, vars: TemplateVars): string {
  return text
    .replace(/\{\{\s*([\w.]+)\s*\}\}/g, (whole, key: string) =>
      (PLACEHOLDERS as readonly string[]).includes(key) ? (vars[key as Placeholder] ?? '') : whole,
    )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Subjects are a single line; header injection is impossible by construction. */
export const cleanSubject = (s: string): string =>
  s
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, MAX_SUBJECT);

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/**
 * HTML version of a filled plain-text email: escaped text with line breaks;
 * only the known invoice link becomes a hyperlink.
 */
export function toHtml(text: string, link?: string): string {
  const parts = link ? text.split(link) : [text];
  const anchor = link
    ? `<a href="${escapeHtml(link)}" style="color:#3f42d6">${escapeHtml(link)}</a>`
    : '';
  const body = parts.map((p) => escapeHtml(p).replace(/\n/g, '<br>')).join(anchor);
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f5f7"><div style="max-width:560px;margin:0 auto;padding:24px;background:#fff;border-radius:12px;font:15px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#16181d">${body}</div></body></html>`;
}

export interface RenderInput {
  template: EmailTemplate;
  tone: Tone;
  vars: TemplateVars;
}

export function renderEmail({ template, tone, vars }: RenderInput): {
  subject: string;
  text: string;
  htmlBody: string;
} {
  const all = { ...toneVars(tone), ...vars };
  const text = fill(template.body, all).slice(0, MAX_BODY);
  return {
    subject: cleanSubject(fill(template.subject, all)),
    text,
    htmlBody: toHtml(text, all.link),
  };
}

/** Which template a reminder sent `offsetDays` from the due date uses by default. */
export function defaultKindForOffset(offsetDays: number): EmailKind {
  if (offsetDays < 0) return 'due_soon';
  if (offsetDays === 0) return 'due_today';
  if (offsetDays <= 3) return 'overdue';
  return 'follow_up';
}

/** The default RecoverFlow schedule offered when reminders are first enabled. */
export const DEFAULT_SCHEDULE: { offsetDays: number; tone: Tone }[] = [
  { offsetDays: -3, tone: 'friendly' },
  { offsetDays: 0, tone: 'friendly' },
  { offsetDays: 3, tone: 'professional' },
  { offsetDays: 7, tone: 'professional' },
  { offsetDays: 14, tone: 'firm' },
];

const BANNED = [
  /\blegal action\b/i,
  /\bcourt\b/i,
  /\bsue\b/i,
  /\blawsuit\b/i,
  /\bpolice\b/i,
  /\bdebt collect/i,
  /\bcollection agency\b/i,
  /\bcredit (score|rating|report)\b/i,
  /\bblacklist/i,
  /\bconsequences\b/i,
  /\bfinal warning\b/i,
];

/**
 * RecoverFlow never sends threats or implied legal/collection claims. Returns
 * the first offending phrase, or null when the text is acceptable.
 */
export function toneViolation(text: string): string | null {
  for (const re of BANNED) {
    const m = re.exec(text);
    if (m) return m[0];
  }
  return null;
}
