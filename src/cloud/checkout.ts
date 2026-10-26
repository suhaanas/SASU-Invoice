/**
 * Hands the signed-in user's email and country from the billing page to the
 * checkout page (same site, same tab) so Paddle can skip its "Your details"
 * step. Kept in sessionStorage, never in the URL; read once, then removed.
 */
const KEY = 'sasu:checkoutPrefill';

export interface CheckoutPrefill {
  email: string;
  country: string;
}

export function saveCheckoutPrefill(prefill: CheckoutPrefill): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(prefill));
  } catch {
    // Storage blocked: checkout simply asks for the details.
  }
}

export function takeCheckoutPrefill(): CheckoutPrefill | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    const value = raw ? (JSON.parse(raw) as Partial<CheckoutPrefill>) : null;
    if (!value) return null;
    const email =
      typeof value.email === 'string' && /^[^@\s]+@[^@\s]+$/.test(value.email) ? value.email : '';
    const country =
      typeof value.country === 'string' && /^[A-Z]{2}$/.test(value.country) ? value.country : '';
    return email || country ? { email, country } : null;
  } catch {
    return null;
  }
}
