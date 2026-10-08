import { defineConfig, devices } from '@playwright/test';

/**
 * Сквозные тесты: настоящий API на своей базе (backend/test/e2e-server.ts
 * сбрасывает её и кладёт демо) и собранный веб (vite preview с прокси на
 * API). Отдельная пара серверов на пустой базе - для регистрации гостиницы.
 *
 * Браузеры: E2E_BROWSERS=chromium,firefox,webkit (по умолчанию только
 * chromium). Порты не пересекаются с разработкой (4000/5173).
 */
const CI = !!process.env.CI;
const DB = process.env.E2E_DATABASE_URL ?? 'postgres://bizdin:bizdin@localhost:5433/bizdin_e2e';
const DB_EMPTY = process.env.E2E_EMPTY_DATABASE_URL ?? 'postgres://bizdin:bizdin@localhost:5433/bizdin_e2e_empty';
const browsers = (process.env.E2E_BROWSERS ?? 'chromium').split(',').map((s) => s.trim());

export const API = 'http://127.0.0.1:4100';
export const WEB = 'http://127.0.0.1:4173';
const API_EMPTY = 'http://127.0.0.1:4101';
const WEB_EMPTY = 'http://127.0.0.1:4174';

const desktop = { viewport: { width: 1440, height: 900 } };

export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/.out',
  timeout: 90_000,
  expect: { timeout: 12_000 },
  // Одна база на прогон: тесты идут по очереди и сами готовят свои данные.
  workers: 1,
  fullyParallel: false,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [['github'], ['list'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: WEB,
    locale: 'ru-RU',
    timezoneId: 'Asia/Almaty',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: CI ? 'retain-on-failure' : 'off',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    { name: 'setup', testMatch: /setup\.spec\.ts/, use: { ...devices['Desktop Chrome'], ...desktop, baseURL: WEB_EMPTY } },
    { name: 'chromium', testIgnore: [/setup\.spec\.ts/, /smoke\.spec\.ts/, /perf\.spec\.ts/], use: { ...devices['Desktop Chrome'], ...desktop } },
    { name: 'perf', testMatch: /perf\.spec\.ts/, use: { ...devices['Desktop Chrome'], ...desktop } },
    ...(browsers.includes('firefox') ? [{ name: 'firefox', testMatch: /smoke\.spec\.ts/, use: { ...devices['Desktop Firefox'], ...desktop } }] : []),
    ...(browsers.includes('webkit')
      ? [
          { name: 'webkit', testMatch: /smoke\.spec\.ts/, use: { ...devices['Desktop Safari'], ...desktop } },
          { name: 'iphone', testMatch: /smoke\.spec\.ts/, use: { ...devices['iPhone 15'] } },
        ]
      : []),
    { name: 'android', testMatch: /smoke\.spec\.ts/, use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      command: 'pnpm -C backend exec tsx test/e2e-server.ts',
      url: `${API}/health/ready`,
      env: { DATABASE_URL: DB, PORT: '4100', HOST: '127.0.0.1', CORS_ORIGINS: WEB, PUBLIC_API_URL: WEB },
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      // Собранный веб, как на проде; прокси /api - на e2e-API.
      command: `${CI ? '' : 'pnpm exec vite build && '}pnpm exec vite preview --host 127.0.0.1 --port 4173 --strictPort`,
      url: WEB,
      env: { VITE_DEV_API: API },
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: 'pnpm -C backend exec tsx test/e2e-server.ts',
      url: `${API_EMPTY}/health/ready`,
      env: { DATABASE_URL: DB_EMPTY, PORT: '4101', HOST: '127.0.0.1', E2E_EMPTY: '1', CORS_ORIGINS: WEB_EMPTY, PUBLIC_API_URL: WEB_EMPTY, FILES_DIR: '.data/e2e-empty-files' },
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: 'pnpm exec vite --host 127.0.0.1 --port 4174 --strictPort',
      url: WEB_EMPTY,
      env: { VITE_DEV_API: API_EMPTY },
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});
