import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { computeTotals } from '../src/core/calc';
import { sampleInvoice } from '../src/core/state';
import { renderPreview, renderSummary } from '../src/ui/render';
import { renderItems } from '../src/ui/items';
import { buildSheet } from '../src/ui/sheet';

const PAYLOAD = '"><img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>';

beforeAll(() => {
  const html = readFileSync(resolve(import.meta.dirname, '../app.html'), 'utf8');
  document.documentElement.innerHTML = html.replace(/^<!DOCTYPE html>/i, '');
});

describe('rendering untrusted input', () => {
  it('renders hostile text literally in the preview, summary and item editor', () => {
    const s = sampleInvoice();
    s.business.name = PAYLOAD;
    s.client.name = PAYLOAD;
    s.client.address = PAYLOAD;
    s.notes.notes = PAYLOAD;
    s.notes.bankDetails = PAYLOAD;
    s.notes.footer = PAYLOAD;
    s.totals.taxLabel = PAYLOAD;
    s.totals.taxRate = 10;
    s.items[0]!.desc = PAYLOAD;
    s.items[0]!.unit = PAYLOAD.slice(0, 20);

    const t = computeTotals(s);
    renderPreview(s, t);
    renderSummary(s, t);
    renderItems(s);

    const sheet = document.getElementById('invoicePage')!;
    expect(sheet.querySelector('img[onerror], script')).toBeNull();
    expect(document.getElementById('colDetails')!.querySelector('img[onerror], script')).toBeNull();
    expect(sheet.querySelector('.inv-company')!.textContent).toBe(PAYLOAD);
    expect(sheet.querySelector('td.tc-desc')!.textContent).toBe(PAYLOAD);
    const descInput = document.querySelector<HTMLInputElement>('.ir-desc')!;
    expect(descInput.value).toBe(PAYLOAD);
    expect(descInput.outerHTML).not.toContain('onerror="window');
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it('buildSheet (used by the landing page) never parses markup', () => {
    const s = sampleInvoice();
    s.business.name = PAYLOAD;
    s.client.company = PAYLOAD;
    s.business.email = PAYLOAD;
    s.meta.poNumber = PAYLOAD.slice(0, 60);
    s.items[0]!.desc = PAYLOAD;
    s.business.legal = { form: PAYLOAD, capital: PAYLOAD, regNumber: PAYLOAD, regPlace: PAYLOAD };
    s.client.deliveryAddress = PAYLOAD;
    s.client.regNumber = PAYLOAD;
    s.docType = 'credit';
    s.ref = { number: PAYLOAD.slice(0, 60), date: '' };
    const sheet = buildSheet(s, computeTotals(s));
    expect(sheet.querySelector('img, script')).toBeNull();
    expect(sheet.querySelector('.inv-company')!.textContent).toBe(PAYLOAD);
    expect(sheet.querySelectorAll('[data-region]').length).toBeGreaterThanOrEqual(5);
  });
});
