import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4321',
    launchOptions: { channel: 'chrome' },
    trace: 'off', video: 'off', screenshot: 'off',
  },
  webServer: {
    command: process.env.WEBSITE_TEST_DEV ? 'npm run dev -- --port 4321' : 'npm run preview -- --port 4321',
    url: 'http://127.0.0.1:4321',
    reuseExistingServer: false,
    timeout: 30000,
  },
});
