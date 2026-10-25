/**
 * POST /functions/v1/billing — owner-only subscription management.
 *
 *   select_plan { orgId, plan }      → { checkoutUrl } for a new subscription, or { changed: true }
 *   cancel      { orgId }            → cancel at the end of the paid period
 *   resume      { orgId }            → undo a scheduled cancellation
 *   portal      { orgId }            → { url } of the provider's customer portal (payment method etc.)
 *   invoices    { orgId }            → { invoices: [...] } subscription invoices
 *   invoice_pdf { orgId, invoiceId } → { url }
 *
 * The plan shown in the app changes only when the provider's webhook confirms it.
 */
import { z } from 'zod';
import { BillingError, type BillingProvider } from '../_shared/billing.ts';
import { corsHeaders, json, sqlErrorResponse } from '../_shared/http.ts';
import type { Rpc } from '../_shared/supabase.ts';

export interface Deps {
  allowedOrigins: string[];
  billing: BillingProvider;
  userFromToken(token: string): Promise<string | null>;
  rpc: Rpc;
}

const orgId = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const bodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('select_plan'),
    orgId,
    plan: z.string().regex(/^[a-z][a-z0-9_]{1,30}$/),
  }),
  z.object({ action: z.literal('cancel'), orgId }),
  z.object({ action: z.literal('resume'), orgId }),
  z.object({ action: z.literal('portal'), orgId }),
  z.object({ action: z.literal('invoices'), orgId }),
  z.object({
    action: z.literal('invoice_pdf'),
    orgId,
    invoiceId: z.string().regex(/^txn_[a-z0-9]{10,40}$/),
  }),
]);

interface SubInfo {
  provider: string | null;
  customerId: string | null;
  subscriptionId: string | null;
  status: string;
  cancelAtPeriodEnd: boolean;
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  const cors = corsHeaders(req.headers.get('Origin'), deps.allowedOrigins);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' }, cors);

  const token = /^Bearer (.+)$/.exec(req.headers.get('Authorization') ?? '')?.[1];
  const userId = token ? await deps.userFromToken(token) : null;
  if (!userId) return json(401, { error: 'Please sign in again', code: 'SA401' }, cors);

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json(400, { error: 'Invalid request', code: 'SA422' }, cors);
  const body = parsed.data;
  if (!deps.billing.configured) {
    return json(503, { error: 'Online billing is not set up yet.', code: 'not_configured' }, cors);
  }

  try {
    if (body.action === 'select_plan') {
      const prep = await deps.rpc('billing_prepare', {
        p_user: userId,
        p_org: body.orgId,
        p_plan: body.plan,
      });
      if (prep.error) return sqlErrorResponse(prep.error, cors);
      const p = prep.data as {
        priceId: string;
        customerId: string | null;
        subscriptionId: string | null;
      };
      if (p.subscriptionId) {
        await deps.billing.changePlan(p.subscriptionId, p.priceId);
        return json(200, { changed: true }, cors);
      }
      const { url } = await deps.billing.createCheckout({
        priceId: p.priceId,
        orgId: body.orgId,
        customerId: p.customerId,
      });
      return json(200, { checkoutUrl: url }, cors);
    }

    const info = await deps.rpc('billing_subscription', { p_user: userId, p_org: body.orgId });
    if (info.error) return sqlErrorResponse(info.error, cors);
    const sub = info.data as SubInfo;
    if (sub.provider !== deps.billing.name || !sub.customerId) {
      return json(
        409,
        { error: 'There is no paid subscription for this organization yet.', code: 'SA409' },
        cors,
      );
    }

    switch (body.action) {
      case 'cancel':
        if (!sub.subscriptionId) break;
        await deps.billing.cancelAtPeriodEnd(sub.subscriptionId);
        return json(200, { ok: true }, cors);
      case 'resume':
        if (!sub.subscriptionId) break;
        await deps.billing.resume(sub.subscriptionId);
        return json(200, { ok: true }, cors);
      case 'portal':
        return json(
          200,
          { url: await deps.billing.portalUrl(sub.customerId, sub.subscriptionId) },
          cors,
        );
      case 'invoices':
        return json(200, { invoices: await deps.billing.listInvoices(sub.customerId) }, cors);
      case 'invoice_pdf':
        return json(
          200,
          { url: await deps.billing.invoicePdfUrl(sub.customerId, body.invoiceId) },
          cors,
        );
    }
    return json(409, { error: 'There is no active subscription to change.', code: 'SA409' }, cors);
  } catch (err) {
    if (err instanceof BillingError) return json(err.status, { error: err.message }, cors);
    console.error(JSON.stringify({ fn: 'billing', error: String(err) }));
    return json(500, { error: 'Something went wrong. Please try again.' }, cors);
  }
}
