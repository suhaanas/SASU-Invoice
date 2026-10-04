/**
 * Export actions. Heavy libraries (jsPDF, snapdom) are loaded on first use so
 * the editor itself stays small.
 */
import { computeTotals } from '../core/calc';
import type { InvoiceState } from '../core/state';
import { backupSchema, MAX_IMPORT_BYTES, type Backup, type Profile } from '../core/validate';
import { byId, downloadBlob, safeFileName } from './dom';
import { showToast } from './toast';

let busy = false;

async function guarded(label: string, fn: () => Promise<void>): Promise<void> {
  if (busy) return;
  busy = true;
  document.body.classList.add('is-exporting');
  showToast(`Generating ${label}…`);
  try {
    await fn();
  } catch (err) {
    console.error(err);
    showToast(`Could not generate the ${label}. Please try again.`, 'error');
  } finally {
    busy = false;
    document.body.classList.remove('is-exporting');
  }
}

export function exportPDF(state: InvoiceState): Promise<void> {
  return guarded('PDF', async () => {
    const { buildPdf } = await import('./pdf');
    const blob = await buildPdf(state, computeTotals(state));
    downloadBlob(blob, safeFileName(`Invoice_${state.meta.number}`, 'pdf'));
    showToast('PDF downloaded');
  });
}

export function exportPNG(state: InvoiceState): Promise<void> {
  return guarded('PNG', async () => {
    const { snapdom } = await import('@zumer/snapdom');
    const sheet = byId('invoicePage');
    // Capture at true A4 size, not the scaled-down mobile preview.
    sheet.classList.add('capturing');
    try {
      const shot = await snapdom(sheet, {
        scale: 2,
        backgroundColor: '#ffffff',
        embedFonts: true,
        reconcile: true,
      });
      const blob = await shot.toBlob({ format: 'png' });
      downloadBlob(blob, safeFileName(`Invoice_${state.meta.number}`, 'png'));
    } finally {
      sheet.classList.remove('capturing');
    }
    showToast('PNG downloaded');
  });
}

export function exportPrint(): void {
  window.print();
}

export function downloadBackup(invoices: InvoiceState[], profile: Profile | null): void {
  const backup: Backup = {
    app: 'sasu-invoice',
    exportedAt: new Date().toISOString(),
    invoices,
    profile,
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const date = new Date().toISOString().slice(0, 10);
  downloadBlob(blob, safeFileName(`sasu-invoice-backup-${date}`, 'json'));
}

/** Read and validate a backup file. Throws with a user-facing message. */
export async function readBackup(file: File): Promise<Backup> {
  if (file.size > MAX_IMPORT_BYTES) throw new Error('That file is too large to be a backup.');
  let data: unknown;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  const r = backupSchema.safeParse(data);
  if (!r.success) throw new Error('That file is not a valid SASU Invoice backup.');
  return r.data;
}
