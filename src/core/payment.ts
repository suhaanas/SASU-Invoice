/**
 * Payment details and "scan to pay" payloads.
 *
 * - SEPA: EPC069-12 "BCD" quick-response payload (v002, UTF-8, SCT),
 *   max 331 bytes, EUR only. Banking apps across the eurozone read it.
 * - UPI: the `upi://pay` deep link, INR only.
 * - Link: a payment page the user pasted (Stripe, PayPal…), https only.
 */
import type { Totals } from './calc';
import { fromMinor } from './money';
import type { InvoiceState } from './state';

export const normalizeIban = (s: string): string => s.replace(/\s+/g, '').toUpperCase();

/** ISO 13616 IBAN check: shape plus mod-97 checksum. */
export function isValidIban(raw: string): boolean {
  const iban = normalizeIban(raw);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let rem = 0;
  for (const ch of rearranged) {
    const v = ch >= 'A' ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of v) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1;
}

export const formatIban = (raw: string): string => normalizeIban(raw).replace(/(.{4})(?=.)/g, '$1 ');

export const isValidBic = (raw: string): boolean =>
  /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(raw.replace(/\s+/g, '').toUpperCase());

const utf8Length = (s: string): number => new TextEncoder().encode(s).length;

export interface EpcInput {
  beneficiary: string;
  iban: string;
  bic: string;
  amountMinor: number;
  currency: string;
  remittance: string;
}

/** EPC QR payload, or an error message explaining why it can't be built. */
export function epcPayload(input: EpcInput): { payload: string } | { error: string } {
  if (input.currency !== 'EUR') return { error: 'SEPA QR codes only work for invoices in euros.' };
  const name = input.beneficiary.trim();
  if (!name) return { error: 'Add the account holder name.' };
  if (name.length > 70) return { error: 'Account holder name must be 70 characters or fewer.' };
  if (!isValidIban(input.iban)) return { error: 'That IBAN is not valid.' };
  const bic = input.bic.replace(/\s+/g, '').toUpperCase();
  if (bic && !isValidBic(bic)) return { error: 'That BIC is not valid.' };
  const amount = fromMinor(input.amountMinor, 'EUR');
  if (amount < 0.01 || amount > 999_999_999.99) return { error: 'Amount is outside the SEPA QR range.' };

  const lines = [
    'BCD',
    '002',
    '1', // UTF-8
    'SCT',
    bic,
    name,
    normalizeIban(input.iban),
    `EUR${amount.toFixed(2)}`,
    '', // purpose
    '', // structured creditor reference
    input.remittance.slice(0, 140),
  ];
  const payload = lines.join('\n');
  if (utf8Length(payload) > 331) return { error: 'Payment details are too long for a SEPA QR code.' };
  return { payload };
}

export function upiPayload(input: {
  upiId: string;
  name: string;
  amountMinor: number;
  currency: string;
  note: string;
}): { payload: string } | { error: string } {
  if (input.currency !== 'INR') return { error: 'UPI QR codes only work for invoices in rupees.' };
  const id = input.upiId.trim();
  if (!/^[\w.-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,63}$/.test(id)) return { error: 'That UPI ID is not valid.' };
  const params = new URLSearchParams({
    pa: id,
    pn: input.name.trim().slice(0, 50),
    am: fromMinor(input.amountMinor, 'INR').toFixed(2),
    cu: 'INR',
    tn: input.note.slice(0, 80),
  });
  return { payload: `upi://pay?${params.toString()}` };
}

/** A user-pasted payment page, accepted only as an absolute https URL. */
export function safePaymentLink(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    return url.protocol === 'https:' && url.hostname.includes('.') ? url.href : null;
  } catch {
    return null;
  }
}

export interface PaymentQr {
  payload: string;
  /** Short caption under the code, e.g. "Scan to pay with your banking app". */
  caption: string;
  /** Extra line, e.g. the formatted IBAN or the link. */
  detail: string;
}

/**
 * The "scan to pay" code for a document, or an explanation of why there is
 * none. Only invoices and proformas with a balance due get one.
 */
export function paymentQr(state: InvoiceState, totals: Totals): PaymentQr | { error: string } | null {
  const p = state.payment;
  if (p.method === 'none') return null;
  if (state.docType !== 'invoice' && state.docType !== 'proforma') return null;
  if (totals.balance <= 0) return null;
  const reference = `${state.docType === 'proforma' ? 'Proforma' : 'Invoice'} ${state.meta.number}`.trim();

  if (p.method === 'sepa') {
    const r = epcPayload({
      beneficiary: p.beneficiary || state.business.name,
      iban: p.iban,
      bic: p.bic,
      amountMinor: totals.balance,
      currency: state.meta.currency,
      remittance: reference,
    });
    if ('error' in r) return r;
    return { payload: r.payload, caption: 'Scan to pay with your banking app', detail: `IBAN ${formatIban(p.iban)}` };
  }
  if (p.method === 'upi') {
    const r = upiPayload({
      upiId: p.upiId,
      name: p.beneficiary || state.business.name,
      amountMinor: totals.balance,
      currency: state.meta.currency,
      note: reference,
    });
    if ('error' in r) return r;
    return { payload: r.payload, caption: 'Scan to pay with any UPI app', detail: p.upiId.trim() };
  }
  const link = safePaymentLink(p.link);
  if (!link) return { error: 'Payment link must be a full https:// address.' };
  return { payload: link, caption: 'Scan to pay online', detail: link.replace(/^https:\/\//, '') };
}
