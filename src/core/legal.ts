/**
 * Legal wording presets and pre-export warnings.
 *
 * IMPORTANT: these strings follow the research in docs/research-report.md,
 * where some primary sources (EUR-Lex, Légifrance) could not be re-fetched.
 * Verify each text against the official source before relying on it.
 */
import type { InvoiceState } from './state';

export interface LegalMention {
  id: string;
  label: string;
  text: string;
  /** The client's VAT number must be on the invoice when this applies. */
  needsClientVat?: boolean;
}

export const LEGAL_MENTIONS: readonly LegalMention[] = [
  {
    id: 'fr-franchise',
    label: 'VAT franchise (France, micro / small business)',
    text: 'TVA non applicable, art. 293 B du CGI',
  },
  {
    id: 'reverse-charge',
    label: 'Reverse charge (EU B2B services)',
    text: 'Reverse charge: VAT to be accounted for by the recipient (Autoliquidation).',
    needsClientVat: true,
  },
  {
    id: 'intra-eu-goods',
    label: 'Exempt intra-EU supply of goods',
    text: 'Exempt intra-Community supply of goods, art. 138 Directive 2006/112/EC.',
    needsClientVat: true,
  },
  {
    id: 'export',
    label: 'Export outside the EU',
    text: 'VAT exempt: export of goods outside the EU, art. 146 Directive 2006/112/EC.',
  },
  {
    id: 'fr-late-payment',
    label: 'Late-payment terms (France, B2B)',
    text:
      "En cas de retard de paiement : pénalités au taux de trois fois le taux d'intérêt légal et " +
      'indemnité forfaitaire pour frais de recouvrement de 40 €. Escompte pour paiement anticipé : néant.',
  },
];

export const legalMentionTexts = (state: InvoiceState): string[] =>
  LEGAL_MENTIONS.filter((m) => state.notes.legalMentions.includes(m.id)).map((m) => m.text);

/** Company registration line, e.g. "SASU · Capital 1 000 € · SIREN 123 456 789 · RCS Paris". */
export function companyLine(state: InvoiceState): string {
  const l = state.business.legal;
  return [
    l.form,
    l.capital && `Capital ${l.capital}`,
    l.regNumber,
    l.regPlace,
  ]
    .map((s) => (s || '').trim())
    .filter(Boolean)
    .join(' · ');
}

/** Things worth fixing before sending; shown in the editor, never blocking. */
export function legalWarnings(state: InvoiceState): string[] {
  const out: string[] = [];
  const chosen = LEGAL_MENTIONS.filter((m) => state.notes.legalMentions.includes(m.id));
  if (chosen.some((m) => m.needsClientVat) && !state.client.taxId.trim()) {
    out.push("Add the client's VAT number: it is required with reverse-charge or intra-EU wording.");
  }
  const usesAe = state.items.some((i) => i.vatCategory === 'AE');
  if (usesAe && !state.notes.legalMentions.includes('reverse-charge')) {
    out.push('Some lines are reverse charge: add the "Reverse charge" wording in Notes.');
  }
  if (state.notes.legalMentions.includes('fr-franchise') && state.totals.taxRate > 0) {
    out.push('VAT franchise is selected but the invoice charges VAT.');
  }
  if (state.docType === 'credit' && !state.ref?.number) {
    out.push('A credit note should reference the invoice it corrects.');
  }
  return out;
}
