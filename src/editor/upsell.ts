/**
 * "Get paid faster" prompt in the free editor. After a download it suggests
 * the cloud workspace: email the invoice, track payment, automatic reminders.
 * Signed-out visitors are sent to start a trial (then to import this browser's
 * invoices); signed-in users without sync are sent to connect this browser.
 * Hidden when the editor already syncs, or when cloud isn't configured.
 */
import { cloudConfig } from '../cloud/config.ts';
import { getEditorSyncOrg, hasStoredSession } from '../cloud/prefs.ts';

const DISMISSED = 'sasu-upsell-dismissed';

function dismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED) === '1';
  } catch {
    return false;
  }
}

export function initUpsell(): { afterExport(): void } | null {
  const link = document.getElementById('upsellLink') as HTMLAnchorElement | null;
  const card = document.getElementById('upsellCard');
  const cta = document.getElementById('upsellCta') as HTMLAnchorElement | null;
  if (!cloudConfig || !link || !card || !cta) return null;
  const signedIn = hasStoredSession();
  if (signedIn && getEditorSyncOrg()) return null;

  const href = signedIn ? '/dashboard/browser' : '/dashboard/register?next=%2Fbrowser';
  cta.href = href;
  cta.textContent = signedIn ? 'Connect this browser' : 'Start free trial';
  link.href = href;
  link.hidden = false;

  document.getElementById('upsellClose')?.addEventListener('click', () => {
    card.hidden = true;
    try {
      localStorage.setItem(DISMISSED, '1');
    } catch {
      // Private mode: hidden for this visit only.
    }
  });

  let shown = false;
  return {
    afterExport() {
      if (shown || dismissed()) return;
      shown = true;
      card.hidden = false;
    },
  };
}
