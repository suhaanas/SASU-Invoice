/**
 * Transactional email behind a small provider interface (Resend today). Every
 * send carries an idempotency key so a retried request can't email twice.
 *
 * Mail is sent from the platform's verified address; the business appears as
 * the display name and Reply-To, so nobody can send as an unverified domain.
 */
import { formatDate } from './core/dates.ts';
import { formatMoney } from './core/money.ts';
import type { TemplateVars } from './core/emails.ts';

export interface OutgoingEmail {
  from: string;
  to: string;
  replyTo: string | null;
  subject: string;
  text: string;
  htmlBody: string;
  idempotencyKey: string;
  messageId: string;
}

export type SendResult =
  { ok: true; providerMessageId: string } | { ok: false; error: string; permanent: boolean };

export interface EmailProvider {
  readonly name: string;
  readonly configured: boolean;
  send(email: OutgoingEmail): Promise<SendResult>;
}

export class ResendProvider implements EmailProvider {
  readonly name = 'resend';
  readonly configured = true;
  constructor(
    private readonly apiKey: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async send(email: OutgoingEmail): Promise<SendResult> {
    let res: Response;
    try {
      res = await this.fetchFn('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': email.idempotencyKey,
        },
        body: JSON.stringify({
          from: email.from,
          to: [email.to],
          ...(email.replyTo ? { reply_to: email.replyTo } : {}),
          subject: email.subject,
          text: email.text,
          html: email.htmlBody,
          tags: [{ name: 'message_id', value: email.messageId }],
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      return { ok: false, error: `Network error: ${(err as Error).name}`, permanent: false };
    }
    const body = (await res.json().catch(() => null)) as { id?: string; message?: string } | null;
    if (res.ok && body?.id) return { ok: true, providerMessageId: body.id };
    const error = `Resend ${res.status}: ${body?.message ?? 'request failed'}`.slice(0, 500);
    // 429 and 5xx are worth retrying; other 4xx (bad address, unverified domain…) are not.
    return { ok: false, error, permanent: res.status !== 429 && res.status < 500 };
  }
}

/** Used when no provider is configured: fails loudly instead of pretending to send. */
export class NotConfiguredProvider implements EmailProvider {
  readonly name = 'none';
  readonly configured = false;
  send(): Promise<SendResult> {
    return Promise.resolve({
      ok: false,
      error: 'Email sending is not set up yet (RESEND_API_KEY / EMAIL_FROM_ADDRESS missing).',
      permanent: true,
    });
  }
}

export function providerFromEnv(fetchFn?: typeof fetch): EmailProvider {
  const key = Deno.env.get('RESEND_API_KEY');
  return key && Deno.env.get('EMAIL_FROM_ADDRESS')
    ? new ResendProvider(key, fetchFn)
    : new NotConfiguredProvider();
}

/** `"Acme Ltd via SASU Invoice" <invoices@mail.example.com>` with the name made header-safe. */
export function fromHeader(displayName: string, address: string): string {
  const name =
    displayName
      .replace(/["\\<>\r\n]/g, '')
      .trim()
      .slice(0, 60) || 'SASU Invoice';
  return `"${name} via SASU Invoice" <${address}>`;
}

/** Context returned by rf_prepare_reminder / rf_prepare_manual_email. */
export interface SendContext {
  messageId: string;
  shareToken: string;
  fromName: string;
  replyTo: string | null;
  signature: string;
  businessName: string;
  clientName: string;
  invoiceNumber: string;
  currency: string;
  locale: string;
  amountDueMinor: number;
  totalMinor: number;
  dueDate: string | null;
  daysOverdue: number;
}

export const invoiceLink = (appUrl: string, token: string): string =>
  `${appUrl.replace(/\/+$/, '')}/invoice.html#t=${token}`;

export function templateVars(ctx: SendContext, appUrl: string): TemplateVars {
  const money = (minor: number) => {
    try {
      return formatMoney(minor, ctx.currency, ctx.locale);
    } catch {
      return formatMoney(minor, ctx.currency, 'en-GB');
    }
  };
  return {
    client_name: ctx.clientName || 'there',
    business_name: ctx.businessName,
    invoice_number: ctx.invoiceNumber,
    amount_due: money(ctx.amountDueMinor),
    total: money(ctx.totalMinor),
    due_date: ctx.dueDate ? formatDate(ctx.dueDate, ctx.locale) || ctx.dueDate : 'on receipt',
    days_overdue: String(ctx.daysOverdue),
    link: invoiceLink(appUrl, ctx.shareToken),
    signature: ctx.signature,
  };
}
