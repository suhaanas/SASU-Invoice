import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { AgingChart, MonthlyChart, niceMax } from '../src/dashboard/components/Charts';
import { displayStatus, InvoiceTable } from '../src/dashboard/components/InvoiceTable';
import {
  effectivePlanCode,
  searchTerm,
  todayIn,
  type CloudInvoiceRow,
  type DashboardSummary,
  type Subscription,
} from '../src/dashboard/lib/api';
import { date, monthLabel } from '../src/dashboard/lib/format';
import { safeNext } from '../src/dashboard/pages/Auth';
import { toISODate } from '../src/core/dates';

afterEach(cleanup);

const inRouter = (ui: ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

const PAYLOAD = '"><img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>';

function row(patch: Partial<CloudInvoiceRow> = {}): CloudInvoiceRow {
  return {
    id: '6f1c1e9a-3b8e-4c1f-9f39-2f6f8b1e7a10',
    local_id: '6f1c1e9a-3b8e-4c1f-9f39-2f6f8b1e7a11',
    doc_type: 'invoice',
    number: 'INV-001',
    status: 'Unpaid',
    currency: 'GBP',
    issue_date: '2026-10-01',
    due_date: '2026-10-31',
    client_name: 'Acme Ltd',
    total_minor: 123456,
    paid_minor: 100000,
    balance_minor: 23456,
    client_id: null,
    issued_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-02T10:00:00Z',
    source: 'editor',
    ...patch,
  };
}

describe('dashboard invoice table', () => {
  it('renders hostile client names as text', () => {
    const { container } = inRouter(
      <InvoiceTable orgId="org" rows={[row({ client_name: PAYLOAD, number: PAYLOAD })]} />,
    );
    expect(container.querySelector('img, script')).toBeNull();
    expect(screen.getAllByText(PAYLOAD).length).toBeGreaterThan(0);
  });

  it('formats integer minor units in the document currency', () => {
    inRouter(<InvoiceTable orgId="org" rows={[row()]} />);
    expect(screen.getByText('£1,234.56')).toBeTruthy();
    expect(screen.getByText('£234.56')).toBeTruthy();
  });

  it('only offers deleting drafts', () => {
    inRouter(
      <InvoiceTable
        orgId="org"
        rows={[row(), row({ id: 'b', number: 'INV-002', issued_at: null, status: 'Draft' })]}
        onDelete={() => {}}
      />,
    );
    expect(screen.queryByLabelText('Delete draft INV-001')).toBeNull();
    expect(screen.getByLabelText('Delete draft INV-002')).toBeTruthy();
  });

  it('derives Overdue for unpaid invoices past their due date', () => {
    expect(displayStatus(row(), '2026-11-01')).toBe('Overdue');
    expect(displayStatus(row(), '2026-10-31')).toBe('Partially paid');
    expect(displayStatus(row({ paid_minor: 0 }), '2026-10-31')).toBe('Unpaid');
    expect(displayStatus(row({ status: 'Paid' }), '2026-11-01')).toBe('Paid');
    expect(displayStatus(row({ doc_type: 'quote', status: 'Sent' }), '2026-11-01')).toBe('Sent');
  });
});

describe('plan display', () => {
  const now = Date.parse('2026-10-24T00:00:00Z');
  const sub = (patch: Partial<Subscription>): Subscription => ({
    plan_code: 'pro',
    status: 'trialing',
    trial_ends_at: null,
    current_period_end: null,
    ...patch,
  });
  it('mirrors the SQL effective plan rules', () => {
    expect(effectivePlanCode(null, now)).toBe('free');
    expect(effectivePlanCode(sub({ trial_ends_at: '2026-11-01T00:00:00Z' }), now)).toBe('pro');
    expect(effectivePlanCode(sub({ trial_ends_at: '2026-10-01T00:00:00Z' }), now)).toBe('free');
    expect(effectivePlanCode(sub({ status: 'active' }), now)).toBe('pro');
    expect(
      effectivePlanCode(
        sub({ status: 'canceled', current_period_end: '2026-11-01T00:00:00Z' }),
        now,
      ),
    ).toBe('pro');
    expect(effectivePlanCode(sub({ status: 'expired' }), now)).toBe('free');
  });
});

describe('post-login redirects', () => {
  it('allows only in-app paths', () => {
    expect(safeNext('/invoices?page=2')).toBe('/invoices?page=2');
    expect(safeNext('/invite')).toBe('/invite');
    expect(safeNext('//evil.test')).toBe('/');
    expect(safeNext('https://evil.test')).toBe('/');
    expect(safeNext('/\\evil.test')).toBe('/');
    expect(safeNext('javascript:alert(1)')).toBe('/');
    expect(safeNext(null)).toBe('/');
  });
});

describe('overview charts', () => {
  const summary: DashboardSummary = {
    currency: 'GBP',
    today: '2026-10-24',
    invoicedMinor: 500000,
    paidMinor: 200000,
    outstandingMinor: 300000,
    outstandingCount: 3,
    overdueMinor: 100000,
    overdueCount: 1,
    partialMinor: 50000,
    partialCount: 1,
    dueWeekMinor: 0,
    dueWeekCount: 0,
    paymentsMonthMinor: 20000,
    monthly: [
      { month: '2026-05', invoicedMinor: 0, receivedMinor: 0 },
      { month: '2026-06', invoicedMinor: 120000, receivedMinor: 0 },
      { month: '2026-07', invoicedMinor: 80000, receivedMinor: 120000 },
      { month: '2026-08', invoicedMinor: 0, receivedMinor: 40000 },
      { month: '2026-09', invoicedMinor: 150000, receivedMinor: 20000 },
      { month: '2026-10', invoicedMinor: 150000, receivedMinor: 20000 },
    ],
    aging: { current: 200000, d1_30: 100000, d31_60: 0, d61_90: 0, d90_plus: 0 },
    statusCounts: { paid: 2, partial: 1, unpaid: 1, overdue: 1 },
  };

  it('picks readable axis maxima', () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(150000)).toBe(200000);
    expect(niceMax(4200)).toBe(5000);
    expect(niceMax(1000)).toBe(1000);
  });

  it('draws one column per non-zero value and labels every month for screen readers', () => {
    const { container } = render(<MonthlyChart data={summary} digits={2} />);
    expect(container.querySelectorAll('path')).toHaveLength(8);
    expect(screen.getByLabelText(/Jul 26: invoiced £800.00, received £1,200.00/)).toBeTruthy();
  });

  it('offers the same numbers as a table', () => {
    render(<MonthlyChart data={summary} digits={2} />);
    fireEvent.click(screen.getByRole('button', { name: 'Table' }));
    const table = screen.getByRole('table');
    expect(table.querySelectorAll('tbody tr')).toHaveLength(6);
    expect(table.textContent).toContain('£1,500.00');
  });

  it('labels every aging bucket with its amount', () => {
    render(<AgingChart data={summary} />);
    expect(screen.getByText('1–30 days late')).toBeTruthy();
    expect(screen.getByText('£1,000.00')).toBeTruthy();
  });
});

