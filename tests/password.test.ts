import { describe, expect, it } from 'vitest';
import { isGuessable, MIN_PASSWORD, passwordProblem, passwordRules } from '../src/core/password';

describe('password rules', () => {
  it('needs 12+ characters with lower, upper, digit and a Supabase symbol', () => {
    expect(MIN_PASSWORD).toBe(12);
    expect(passwordProblem('Harbour-Lights-77')).toBeNull();
    expect(passwordProblem('Short-1a')).toMatch(/12 characters/);
    expect(passwordProblem('harbour-lights-77')).toMatch(/uppercase/);
    expect(passwordProblem('HARBOUR-LIGHTS-77')).toMatch(/lowercase/);
    expect(passwordProblem('Harbour-Lights-xx')).toMatch(/number/);
    expect(passwordProblem('HarbourLights77x')).toMatch(/symbol/);
    // A space is not one of the symbols Supabase counts.
    expect(passwordProblem('Harbour Lights 77')).toMatch(/symbol/);
  });

  it('rejects guessable passwords', () => {
    expect(isGuessable('MyPassword!2026')).toBe(true);
    expect(isGuessable('Zebra-1234-Moon')).toBe(true);
    expect(isGuessable('Zebra-4321-Moon')).toBe(true);
    expect(isGuessable('Zebra-aaaa-Moon7')).toBe(true);
    expect(isGuessable('Kandy#Lake#2026', 'kandylake@example.com')).toBe(false);
    expect(isGuessable('Suha-Anas#2026x', 'suha-anas@example.com')).toBe(true);
    expect(passwordProblem('Qwerty-Lanka-77')).toMatch(/too easy to guess/);
  });

  it('lists every rule for the live checklist', () => {
    const rules = passwordRules('Harbour-Lights-77');
    expect(rules.map((r) => r.id)).toEqual([
      'length',
      'lower',
      'upper',
      'digit',
      'symbol',
      'guessable',
    ]);
    expect(rules.every((r) => r.ok)).toBe(true);
  });
});
