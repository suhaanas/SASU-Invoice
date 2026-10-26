/**
 * Subscription billing behind a provider-neutral interface. Paddle (merchant of
 * record: it collects VAT/sales tax and pays out internationally) is the
 * first implementation.
 *
 * Nothing here decides whether someone has paid: subscriptions change only
 * when a verified webhook arrives (see billing-webhook).
 */
import { safeEqual } from './webhook.ts';

export class BillingError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
  }
}

export interface BillingInvoice {
  id: string;
  billedAt: string | null;
  status: string;
  totalMinor: number;
  currency: string;
  invoiceNumber: string | null;
}

export interface BillingProvider {
  readonly name: string;
  readonly configured: boolean;
  createCheckout(input: {
    priceId: string;
    orgId: string;
    customerId: string | null;
  }): Promise<{ url: string }>;
  changePlan(subscriptionId: string, priceId: string): Promise<void>;
  cancelAtPeriodEnd(subscriptionId: string): Promise<void>;
  resume(subscriptionId: string): Promise<void>;
  portalUrl(customerId: string, subscriptionId: string | null): Promise<string>;
  listInvoices(customerId: string): Promise<BillingInvoice[]>;
  invoicePdfUrl(customerId: string, transactionId: string): Promise<string>;
}

type Json = Record<string, unknown>;

export class PaddleProvider implements BillingProvider {
  readonly name = 'paddle';
  readonly configured = true;
  private readonly base: string;

  constructor(
    private readonly apiKey: string,
    environment: 'sandbox' | 'live',
    private readonly fetchFn: typeof fetch = fetch,
    /** Server-only secret that signs the organization tag on checkouts. */
    private readonly tagSecret = '',
  ) {
    this.base =
      environment === 'live' ? 'https://api.paddle.com' : 'https://sandbox-api.paddle.com';
  }

