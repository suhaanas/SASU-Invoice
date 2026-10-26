/**
 * Cloud document API: save one document, import many, and the helpers that
 * prepare browser documents for upload. All writes go through the `invoices`
 * Edge Function, which re-validates and recomputes totals server-side.
 */
import { FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js';
import type { InvoiceState } from '../core/state.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** HTTP status 0 means the request never reached the server. */
export class CloudError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'CloudError';
  }
}

/**
 * The id a document has in the cloud. Current documents already use UUIDs;
 * older ones get a stable UUID derived from their id, so importing the same
 * document twice is always detected as a duplicate.
 */
export async function cloudDocId(localId: string): Promise<string> {
  if (UUID.test(localId)) return localId.toLowerCase();
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`sasu-local-id:${localId}`)),
  );
  const b = digest.slice(0, 16);
  b[6] = (b[6]! & 0x0f) | 0x80; // version 8 (custom)
  b[8] = (b[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function toCloudDoc(doc: InvoiceState): Promise<InvoiceState> {
  const id = await cloudDocId(doc.id);
  return id === doc.id ? doc : { ...doc, id };
}

/** Call an Edge Function, turning HTTP errors into CloudError with the server's message. */
export async function callFunction(
  sb: SupabaseClient,
  name: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const { data, error } = await sb.functions.invoke(name, { body });
  if (!error) return data;
  if (error instanceof FunctionsHttpError) {
    const res = error.context as Response;
    const payload = (await res.json().catch(() => null)) as {
      error?: string;
      code?: string;
    } | null;
    throw new CloudError(
      payload?.error ?? 'The request failed',
      res.status,
      payload?.code ?? String(res.status),
    );
  }
  throw new CloudError(
    'Could not reach the server. Your changes are kept in this browser.',
    0,
    'network',
  );
}

const callInvoices = (sb: SupabaseClient, body: Record<string, unknown>) =>
  callFunction(sb, 'invoices', body);

export interface SaveResult {
  id: string;
  localId: string;
  revision: number;
  status: string;
  issued: boolean;
  /** Authoritative amount paid (from the payments ledger when there is one). */
  amountPaid: number;
}

export async function saveDoc(
  sb: SupabaseClient,
  orgId: string,
  doc: InvoiceState,
  expectedRevision: number | null,
): Promise<SaveResult> {
  return (await callInvoices(sb, {
    action: 'save',
    orgId,
    doc: await toCloudDoc(doc),
    expectedRevision,
  })) as SaveResult;
}

export type ImportOutcome = 'imported' | 'duplicate' | 'failed';
export interface ImportResult {
  localId: string | null;
  result: ImportOutcome;
  error?: string;
}

export async function importBatch(
  sb: SupabaseClient,
  orgId: string,
  docs: InvoiceState[],
): Promise<ImportResult[]> {
  const res = (await callInvoices(sb, { action: 'import', orgId, docs })) as {
    results: ImportResult[];
  };
  return res.results;
}

// --- Import planning (pure) ---------------------------------------------------

export interface ImportRow {
  doc: InvoiceState;
  cloudId: string;
  /** Already in the selected organization (same document id). */
  inCloud: boolean;
}

export async function planImport(
  local: InvoiceState[],
  cloudLocalIds: ReadonlySet<string>,
): Promise<ImportRow[]> {
  return Promise.all(
    local.map(async (doc) => {
      const cloudId = await cloudDocId(doc.id);
      return { doc, cloudId, inCloud: cloudLocalIds.has(cloudId) };
    }),
  );
}

/** Split documents into request-sized batches (count and approximate JSON size). */
export function chunkForUpload<T>(items: T[], maxCount = 50, maxBytes = 4 * 1024 * 1024): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let size = 0;
  for (const item of items) {
    const bytes = JSON.stringify(item).length;
    if (current.length > 0 && (current.length >= maxCount || size + bytes > maxBytes)) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(item);
    size += bytes;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/** Friendly wording for errors shown to users. */
export function cloudErrorMessage(err: unknown): string {
  if (err instanceof CloudError) {
    if (err.status === 402)
      return 'Your plan limit is reached. Existing cloud documents stay available.';
    if (err.status === 401) return 'Your session has expired. Please sign in again.';
    return err.message;
  }
  return 'Something went wrong. Please try again.';
}
