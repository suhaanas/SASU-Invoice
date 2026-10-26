import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Invoice dates are calendar dates: parse and build them in local time
// (src/core/dates.ts). UTC conversions shift them a day across time zones.
const calendarDateRules = [
  {
    selector:
      "CallExpression[callee.property.name=/^(slice|substring|substr|split)$/][callee.object.callee.property.name='toISOString']",
    message:
      'toISOString() is UTC and shifts calendar dates across time zones. Use todayISO()/toISODate() from src/core/dates.ts (or todayIn(org.timezone)).',
  },
  {
    selector: "NewExpression[callee.name='Date'] > Literal[value=/^\\d{4}-\\d{2}-\\d{2}$/]",
    message:
      "new Date('YYYY-MM-DD') is read as UTC midnight. Use parseISODate() from src/core/dates.ts.",
  },
];

export default tseslint.config(
  {
    ignores: [
      'dist',
      'dist-e2e',
      'test-results',
      'playwright-report',
      'node_modules',
      '.kilo',
      'supabase/functions/_shared/core',
    ],
  },
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
        // jsPDF APIs behind the 2025–26 advisories (see docs/research-report.md).
        { property: 'addJS', message: 'jsPDF addJS is banned (script injection advisories).' },
        {
          property: 'createAnnotation',
          message: 'jsPDF createAnnotation is banned (injection advisory).',
        },
        { property: 'addSvgAsImage', message: 'jsPDF addSvgAsImage is banned (ReDoS advisory).' },
        { property: 'AcroForm', message: 'jsPDF AcroForm is banned (injection advisories).' },
        { property: 'html', message: 'jsPDF html() is banned; build PDFs from state instead.' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.property.name='write'][callee.object.name='document']",
          message: 'document.write is banned.',
        },
        ...calendarDateRules,
      ],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
    },
  },
  {
    files: ['src/dashboard/**/*.tsx'],
    ...reactHooks.configs.flat['recommended-latest'],
  },
  {
    files: ['**/*.tsx'],
    rules: {
      // Same XSS rule as innerHTML, for React.
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'Render text, never HTML.',
        },
        ...calendarDateRules,
      ],
    },
  },
  {
    files: ['scripts/**', 'vite.config.ts', 'playwright.config.ts', 'e2e/**'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['tests/**'],
    rules: { 'no-restricted-properties': 'off' },
  },
);
