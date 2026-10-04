import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', '.kilo'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      // Security: user data must never reach the DOM as markup.
      'no-restricted-properties': [
        'error',
        { property: 'innerHTML', message: 'Use textContent / createElement instead.' },
        { property: 'outerHTML', message: 'Use textContent / createElement instead.' },
        { property: 'insertAdjacentHTML', message: 'Use createElement instead.' },
      ],
      'no-restricted-syntax': [
        'error',
        { selector: "CallExpression[callee.property.name='write'][callee.object.name='document']", message: 'document.write is banned.' },
      ],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
    },
  },
  {
    files: ['tests/**'],
    rules: { 'no-restricted-properties': 'off' },
  },
);
