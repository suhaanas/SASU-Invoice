/**
 * Optional cloud sync for the editor. Off unless the user turned it on for
 * this browser in the dashboard (Settings → this browser), so signed-out and
 * local-only use is unchanged. The browser copy is always saved first; the
 * cloud copy follows, and failures never lose local work.
 *
 * supabase-js is only downloaded when sync is enabled.
 */
import { blankClient, type Client, type InvoiceState, type Status } from '../core/state.ts';
import { parseInvoice } from '../core/validate.ts';
import { cloudConfig } from '../cloud/config.ts';
import { getEditorSyncOrg, hasStoredSession } from '../cloud/prefs.ts';

export type CloudStatus =
  { kind: 'syncing' } | { kind: 'synced' } | { kind: 'error'; message: string };

/** Fields the server owns once payments are recorded in the dashboard. */
export interface ServerFields {
  id: string;
  amountPaid: number;
  status: Status;
}

export interface CloudSync {
  /** Queue the latest version of a document for upload. */
  queue(doc: InvoiceState): void;
  /** The document named by ?doc=<cloud id>, if any. */
  openFromUrl(): Promise<InvoiceState | null>;
  /** The client named by ?client=<cloud id>, for "new invoice for this client". */
  clientFromUrl(): Promise<Client | null>;
}

const DEBOUNCE_MS = 1500;

export function initCloudSync(
  onStatus: (status: CloudStatus) => void,
  onServerFields: (fields: ServerFields) => void,
): CloudSync | null {
  const orgId = getEditorSyncOrg();
  if (!cloudConfig || !orgId || !hasStoredSession()) return null;

  const api = Promise.all([import('../cloud/client.ts'), import('../cloud/invoices.ts')]);
  /** Last revision seen per document, for optimistic concurrency. */
  const revisions = new Map<string, number>();
  /** Documents that conflicted; we stop overwriting them this session. */
  const halted = new Set<string>();
  /** Content last known to be in the cloud, to skip no-op uploads. */
  const synced = new Map<string, string>();
  const fingerprint = (doc: InvoiceState): string => JSON.stringify({ ...doc, updatedAt: 0 });
  const pending = new Map<string, InvoiceState>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;

  async function flush(): Promise<void> {
    if (running) return;
    running = true;
    const [{ getSupabase }, cloud] = await api;
    const sb = getSupabase();
    try {
      while (pending.size > 0 && sb) {
        const [id, doc] = pending.entries().next().value as [string, InvoiceState];
        pending.delete(id);
        if (halted.has(id)) continue;
        onStatus({ kind: 'syncing' });
        try {
          const res = await cloud.saveDoc(sb, orgId!, doc, revisions.get(id) ?? null);
          revisions.set(id, res.revision);
          const status = res.status as Status;
          if (res.amountPaid !== doc.totals.amountPaid || status !== doc.meta.status) {
            // The payments ledger decides these; adopt them instead of fighting them.
            const adjusted = {
              ...doc,
              meta: { ...doc.meta, status },
              totals: { ...doc.totals, amountPaid: res.amountPaid },
            };
            synced.set(id, fingerprint(adjusted));
            onServerFields({ id, amountPaid: res.amountPaid, status });
          } else {
            synced.set(id, fingerprint(doc));
          }
          onStatus({ kind: 'synced' });
        } catch (err) {
          if (err instanceof cloud.CloudError && err.status === 409) halted.add(id);
          if (err instanceof cloud.CloudError && err.status === 0) pending.set(id, doc); // retry when online
          onStatus({ kind: 'error', message: editorMessage(err, cloud.CloudError) });
          if (err instanceof cloud.CloudError && err.status === 0) break;
        }
      }
    } finally {
      running = false;
    }
  }

  window.addEventListener('online', () => void flush());

  return {
    queue(doc) {
      if (halted.has(doc.id) || synced.get(doc.id) === fingerprint(doc)) return;
      pending.set(doc.id, doc);
      clearTimeout(timer);
      timer = setTimeout(() => void flush(), DEBOUNCE_MS);
    },
    async openFromUrl() {
      const cloudId = new URLSearchParams(location.search).get('doc');
      if (!cloudId || !/^[0-9a-f-]{36}$/i.test(cloudId)) return null;
      const [{ getSupabase }] = await api;
      const sb = getSupabase();
      if (!sb) return null;
      const { data, error } = await sb
        .from('invoices')
        .select('document, revision')
        .eq('id', cloudId)
        .eq('org_id', orgId!)
        .maybeSingle();
      if (error || !data) {
        onStatus({ kind: 'error', message: 'That cloud document could not be opened' });
        return null;
      }
      const doc = parseInvoice(data.document);
      if (!doc) return null;
      revisions.set(doc.id, data.revision as number);
      synced.set(doc.id, fingerprint(doc));
      history.replaceState(null, '', location.pathname);
      return doc;
    },
    async clientFromUrl() {
      const clientId = new URLSearchParams(location.search).get('client');
      if (!clientId || !/^[0-9a-f-]{36}$/i.test(clientId)) return null;
      const [{ getSupabase }] = await api;
      const sb = getSupabase();
      if (!sb) return null;
      const { data } = await sb
        .from('clients')
        .select('name, company, email, phone, address, delivery_address, tax_id, reg_number')
        .eq('id', clientId)
        .eq('org_id', orgId!)
        .maybeSingle();
      history.replaceState(null, '', location.pathname);
      if (!data) return null;
      return {
        ...blankClient(),
        name: data.name,
        company: data.company,
        email: data.email,
        phone: data.phone,
        address: data.address,
        deliveryAddress: data.delivery_address,
        taxId: data.tax_id,
        regNumber: data.reg_number,
      };
    },
  };
}

function editorMessage(
  err: unknown,
  CloudError: typeof import('../cloud/invoices.ts').CloudError,
): string {
  if (!(err instanceof CloudError)) return 'Saved locally · cloud sync failed';
  switch (err.status) {
    case 0:
      return 'Saved locally · offline, will sync when back online';
    case 401:
      return 'Saved locally · sign in again to sync';
    case 402:
      return 'Saved locally · cloud plan limit reached';
    case 409:
      return 'Saved locally · changed elsewhere, cloud copy not overwritten';
    case 423:
      return 'Saved locally · the cloud copy is issued and locked';
    default:
      return `Saved locally · ${err.message}`;
  }
}
