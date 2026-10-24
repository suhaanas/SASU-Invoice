import { beforeEach, describe, expect, it } from 'vitest';
import { parseCloudConfig } from '../src/cloud/config';
import { chunkForUpload, cloudDocId, planImport, toCloudDoc } from '../src/cloud/invoices';
import {
  getActiveOrg,
  getEditorSyncOrg,
  hasStoredSession,
  setActiveOrg,
  setEditorSyncOrg,
} from '../src/cloud/prefs';
import { nextNumber } from '../src/core/numbering';
import { createInvoice } from '../src/core/state';
import { loadInvoicePrefix, saveInvoicePrefix } from '../src/core/storage';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

beforeEach(() => localStorage.clear());

describe('cloud document ids', () => {
  it('keeps UUID ids as they are', async () => {
    const doc = createInvoice();
    expect(await cloudDocId(doc.id)).toBe(doc.id);
    expect(await toCloudDoc(doc)).toBe(doc);
  });

  it('derives a stable UUID for legacy ids, so re-imports are detected', async () => {
    const a = await cloudDocId('abc');
    expect(a).toMatch(UUID);
    expect(await cloudDocId('abc')).toBe(a);
    expect(await cloudDocId('abd')).not.toBe(a);
    const doc = { ...createInvoice(), id: 'abc' };
    expect((await toCloudDoc(doc)).id).toBe(a);
  });
});

describe('import planning', () => {
  it('marks documents already in the organization', async () => {
    const inCloud = createInvoice();
    const fresh = createInvoice();
    const rows = await planImport([inCloud, fresh], new Set([inCloud.id]));
    expect(rows.map((r) => r.inCloud)).toEqual([true, false]);
  });

  it('splits uploads by count and by size', () => {
    expect(chunkForUpload([1, 2, 3, 4, 5], 2).map((c) => c.length)).toEqual([2, 2, 1]);
    const big = 'x'.repeat(60);
    expect(chunkForUpload([big, big, big], 50, 130).map((c) => c.length)).toEqual([2, 1]);
    // An item larger than the limit still goes, on its own.
    expect(chunkForUpload(['x'.repeat(500)], 50, 100)).toHaveLength(1);
  });
});

describe('cloud configuration', () => {
  const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.public-anon';
  it('accepts https project URLs and local development', () => {
    expect(
      parseCloudConfig({
        VITE_SUPABASE_URL: 'https://abc.supabase.co/',
        VITE_SUPABASE_ANON_KEY: key,
      }),
    ).toEqual({
      url: 'https://abc.supabase.co',
      anonKey: key,
    });
    expect(
      parseCloudConfig({
        VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
        VITE_SUPABASE_ANON_KEY: key,
      }),
    ).not.toBeNull();
  });

  it('turns cloud features off when unset or insecure', () => {
    expect(parseCloudConfig({})).toBeNull();
    expect(
      parseCloudConfig({
        VITE_SUPABASE_URL: 'http://abc.supabase.co',
        VITE_SUPABASE_ANON_KEY: key,
      }),
    ).toBeNull();
    expect(
      parseCloudConfig({ VITE_SUPABASE_URL: 'javascript:alert(1)', VITE_SUPABASE_ANON_KEY: key }),
    ).toBeNull();
  });
});

describe('browser preferences', () => {
  const org = '6f1c1e9a-3b8e-4c1f-9f39-2f6f8b1e7a10';
  it('only returns well-formed organization ids', () => {
    setActiveOrg(org);
    setEditorSyncOrg(org);
    expect(getActiveOrg()).toBe(org);
    expect(getEditorSyncOrg()).toBe(org);
    localStorage.setItem('sasu:v3:activeOrg', "' or 1=1");
    expect(getActiveOrg()).toBeNull();
    setEditorSyncOrg(null);
    expect(getEditorSyncOrg()).toBeNull();
  });

  it('detects a stored Supabase session without loading supabase-js', () => {
    expect(hasStoredSession()).toBe(false);
    localStorage.setItem('sb-abc-auth-token', '{}');
    expect(hasStoredSession()).toBe(true);
  });
});

describe('custom invoice prefix', () => {
  it('starts a new series with the chosen prefix', () => {
    expect(nextNumber('invoice', [], undefined, { invoice: 'ACME-' })).toBe('ACME-001');
    expect(nextNumber('quote', [], undefined, { invoice: 'ACME-' })).toBe('QUO-001');
  });

  it('never renumbers an existing series', () => {
    const doc = createInvoice();
    doc.meta.number = 'INV-041';
    expect(nextNumber('invoice', [doc], undefined, { invoice: 'ACME-' })).toBe('INV-042');
  });

  it('stores only safe prefixes', () => {
    saveInvoicePrefix('ACME-');
    expect(loadInvoicePrefix()).toBe('ACME-');
    saveInvoicePrefix('<script>');
    expect(loadInvoicePrefix()).toBe('');
  });
});
