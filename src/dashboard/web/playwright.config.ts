import { defineConfig } from 'playwright/test';

export default defineConfig({
  fullyParallel: false,
  outputDir: '../../../.dexter/dashboard-browser-test-results',
  reporter: 'line',
  testDir: '.',
  testMatch: 'app.browser.playwright.ts',
  timeout: 30_000,
  use: {
    headless: true,
  },
  workers: 1,
});
