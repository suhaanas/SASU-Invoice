import { beforeEach, describe, expect, it } from 'vitest';
import { _resetSuggestionCycle, suggestDescription, suggestNote } from '../src/core/suggestions';

beforeEach(() => _resetSuggestionCycle());

describe('suggestions', () => {
  it('prefers the most specific category', () => {
    expect(suggestDescription('web design')).toMatch(/website/i);
  });

  it('cycles through variants on repeated calls', () => {
    const a = suggestDescription('logo');
    const b = suggestDescription('logo');
    expect(a).not.toBe(b);
    expect(a).toMatch(/logo/i);
  });

  it('does not match short keywords inside other words', () => {
    // "it" (IT services) must not match "edit"
    expect(suggestDescription('edit')).toMatch(/edit|proofread/i);
  });

  it('falls back to a polished version of the input', () => {
    expect(suggestDescription('quarterly widget review')).toMatch(/^Quarterly widget review/);
    expect(suggestDescription('   ')).toBeNull();
  });

  it('fills note templates', () => {
    const note = suggestNote('formal', { client: 'Ada', business: 'Acme', dueDate: 'Nov 4, 2026', total: '$100.00', number: 'INV-7' });
    expect(note).toContain('Ada');
    expect(note).not.toMatch(/\{\w+\}/);
  });
});
