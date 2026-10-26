/**
 * Password rules shown and checked in the browser. Supabase Auth enforces the
 * same length and character classes on the server (supabase/config.toml:
 * minimum_password_length, password_requirements); the guessable-pattern check
 * is browser-only.
 */

export const MIN_PASSWORD = 12;

export interface PasswordRule {
  id: 'length' | 'lower' | 'upper' | 'digit' | 'symbol' | 'guessable';
  label: string;
  ok: boolean;
}

/** The symbols Supabase Auth counts for "lower_upper_letters_digits_symbols". */
const SYMBOL = /[!@#$%^&*()_+\-=[\]{};':"|<>?,./`~]/;

/** Words and runs that make a password easy to guess, whatever surrounds them. */
const GUESSABLE = [
  'password',
  'passw0rd',
  'p@ssword',
  'qwerty',
  'azerty',
  'asdfgh',
  'zxcvbn',
  'letmein',
  'welcome',
  'admin',
  'login',
  'iloveyou',
  'monkey',
  'dragon',
  'sunshine',
  'football',
  'baseball',
  'princess',
  'master',
  'shadow',
  'superman',
  'trustno1',
  'abc123',
  'invoice',
  'sasu',
  'changeme',
  'secret',
];
const SEQUENCES = [
  '0123456789',
  'abcdefghijklmnopqrstuvwxyz',
  'qwertyuiop',
  'asdfghjkl',
  'zxcvbnm',
];

/** True when the password leans on a common word, a run (1234, abcd), a repeat (aaaa) or the email. */
export function isGuessable(password: string, email = ''): boolean {
  const p = password.toLowerCase();
  if (GUESSABLE.some((w) => p.includes(w))) return true;
  if (/(.)\1{3,}/.test(p)) return true;
  for (const seq of SEQUENCES) {
    for (let i = 0; i + 4 <= seq.length; i++) {
      const run = seq.slice(i, i + 4);
      if (p.includes(run) || p.includes([...run].reverse().join(''))) return true;
    }
  }
  const name = email.toLowerCase().split('@')[0] ?? '';
  return name.length >= 4 && p.includes(name);
}

export function passwordRules(password: string, email = ''): PasswordRule[] {
  return [
    {
      id: 'length',
      label: `At least ${MIN_PASSWORD} characters`,
      ok: password.length >= MIN_PASSWORD,
    },
    { id: 'lower', label: 'A lowercase letter', ok: /[a-z]/.test(password) },
    { id: 'upper', label: 'An uppercase letter', ok: /[A-Z]/.test(password) },
    { id: 'digit', label: 'A number', ok: /\d/.test(password) },
    { id: 'symbol', label: 'A symbol such as ! ? # or %', ok: SYMBOL.test(password) },
    {
      id: 'guessable',
      label: 'No common words, runs like 1234, or your email',
      ok: password.length > 0 && !isGuessable(password, email),
    },
  ];
}

/** The first unmet rule as a sentence, or null when the password is acceptable. */
export function passwordProblem(password: string, email = ''): string | null {
  const missing = passwordRules(password, email).find((r) => !r.ok);
  if (!missing) return null;
  return missing.id === 'guessable'
    ? 'That password is too easy to guess. Avoid common words, runs like 1234, and your email.'
    : `Your password needs: ${missing.label.toLowerCase()}.`;
}
