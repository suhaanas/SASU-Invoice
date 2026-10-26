/**
 * Signed-in visitors (a Supabase session saved in this browser) see "Go to
 * dashboard" instead of the sign-in and trial buttons. Only checks storage, so
 * the landing page never downloads supabase-js.
 */
import { hasStoredSession } from '../cloud/prefs';

export function initSession(): void {
  if (!hasStoredSession()) return;
  document.querySelectorAll<HTMLElement>('[data-signed-out]').forEach((el) => (el.hidden = true));
  document.querySelectorAll<HTMLAnchorElement>('[data-account-cta]').forEach((a) => {
    a.href = '/dashboard/';
    a.textContent = 'Go to dashboard';
  });
}
