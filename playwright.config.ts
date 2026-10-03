import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright end-to-end demo walkthrough (Milestone 8).
 *
 * Drives the real Vite web app against the real Fastify API served by
 * `apps/api/src/e2e-server.ts`, which runs the deterministic fake models —
 * the walkthrough needs no OpenAI key and no external network.
 *
 * Prerequisite: PostgreSQL from `pnpm db:up` must be running. The API server
 * targets a dedicated `formless_e2e` database (override with
 * `E2E_DATABASE_URL`) and resets it on every boot.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  globalTimeout: 5 * 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: './test-results',
  use: {
    baseURL: 'http://127.0.0.1:5175',
    headless: true,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter @formless/api dev:e2e',
      url: 'http://127.0.0.1:3005/api/v1/health',
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        PORT: '3005',
        CORS_ORIGIN: 'http://127.0.0.1:5175',
        E2E_DATABASE_URL:
          process.env.E2E_DATABASE_URL ??
          'postgresql://formless:formless@127.0.0.1:5432/formless_e2e',
      },
    },
    {
      command: 'pnpm --filter @formless/web dev:e2e',
      url: 'http://127.0.0.1:5175',
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        VITE_API_URL: 'http://127.0.0.1:3005/api/v1',
      },
    },
  ],
});
