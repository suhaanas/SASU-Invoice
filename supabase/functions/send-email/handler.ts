/**
 * POST /functions/v1/send-email — send an invoice email the user wrote/edited.
 *
 *   { invoiceId, kind, to, subject, body, requestId }  →  { messageId, status, error? }
 *
 * `requestId` (a UUID made by the browser per click) is the idempotency key:
 * a double click or a network retry returns the first attempt's result.
 */
import { z } from 'npm:zod@4.6.5';
import {
  EMAIL_KINDS,
  MAX_BODY,
  MAX_SUBJECT,
  renderEmail,
  unknownPlaceholders,
} from '../_shared/core/emails.ts';
import {
  fromHeader,
  templateVars,
  type EmailProvider,
  type SendContext,
} from '../_shared/email.ts';
import { corsHeaders, json, tooManyRequests, sqlErrorResponse } from '../_shared/http.ts';
import { overLimit, type Rpc } from '../_shared/supabase.ts';

export interface Deps {
  allowedOrigins: string[];
  appUrl: string;
  fromAddress: string;
  provider: EmailProvider;
  userFromToken(token: string): Promise<string | null>;
  rpc: Rpc;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const bodySchema = z.object({
  invoiceId: z.string().regex(UUID),
  kind: z.enum(EMAIL_KINDS),
  to: z.string().trim().min(3).max(254),
  subject: z.string().trim().min(1).max(MAX_SUBJECT),
  body: z.string().trim().min(1).max(MAX_BODY),
  requestId: z.string().regex(UUID),
});

export async function handle(req: Request, deps: Deps): Promise<Response> {
  const cors = corsHeaders(req.headers.get('Origin'), deps.allowedOrigins);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' }, cors);

  const token = /^Bearer (.+)$/.exec(req.headers.get('Authorization') ?? '')?.[1];
  const userId = token ? await deps.userFromToken(token) : null;
  if (!userId) return json(401, { error: 'Please sign in again', code: 'SA401' }, cors);
  if (await overLimit(deps.rpc, `send-email:${userId}`, 20)) return tooManyRequests(cors);

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return json(400, { error: 'Check the email fields and try again.', code: 'SA422' }, cors);
  const input = parsed.data;
  const unknown = unknownPlaceholders(`${input.subject}\n${input.body}`);
  if (unknown.length > 0) {
    return json(422, { error: `Unknown placeholder: {{${unknown[0]}}}`, code: 'SA422' }, cors);
  }

  const prep = await deps.rpc('rf_prepare_manual_email', {
    p_user: userId,
    p_invoice: input.invoiceId,
    p_kind: input.kind,
    p_to: input.to,
    p_idempotency_key: `manual:${input.requestId.toLowerCase()}`,
  });
  if (prep.error) return sqlErrorResponse(prep.error, cors);
  const ctx = prep.data as SendContext & { duplicate: boolean; status?: string };
  if (ctx.duplicate)
    return json(200, { messageId: ctx.messageId, status: ctx.status, duplicate: true }, cors);

  const vars = templateVars(ctx, deps.appUrl);
  const email = renderEmail({
    template: { subject: input.subject, body: input.body },
    tone: 'professional',
    vars,
  });
  // Make sure the client can always open the invoice.
  if (!email.text.includes(vars.link!)) {
    Object.assign(
      email,
      renderEmail({
        template: { subject: input.subject, body: `${input.body}\n\n{{link}}` },
        tone: 'professional',
        vars,
      }),
    );
  }

  const result = await deps.provider.send({
    from: fromHeader(ctx.fromName, deps.fromAddress),
    to: input.to.toLowerCase(),
    replyTo: ctx.replyTo,
    subject: email.subject,
    text: email.text,
    htmlBody: email.htmlBody,
    idempotencyKey: `manual:${input.requestId.toLowerCase()}`,
    messageId: ctx.messageId,
  });

  if (result.ok) {
    const done = await deps.rpc('rf_mark_accepted', {
      p_message: ctx.messageId,
      p_provider: deps.provider.name,
      p_provider_message_id: result.providerMessageId,
      p_subject: email.subject,
      p_body: email.text,
    });
    if (done.error) return sqlErrorResponse(done.error, cors);
    return json(200, { messageId: ctx.messageId, status: 'accepted' }, cors);
  }
  await deps.rpc('rf_mark_failed', {
    p_message: ctx.messageId,
    p_error: result.error,
    p_permanent: true,
  });
  return json(
    deps.provider.configured ? 502 : 503,
    {
      messageId: ctx.messageId,
      status: 'failed',
      error: deps.provider.configured ? 'The email provider rejected the message.' : result.error,
    },
    cors,
  );
}
