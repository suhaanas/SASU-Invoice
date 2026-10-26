import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests against the production build served with the real
 * security headers (vite preview reads them from netlify.toml). The build uses
 * a placeholder Supabase URL; tests mock the few network calls they need.
 * Uses the installed Google Chrome, so no browser download is required.
 */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4180',
    channel: 'chrome',
    acceptDownloads: true,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run build:e2e && npx vite preview --outDir dist-e2e --port 4180 --strictPort',
    url: 'http://localhost:4180/index.html',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
