import { defineConfig } from 'playwright/test';

export default defineConfig({
  fullyParallel: false,
  outputDir: '../../../.dexter/dashboard-browser-test-results',
  reporter: 'line',
  testDir: '.',
  testMatch: ['app.browser.playwright.ts', 'primitives.browser.playwright.ts', 'workspace.browser.playwright.ts', 'drawing.browser.playwright.ts', 'trendline.browser.playwright.ts'],
  timeout: 30_000,
  use: {
    headless: true,
  },
  workers: 1,
});