  private async call(method: string, path: string, body?: Json): Promise<Json> {
    let res: Response;
    try {
      res = await this.fetchFn(`${this.base}${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new BillingError('The billing provider could not be reached. Try again shortly.');
    }
    const json = (await res.json().catch(() => ({}))) as {
      data?: Json;
      error?: { detail?: string; code?: string };
    };
    if (!res.ok) {
      console.error(
        JSON.stringify({ billing: 'paddle', path, status: res.status, code: json.error?.code }),
      );
      if (json.error?.code === 'transaction_default_checkout_url_not_set')
        throw new BillingError('Checkout isn’t open yet. Please try again later.', 503);
      throw new BillingError(
        res.status >= 500
          ? 'The billing provider is having problems. Try again shortly.'
          : 'The billing provider refused the request.',
        res.status >= 500 ? 502 : 422,
      );
    }
    return json.data ?? {};
  }

  async createCheckout(input: { priceId: string; orgId: string; customerId: string | null }) {
    const data = await this.call('POST', '/transactions', {
      items: [{ price_id: input.priceId, quantity: 1 }],
      // Paddle.js can set custom_data from the browser too, so the webhook only
      // trusts an org_id that carries our signature.
      custom_data: {
        org_id: input.orgId,
        ...(this.tagSecret ? { org_sig: await orgTag(this.tagSecret, input.orgId) } : {}),
      },
      ...(input.customerId ? { customer_id: input.customerId } : {}),
      collection_mode: 'automatic',
    });
    const url = (data.checkout as { url?: string } | undefined)?.url;
    if (!url) throw new BillingError('Checkout is not set up (no default payment link in Paddle).');
    return { url };
  }

  async changePlan(subscriptionId: string, priceId: string) {
    await this.call('PATCH', `/subscriptions/${encodeURIComponent(subscriptionId)}`, {
      items: [{ price_id: priceId, quantity: 1 }],
      proration_billing_mode: 'prorated_immediately',
    });
  }

  async cancelAtPeriodEnd(subscriptionId: string) {
    await this.call('POST', `/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, {
      effective_from: 'next_billing_period',
    });
  }

  async resume(subscriptionId: string) {
    await this.call('PATCH', `/subscriptions/${encodeURIComponent(subscriptionId)}`, {
      scheduled_change: null,
    });
  }

  async portalUrl(customerId: string, subscriptionId: string | null) {
    const data = await this.call(
      'POST',
      `/customers/${encodeURIComponent(customerId)}/portal-sessions`,
      {
        subscription_ids: subscriptionId ? [subscriptionId] : [],
      },
    );
    const url = ((data.urls as Json | undefined)?.general as { overview?: string } | undefined)
      ?.overview;
    if (!url) throw new BillingError('The billing portal is unavailable.');
    return url;
  }

  async listInvoices(customerId: string) {
    const params = new URLSearchParams({
      customer_id: customerId,
      status: 'completed,past_due,billed',
      order_by: 'billed_at[DESC]',
      per_page: '24',
    });
    const res = await this.fetchList(`/transactions?${params}`);
    return res.map((t) => ({
      id: String(t.id),
      billedAt: (t.billed_at as string | null) ?? null,
      status: String(t.status),
      totalMinor: Number(
        ((t.details as Json | undefined)?.totals as Json | undefined)?.grand_total ?? 0,
      ),
      currency: String(t.currency_code ?? ''),
      invoiceNumber: (t.invoice_number as string | null) ?? null,
    }));
  }

  private async fetchList(path: string): Promise<Json[]> {
    const data = await this.call('GET', path);
    return Array.isArray(data) ? (data as Json[]) : [];
  }

  async invoicePdfUrl(customerId: string, transactionId: string) {
    const txn = await this.call('GET', `/transactions/${encodeURIComponent(transactionId)}`);
    // Never hand out another customer's invoice.
    if (txn.customer_id !== customerId) throw new BillingError('Invoice not found', 404);
    const data = await this.call(
      'GET',
      `/transactions/${encodeURIComponent(transactionId)}/invoice`,
    );
    if (typeof data.url !== 'string') throw new BillingError('Invoice not available yet', 404);
    return data.url;
  }
}

export class NotConfiguredBilling implements BillingProvider {
  readonly name = 'none';
  readonly configured = false;
  private fail(): never {
    throw new BillingError('Billing is not set up yet.', 503);
  }
  createCheckout(): Promise<{ url: string }> {
    return Promise.reject(this.fail());
  }
  changePlan(): Promise<void> {
    return Promise.reject(this.fail());
  }
  cancelAtPeriodEnd(): Promise<void> {
    return Promise.reject(this.fail());
  }
  resume(): Promise<void> {
    return Promise.reject(this.fail());
  }
  portalUrl(): Promise<string> {
    return Promise.reject(this.fail());
  }
  listInvoices(): Promise<BillingInvoice[]> {
    return Promise.reject(this.fail());
  }
  invoicePdfUrl(): Promise<string> {
    return Promise.reject(this.fail());
  }
}

export function billingFromEnv(fetchFn?: typeof fetch): BillingProvider {
  const key = Deno.env.get('PADDLE_API_KEY');
  const env = Deno.env.get('PADDLE_ENVIRONMENT') === 'live' ? 'live' : 'sandbox';
  return key
    ? new PaddleProvider(key, env, fetchFn, Deno.env.get('PADDLE_WEBHOOK_SECRET') ?? '')
    : new NotConfiguredBilling();
}

// --- Webhook signatures ------------------------------------------------------------------

const encoder = new TextEncoder();

export async function paddleSignature(
  secret: string,
  timestamp: string,
  body: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}:${body}`));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** HMAC tag binding a checkout to an organization (see createCheckout). */
export function orgTag(secret: string, orgId: string): Promise<string> {
  return paddleSignature(secret, 'org', orgId.toLowerCase());
}

export async function verifyOrgTag(
  secret: string,
  orgId: string | null,
  tag: string | null,
): Promise<boolean> {
  if (!secret || !orgId || !tag) return false;
  return safeEqual(tag, await orgTag(secret, orgId));
}

/** `Paddle-Signature: ts=1671552777;h1=<hex>[;h1=<hex>]`, valid for 5 minutes. */
export async function verifyPaddle(
  secret: string,
  header: string | null,
  body: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  if (!header) return false;
  const parts = header.split(';').map((p) => p.split('=', 2) as [string, string | undefined]);
  const ts = parts.find(([k]) => k === 'ts')?.[1];
  const sigs = parts.filter(([k]) => k === 'h1').map(([, v]) => v ?? '');
  if (!ts || !/^\d+$/.test(ts) || sigs.length === 0) return false;
  if (Math.abs(nowSeconds - Number(ts)) > 300) return false;
  const expected = await paddleSignature(secret, ts, body);
  return sigs.some((s) => safeEqual(s, expected));
}

/** The fields we use from a Paddle subscription event. */
export interface SubscriptionEvent {
  eventId: string;
  eventType: string;
  occurredAt: string;
  orgId: string | null;
  /** Our HMAC of orgId; an orgId without a valid one is not trusted. */
  orgSig: string | null;
  subscriptionId: string;
  customerId: string | null;
  priceId: string | null;
  status: string;
  periodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parsePaddleEvent(raw: unknown):
  | { kind: 'subscription'; event: SubscriptionEvent }
  | {
      kind: 'other';
      eventId: string;
      eventType: string;
      occurredAt: string;
      orgId: string | null;
      orgSig: string | null;
    }
  | null {
  const e = raw as {
    event_id?: string;
    event_type?: string;
    occurred_at?: string;
    data?: {
      id?: string;
      status?: string;
      customer_id?: string;
      custom_data?: { org_id?: string; org_sig?: string } | null;
      items?: { price?: { id?: string } }[];
      current_billing_period?: { ends_at?: string } | null;
      scheduled_change?: { action?: string } | null;
    };
  } | null;
  if (!e?.event_id || !e.event_type || !e.occurred_at || Number.isNaN(Date.parse(e.occurred_at)))
    return null;
  const orgRaw = e.data?.custom_data?.org_id;
  const orgId = typeof orgRaw === 'string' && UUID.test(orgRaw) ? orgRaw : null;
  const sigRaw = e.data?.custom_data?.org_sig;
  const orgSig = typeof sigRaw === 'string' && /^[0-9a-f]{64}$/.test(sigRaw) ? sigRaw : null;
  if (!e.event_type.startsWith('subscription.') || !e.data?.id) {
    return {
      kind: 'other',
      eventId: e.event_id,
      eventType: e.event_type,
      occurredAt: e.occurred_at,
      orgId,
      orgSig,
    };
  }
  return {
    kind: 'subscription',
    event: {
      eventId: e.event_id,
      eventType: e.event_type,
      occurredAt: e.occurred_at,
      orgId,
      orgSig,
      subscriptionId: e.data.id,
      customerId: e.data.customer_id ?? null,
      priceId: e.data.items?.[0]?.price?.id ?? null,
      status: e.data.status ?? 'unknown',
      periodEnd: e.data.current_billing_period?.ends_at ?? null,
      cancelAtPeriodEnd: e.data.scheduled_change?.action === 'cancel',
    },
  };
}
