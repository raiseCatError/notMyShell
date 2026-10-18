import { defineConfig } from '@playwright/test';

const port = process.env.WEBSITE_TEST_PORT || '4321';
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL,
    launchOptions: { channel: 'chrome' },
    trace: 'off', video: 'off', screenshot: 'off',
  },
  webServer: {
    command: `${process.env.WEBSITE_TEST_DEV ? 'npm run dev' : 'npm run preview'} -- --port ${port}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 30000,
  },
});
