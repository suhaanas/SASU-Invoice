/**
 * POST /functions/v1/billing-webhook — Paddle notifications (signed with the
 * endpoint's secret). The only path by which a subscription changes.
 */
import { parsePaddleEvent, verifyOrgTag, verifyPaddle } from '../_shared/billing.ts';
import { json } from '../_shared/http.ts';
import type { Rpc } from '../_shared/supabase.ts';

export interface Deps {
  secret: string;
  rpc: Rpc;
  nowSeconds?: () => number;
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });
  const body = await req.text();
  if (body.length > 512 * 1024) return json(413, { error: 'Too large' });
  if (
    !(await verifyPaddle(
      deps.secret,
      req.headers.get('Paddle-Signature'),
      body,
      deps.nowSeconds?.(),
    ))
  ) {
    return json(401, { error: 'Invalid signature' });
  }
  let parsed;
  try {
    parsed = parsePaddleEvent(JSON.parse(body));
  } catch {
    return json(400, { error: 'Invalid JSON' });
  }
  if (!parsed) return json(400, { error: 'Unrecognised event' });
  // custom_data can be set from a browser checkout, so an organization is only
  // trusted when it carries the signature our billing function adds.
  const tagged = parsed.kind === 'subscription' ? parsed.event : parsed;
  const trustedOrg = (await verifyOrgTag(deps.secret, tagged.orgId, tagged.orgSig))
    ? tagged.orgId
    : null;

  const result =
    parsed.kind === 'subscription'
      ? await deps.rpc('billing_apply_subscription_event', {
          p_provider: 'paddle',
          p_event_id: parsed.event.eventId,
          p_event_type: parsed.event.eventType,
          p_occurred_at: parsed.event.occurredAt,
          p_org: trustedOrg,
          p_subscription_id: parsed.event.subscriptionId,
          p_customer_id: parsed.event.customerId,
          p_price_id: parsed.event.priceId,
          p_provider_status: parsed.event.status,
          p_period_end: parsed.event.periodEnd,
          p_cancel_at_period_end: parsed.event.cancelAtPeriodEnd,
        })
      : await deps.rpc('billing_record_event', {
          p_provider: 'paddle',
          p_event_id: parsed.eventId,
          p_event_type: parsed.eventType,
          p_occurred_at: parsed.occurredAt,
          p_org: trustedOrg,
          p_detail: null,
        });
  // 5xx makes Paddle retry; recorded errors (unknown price…) are acknowledged and visible in the log.
  if (result.error) return json(500, { error: 'Could not record event' });
  return json(200, { outcome: result.data });
}
