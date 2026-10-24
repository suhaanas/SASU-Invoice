/**
 * POST /functions/v1/email-webhook — delivery events from Resend (Svix-signed).
 * Unsigned or stale requests are rejected; each event is applied once.
 */
import { json } from '../_shared/http.ts';
import type { Rpc } from '../_shared/supabase.ts';
import { verifySvix } from '../_shared/webhook.ts';

export interface Deps {
  secret: string;
  rpc: Rpc;
  nowSeconds?: () => number;
}

interface ResendEvent {
  type?: string;
  created_at?: string;
  data?: { email_id?: string; bounce?: { message?: string; type?: string } };
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });
  const body = await req.text();
  if (body.length > 256 * 1024) return json(413, { error: 'Too large' });
  const ok = await verifySvix(deps.secret, req.headers, body, deps.nowSeconds?.());
  if (!ok) return json(401, { error: 'Invalid signature' });

  let event: ResendEvent;
  try {
    event = JSON.parse(body) as ResendEvent;
  } catch {
    return json(400, { error: 'Invalid JSON' });
  }
  const providerId = event.data?.email_id;
  if (!event.type || !providerId) return json(200, { ignored: true });
  const occurred = Number.isNaN(Date.parse(event.created_at ?? ''))
    ? new Date().toISOString()
    : event.created_at;

  const { data, error } = await deps.rpc('rf_apply_email_event', {
    p_event_id: req.headers.get('svix-id'),
    p_provider_message_id: providerId,
    p_type: event.type,
    p_occurred_at: occurred,
    p_detail: event.data?.bounce?.message ?? null,
  });
  // 5xx makes the provider retry later; anything else is acknowledged.
  if (error) return json(500, { error: 'Could not record event' });
  return json(200, { applied: data === true });
}
