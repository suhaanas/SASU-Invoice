/**
 * "This browser": opt-in cloud saving for the editor, and importing the
 * documents already stored in this browser. Nothing is uploaded without an
 * explicit confirmation, and local data is never deleted.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CloudUpload, HardDrive } from 'lucide-react';
import { useMemo, useState } from 'react';
import { getSupabase } from '../../cloud/client';
import {
  chunkForUpload,
  cloudErrorMessage,
  importBatch,
  planImport,
  type ImportResult,
  type ImportRow,
} from '../../cloud/invoices';
import {
  getEditorSyncOrg,
  getImportMarker,
  setEditorSyncOrg,
  setImportMarker,
} from '../../cloud/prefs';
import { computeTotals } from '../../core/calc';
import { formatMoney } from '../../core/money';
import { DOC_TITLES } from '../../core/state';
import { loadInvoices, quarantineCount } from '../../core/storage';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  PageHeader,
  Skeleton,
} from '../components/ui';
import { errorMessage, listCloudLocalIds } from '../lib/api';
import { useSupabase } from '../lib/auth';
import { useActiveOrg, useOrgs } from '../lib/org';
import { useToast } from '../lib/toast';

function SyncCard() {
  const { org } = useActiveOrg();
  const { memberships } = useOrgs();
  const toast = useToast();
  const [syncOrg, setSyncOrg] = useState(getEditorSyncOrg);
  const other =
    syncOrg && syncOrg !== org.id ? memberships.find((m) => m.org.id === syncOrg)?.org.name : null;
  const on = syncOrg === org.id;

  const toggle = () => {
    const next = on ? null : org.id;
    setEditorSyncOrg(next);
    setSyncOrg(next);
    toast(
      next
        ? `The editor in this browser now saves to ${org.name}`
        : 'Cloud saving turned off for this browser',
    );
  };

  return (
    <Card>
      <CardHeader
        title="Cloud saving in the editor"
        description="When on, documents you edit in this browser are also saved to this organization."
        action={
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label="Cloud saving in this browser"
            onClick={toggle}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? 'bg-brand' : 'bg-field'}`}
          >
            <span
              className={`absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5.5' : 'translate-x-0.5'}`}
            />
          </button>
        }
      />
      <div className="space-y-2 px-5 py-4 text-sm text-graphite">
        <p>
          Your work is always saved in this browser first, so the editor keeps working offline. Only
          documents you open or change after turning this on are uploaded; use the import below for
          the rest.
        </p>
        {other && (
          <Alert tone="warn">
            This browser currently saves to {other}. Turning it on here switches it to {org.name}.
          </Alert>
        )}
      </div>
    </Card>
  );
}

function ImportCard() {
  const sb = useSupabase();
  const { org } = useActiveOrg();
  const qc = useQueryClient();
  const local = useMemo(() => loadInvoices(), []);
  const quarantined = useMemo(() => quarantineCount(), []);
  const plan = useQuery({
    queryKey: ['import-plan', org.id, local.length],
    queryFn: async () => planImport(local, await listCloudLocalIds(sb, org.id)),
  });
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<ImportResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const marker = getImportMarker(org.id);

  const rows = plan.data ?? [];
  const fresh = rows.filter((r) => !r.inCloud);
  const chosen = selected ?? new Set(fresh.map((r) => r.cloudId));
  const toImport = fresh.filter((r) => chosen.has(r.cloudId));

  const toggle = (row: ImportRow) => {
    const next = new Set(chosen);
    if (next.has(row.cloudId)) next.delete(row.cloudId);
    else next.add(row.cloudId);
    setSelected(next);
  };

  async function runImport() {
    setConfirming(false);
    setError(null);
    setResults(null);
    const docs = toImport.map((r) => ({ ...r.doc, id: r.cloudId }));
    const batches = chunkForUpload(docs);
    const all: ImportResult[] = [];
    setProgress({ done: 0, total: docs.length });
    try {
      for (const batch of batches) {
        all.push(...(await importBatch(getSupabase()!, org.id, batch)));
        setProgress({ done: all.length, total: docs.length });
      }
    } catch (err) {
      setError(cloudErrorMessage(err));
    }
    setProgress(null);
    setResults(all);
    const imported = all.filter((r) => r.result === 'imported').length;
    if (imported > 0)
      setImportMarker(org.id, { at: Date.now(), imported: (marker?.imported ?? 0) + imported });
    setSelected(null);
    await Promise.all([plan.refetch(), qc.invalidateQueries({ queryKey: ['invoices', org.id] })]);
  }

  const counts = results && {
    imported: results.filter((r) => r.result === 'imported').length,
    duplicate: results.filter((r) => r.result === 'duplicate').length,
    failed: results.filter((r) => r.result === 'failed'),
  };
  const numberFor = (localId: string | null) =>
    rows.find((r) => r.cloudId === localId)?.doc.meta.number ?? localId ?? 'Unknown';

  return (
    <Card>
      <CardHeader
        title="Import from this browser"
        description={`Copy documents saved in this browser into ${org.name}. Your browser copies are kept.`}
      />
      <div className="space-y-4 p-5">
        {quarantined > 0 && (
          <Alert tone="warn">
            {quarantined} older record{quarantined === 1 ? '' : 's'} in this browser couldn’t be
            read and won’t be imported. They are kept untouched.
          </Alert>
        )}
        {error && <Alert tone="danger">{error}</Alert>}
        {counts && (
          <Alert tone={counts.failed.length ? 'warn' : 'ok'}>
            <p>
              Imported {counts.imported}
              {counts.duplicate ? `, ${counts.duplicate} already in the cloud` : ''}
              {counts.failed.length ? `, ${counts.failed.length} failed` : ''}.
            </p>
            {counts.failed.length > 0 && (
              <ul className="mt-1 list-disc pl-5">
                {counts.failed.map((f, i) => (
                  <li key={i}>
                    {numberFor(f.localId)}: {f.error}
                  </li>
                ))}
              </ul>
            )}
          </Alert>
        )}

        {local.length === 0 ? (
          <EmptyState icon={<HardDrive className="h-5 w-5" />} title="Nothing to import">
            This browser has no saved documents.
          </EmptyState>
        ) : plan.isPending ? (
          <Skeleton className="h-40" />
        ) : plan.error ? (
          <Alert tone="danger">{errorMessage(plan.error)}</Alert>
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border border-rule">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="border-b border-rule text-left text-xs font-semibold uppercase tracking-wide text-faint">
                    <th scope="col" className="w-10 px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label="Select all new documents"
                        className="accent-brand"
                        checked={fresh.length > 0 && toImport.length === fresh.length}
                        onChange={(e) =>
                          setSelected(new Set(e.target.checked ? fresh.map((r) => r.cloudId) : []))
                        }
                      />
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Document
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Client
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      Total
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Cloud
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rule">
                  {rows.map((r) => (
                    <tr key={r.cloudId}>
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          className="accent-brand"
                          aria-label={`Import ${r.doc.meta.number}`}
                          disabled={r.inCloud}
                          checked={!r.inCloud && chosen.has(r.cloudId)}
                          onChange={() => toggle(r)}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <span className="font-semibold">{r.doc.meta.number || '—'}</span>
                        <span className="ml-2 text-xs text-faint">{DOC_TITLES[r.doc.docType]}</span>
                      </td>
                      <td className="max-w-48 truncate px-3 py-2">
                        {r.doc.client.company || r.doc.client.name || '—'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                        {formatMoney(
                          computeTotals(r.doc).total,
                          r.doc.meta.currency,
                          r.doc.meta.locale,
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {r.inCloud ? <Badge tone="ok">Already imported</Badge> : <Badge>New</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-graphite" aria-live="polite">
                {progress
                  ? `Uploading ${progress.done} of ${progress.total}…`
                  : `${toImport.length} selected`}
              </p>
              <Button
                onClick={() => setConfirming(true)}
                disabled={toImport.length === 0}
                loading={!!progress}
              >
                <CloudUpload className="h-4 w-4" aria-hidden /> Import {toImport.length} document
                {toImport.length === 1 ? '' : 's'}
              </Button>
            </div>
          </>
        )}
      </div>

      <ConfirmDialog
        open={confirming}
        title={`Upload ${toImport.length} document${toImport.length === 1 ? '' : 's'} to ${org.name}?`}
        confirmLabel="Upload"
        onCancel={() => setConfirming(false)}
        onConfirm={() => void runImport()}
      >
        Their contents, including client details and amounts, will be stored in your organization’s
        cloud workspace and visible to its members. Nothing in this browser is changed or deleted.
      </ConfirmDialog>
    </Card>
  );
}

export function BrowserPage() {
  return (
    <>
      <PageHeader
        title="This browser"
        description="Connect the editor on this device to your cloud workspace."
      />
      <div className="space-y-6">
        <SyncCard />
        <ImportCard />
      </div>
    </>
  );
}
