import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { VitePWA } from 'vite-plugin-pwa';
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
  plugins: [
    VitePWA({
      registerType: 'prompt',
      // We call registerSW() ourselves (src/editor/pwa.ts) to show update prompts.
      injectRegister: false,
      includeAssets: ['favicon.svg', 'robots.txt'],
      manifest: {
        name: 'SASU Invoice',
        short_name: 'SASU Invoice',
        description: 'Create invoices, quotes and credit notes in your browser. Works offline.',
        start_url: '/app.html',
        scope: '/',
        display: 'standalone',
        background_color: '#f4f5f7',
        theme_color: '#ffffff',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff,woff2,ttf,webmanifest}'],
        navigateFallback: null,
        cleanupOutdatedCaches: true,
      },
    }),
  ],
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
