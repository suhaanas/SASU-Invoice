/**
 * POST /functions/v1/invoices
 *
 *   { action: "save",   orgId, doc, expectedRevision? }  → { id, localId, revision, status, issued }
 *   { action: "import", orgId, docs: [...] }              → { results: [{ localId, result, error? }] }
 *
 * The browser sends the editor document; the server re-validates it with the
 * editor's own zod schema and recomputes totals with the editor's own
 * computeTotals, so stored amounts never depend on what a client claims.
 * Membership, roles, locking and plan limits are enforced in SQL.
 *
 * I/O is injected (`Deps`) so this module is unit-testable without a network.
 */
import { z } from 'zod';
import { computeTotals } from '../_shared/core/calc.ts';
import { invoiceSchema } from '../_shared/core/validate.ts';
import type { InvoiceState } from '../_shared/core/state.ts';
import { overLimit, type Rpc } from '../_shared/supabase.ts';
import { corsHeaders, json, tooManyRequests, sqlErrorResponse } from '../_shared/http.ts';

export const MAX_BODY_BYTES = 8 * 1024 * 1024;
export const MAX_IMPORT = 200;

export interface Deps {
  allowedOrigins: string[];
  /** Resolve the bearer token to a user id, or null if invalid/expired. */
  userFromToken(token: string): Promise<string | null>;
  rpc: Rpc;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const bodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('save'),
    orgId: z.string().regex(UUID),
    doc: z.unknown(),
    expectedRevision: z.number().int().positive().nullable().optional(),
  }),
  z.object({
    action: z.literal('import'),
    orgId: z.string().regex(UUID),
    docs: z.array(z.unknown()).min(1).max(MAX_IMPORT),
  }),
]);

/** Integer minor-unit totals in the shape save_invoice expects. */
export function serverTotals(doc: InvoiceState) {
  const t = computeTotals(doc);
  return {
    subtotal: t.subtotal,
    discount: t.discount,
    tax: t.tax,
    shipping: t.shipping,
    total: t.total,
    paid: t.paid,
    balance: t.balance,
  };
}

/** Parse an editor document for the cloud: schema-valid and with a UUID id. */
export function parseDoc(raw: unknown): { doc: InvoiceState } | { error: string } {
  const r = invoiceSchema.safeParse(raw);
  if (!r.success)
    return {
      error: 'The document is not valid: ' + (r.error.issues[0]?.path.join('.') || 'format'),
    };
  if (!UUID.test(r.data.id)) return { error: 'The document id must be a UUID' };
  return { doc: r.data };
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  const cors = corsHeaders(req.headers.get('Origin'), deps.allowedOrigins);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' }, cors);

  const token = /^Bearer (.+)$/.exec(req.headers.get('Authorization') ?? '')?.[1];
  const userId = token ? await deps.userFromToken(token) : null;
  if (!userId) return json(401, { error: 'Please sign in again', code: 'SA401' }, cors);
  if (await overLimit(deps.rpc, `invoices:${userId}`, 120)) return tooManyRequests(cors);

  if (Number(req.headers.get('Content-Length') ?? 0) > MAX_BODY_BYTES) {
    return json(413, { error: 'Request too large' }, cors);
  }
  let raw: unknown;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) return json(413, { error: 'Request too large' }, cors);
    raw = JSON.parse(text);
  } catch {
    return json(400, { error: 'Invalid JSON' }, cors);
  }
  const body = bodySchema.safeParse(raw);
  if (!body.success) return json(400, { error: 'Invalid request', code: 'SA422' }, cors);

  if (body.data.action === 'save') {
    const parsed = parseDoc(body.data.doc);
    if ('error' in parsed) return json(422, { error: parsed.error, code: 'SA422' }, cors);
    const { data, error } = await deps.rpc('save_invoice', {
      p_user: userId,
      p_org: body.data.orgId,
      p_doc: parsed.doc,
      p_totals: serverTotals(parsed.doc),
      p_expected_revision: body.data.expectedRevision ?? null,
      p_source: 'editor',
    });
    return error ? sqlErrorResponse(error, cors) : json(200, data, cors);
  }

  // Import: invalid documents are reported per row and never reach the database.
  const results: { localId: string | null; result: string; error?: string }[] = [];
  const items: { doc: InvoiceState; totals: ReturnType<typeof serverTotals> }[] = [];
  for (const rawDoc of body.data.docs) {
    const parsed = parseDoc(rawDoc);
    if ('error' in parsed) {
      const id = (rawDoc as { id?: unknown } | null)?.id;
      results.push({
        localId: typeof id === 'string' ? id.slice(0, 64) : null,
        result: 'failed',
        error: parsed.error,
      });
    } else {
      items.push({ doc: parsed.doc, totals: serverTotals(parsed.doc) });
    }
  }
  if (items.length > 0) {
    const { data, error } = await deps.rpc('import_invoices', {
      p_user: userId,
      p_org: body.data.orgId,
      p_items: items,
    });
    if (error) return sqlErrorResponse(error, cors);
    results.push(...(data as typeof results));
  }
  return json(200, { results }, cors);
}
