import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

/** Serve the production security headers from netlify.toml in `vite preview` too. */
function netlifyHeaders(): Record<string, string> {
  const toml = readFileSync(resolve(import.meta.dirname, 'netlify.toml'), 'utf8');
  const block = toml.split('[[headers]]')[1] ?? '';
  return Object.fromEntries([...block.matchAll(/^\s+([\w-]+) = "(.*)"$/gm)].map((m) => [m[1]!, m[2]!]));
}

const stub = resolve(import.meta.dirname, 'src/stubs/unused.ts');

export default defineConfig({
  resolve: {
    // jsPDF lazy-imports these for doc.html()/SVG, which we never use.
    alias: { html2canvas: stub, dompurify: stub, canvg: stub },
  },
  preview: { headers: netlifyHeaders() },
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        app: resolve(import.meta.dirname, 'app.html'),
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
  },
});
