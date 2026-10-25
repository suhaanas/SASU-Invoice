import { describe, expect, it } from 'vitest';
import {
  buildRecurringDocument,
  describeSchedule,
  occurrenceDate,
  upcomingDates,
} from '../src/core/recurrence';
import { createInvoice } from '../src/core/state';

describe('recurrence dates', () => {
  it('counts from the start so month-ends never drift (same as the SQL)', () => {
    expect([1, 2, 3].map((k) => occurrenceDate('2026-01-31', 'month', 1, k))).toEqual([
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ]);
    expect(occurrenceDate('2024-02-29', 'year', 1, 1)).toBe('2025-02-28');
    expect(occurrenceDate('2026-01-01', 'week', 2, 3)).toBe('2026-02-12');
    expect(occurrenceDate('2026-01-15', 'month', 3, 2)).toBe('2026-07-15');
  });

  it('stops at the end date', () => {
    expect(
      upcomingDates(
        { startDate: '2026-01-10', unit: 'month', every: 1, endDate: '2026-03-10' },
        0,
        10,
      ),
    ).toEqual(['2026-01-10', '2026-02-10', '2026-03-10']);
  });

  it('describes common schedules by name', () => {
    expect(describeSchedule('month', 3)).toBe('Quarterly');
    expect(describeSchedule('week', 2)).toBe('Every 2 weeks');
  });
});

describe('buildRecurringDocument', () => {
  const template = () => {
    const t = createInvoice();
    t.meta.issueDate = '2026-09-01';
    t.meta.dueTerm = 'net30';
    t.meta.dueDate = '2026-10-01';
    t.meta.number = 'INV-007';
    t.meta.issuedAt = 123;
    t.meta.status = 'Paid';
    t.totals.amountPaid = 99;
    return t;
  };

  it('copies content, re-dates it and resets payment state', () => {
    const t = template();
    const doc = buildRecurringDocument(t, '2026-11-01', { issue: true, now: 5 });
    expect(doc.id).not.toBe(t.id);
    expect(doc.items[0]!.id).not.toBe(t.items[0]!.id);
    expect(doc.items[0]!.desc).toBe(t.items[0]!.desc);
    expect(doc.meta).toMatchObject({
      issueDate: '2026-11-01',
      dueDate: '2026-12-01',
      status: 'Unpaid',
      issuedAt: 5,
    });
    expect(doc.meta.number).toBe('PENDING');
    expect(doc.totals.amountPaid).toBe(0);
    expect(t.meta.number).toBe('INV-007');
  });

  it('keeps a custom gap between issue and due dates, and drafts stay unissued', () => {
    const t = template();
    t.meta.dueTerm = 'custom';
    t.meta.dueDate = '2026-09-15';
    const doc = buildRecurringDocument(t, '2026-11-01', { issue: false, now: 5 });
    expect(doc.meta).toMatchObject({ dueDate: '2026-11-15', status: 'Draft', issuedAt: null });
  });
});
