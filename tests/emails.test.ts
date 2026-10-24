import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCHEDULE,
  applyTone,
  DEFAULT_TEMPLATES,
  EMAIL_KINDS,
  cleanSubject,
  defaultKindForOffset,
  fill,
  renderEmail,
  toHtml,
  toneViolation,
  unknownPlaceholders,
} from '../src/core/emails';

const vars = {
  client_name: 'Jane',
  business_name: 'Acme',
  invoice_number: 'INV-7',
  amount_due: '£50.00',
  due_date: '1 Nov 2026',
  days_overdue: '12',
  link: 'https://app.test/invoice.html#t=abc',
  signature: 'Acme Ltd',
};

describe('email templates', () => {
  it('every default template fills completely and links to the invoice', () => {
    for (const kind of EMAIL_KINDS) {
      const out = renderEmail({ template: DEFAULT_TEMPLATES[kind], tone: 'friendly', vars });
      expect(out.text).not.toMatch(/\{\{/);
      expect(out.subject).not.toMatch(/\{\{/);
      expect(out.text).toContain(vars.link);
      expect(toneViolation(out.text)).toBeNull();
    }
  });

  it('every tone renders without threatening language', () => {
    for (const tone of ['friendly', 'professional', 'neutral', 'firm'] as const) {
      const out = renderEmail({ template: DEFAULT_TEMPLATES.follow_up, tone, vars });
      expect(toneViolation(out.text)).toBeNull();
    }
  });

  it('leaves unknown placeholders visible and reports them', () => {
    expect(fill('Hi {{client_name}} {{iban}}', vars)).toBe('Hi Jane {{iban}}');
    expect(unknownPlaceholders('{{client_name}} {{ iban }} {{iban}}')).toEqual(['iban']);
  });

  it('builds HTML from escaped text, linking only the invoice link', () => {
    const html = toHtml(
      'Hi <script>alert(1)</script>\nSee https://app.test/x and https://evil.test',
      'https://app.test/x',
    );
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('<a href="https://app.test/x"');
    expect(html).not.toContain('href="https://evil.test"');
    expect(html).toContain('<br>');
  });

  it('keeps subjects on one line', () => {
    expect(cleanSubject('Invoice\r\nBcc: x@y.test')).toBe('Invoice Bcc: x@y.test');
    expect(cleanSubject('x'.repeat(300))).toHaveLength(200);
  });

  it('flags threatening phrases', () => {
    expect(toneViolation('We will start legal action')).toBe('legal action');
    expect(toneViolation('Passing this to a debt collector')).toBe('debt collect');
    expect(toneViolation('Please pay when you can')).toBeNull();
  });

  it('maps reminder timing to a sensible template', () => {
    expect(DEFAULT_SCHEDULE.map((s) => defaultKindForOffset(s.offsetDays))).toEqual([
      'due_soon',
      'due_today',
      'overdue',
      'follow_up',
      'follow_up',
    ]);
  });
});

describe('applyTone', () => {
  it('fills tone lines only', () => {
    const out = applyTone(DEFAULT_TEMPLATES.overdue.body, 'firm');
    expect(out).not.toContain('{{tone_opening}}');
    expect(out).toContain('{{client_name}}');
    expect(out).toContain('{{link}}');
  });
});