describe('search terms', () => {
  it('strips characters that could alter a PostgREST filter', () => {
    expect(searchTerm('  acme, inc.(x)*"y":z\\ ')).toBe('acme  inc. x   y  z');
    expect(searchTerm('a'.repeat(200))).toHaveLength(80);
  });
});

describe('dates per organization timezone', () => {
  it('uses the organization’s local date', () => {
    const now = new Date('2026-10-24T23:30:00Z');
    expect(todayIn('Europe/London', now)).toBe('2026-10-25');
    expect(todayIn('America/New_York', now)).toBe('2026-10-24');
    // Unknown timezone: the browser's own calendar date, never the UTC one.
    expect(todayIn('Not/AZone', now)).toBe(toISODate(now));
  });
});

describe('dashboard date formatting', () => {
  it('labels months and calendar dates without timezone drift', () => {
    expect(monthLabel('2026-10')).toBe('Oct');
    expect(monthLabel('2026-01', true)).toBe('Jan 26');
    expect(date('2026-10-01')).toBe('1 Oct 2026');
    expect(date(null)).toBe('—');
  });
});

describe('calendar dates never go through UTC', () => {
  it('marks an invoice overdue on the organization’s date, not the UTC one', () => {
    const row = {
      doc_type: 'invoice',
      status: 'Unpaid',
      due_date: '2026-10-24',
      paid_minor: 0,
      balance_minor: 100,
    } as const;
    // 00:30 on 25 Oct in Colombo is still 24 Oct in UTC.
    const now = new Date('2026-10-24T19:00:00Z');
    expect(displayStatus(row, todayIn('Asia/Colombo', now))).toBe('Overdue');
    expect(displayStatus(row, todayIn('UTC', now))).toBe('Unpaid');
  });
});
