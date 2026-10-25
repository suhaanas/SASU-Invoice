import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import type { Connect, Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

/** Serve the production security headers from netlify.toml in `vite preview` too. */
function netlifyHeaders(): Record<string, string> {
  const toml = readFileSync(resolve(import.meta.dirname, 'netlify.toml'), 'utf8');
  const block = toml.split('[[headers]]')[1] ?? '';
  return Object.fromEntries(
    // TOML escapes quotes inside values (e.g. Permissions-Policy origins).
    [...block.matchAll(/^\s+([\w-]+) = "(.*)"$/gm)].map((m) => [m[1]!, m[2]!.replace(/\\"/g, '"')]),
  );
}

const stub = resolve(import.meta.dirname, 'src/stubs/unused.ts');

/**
 * The dashboard is a client-routed SPA under /dashboard/. Netlify rewrites
 * those paths to dashboard.html (netlify.toml); do the same in dev/preview.
 */
function dashboardFallback(): Plugin {
  const rewrite: Connect.NextHandleFunction = (req, _res, next) => {
    const path = req.url?.split('?')[0] ?? '';
    if (/^\/dashboard(\/[^.]*)?$/.test(path)) req.url = '/dashboard.html';
    next();
  };
  return {
    name: 'dashboard-fallback',
    configureServer: (server) => void server.middlewares.use(rewrite),
    configurePreviewServer: (server) => void server.middlewares.use(rewrite),
  };
}

export default defineConfig({
  resolve: {
    // jsPDF lazy-imports these for doc.html()/SVG, which we never use.
    alias: { html2canvas: stub, dompurify: stub, canvg: stub },
  },
  // React's automatic JSX runtime for the dashboard (.tsx), compiled by Vite's oxc.
  oxc: { jsx: { runtime: 'automatic' } },
  plugins: [
    dashboardFallback(),
    tailwindcss(),
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
          {
            src: '/icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
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
      onwarn(warning, warn) {
        // React libraries ship "use client" for RSC; meaningless in this client-only SPA.
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE') return;
        warn(warning);
      },
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        app: resolve(import.meta.dirname, 'app.html'),
        dashboard: resolve(import.meta.dirname, 'dashboard.html'),
        invoice: resolve(import.meta.dirname, 'invoice.html'),
        pricing: resolve(import.meta.dirname, 'pricing.html'),
        pay: resolve(import.meta.dirname, 'pay.html'),
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,tsx}'],
  },
});
