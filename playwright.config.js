const {defineConfig} = require('@playwright/test')

// the renderer is a dev server, and the app is pointed at the same port: one
// number for both halves, so a run never loads a page from another server
const WEB_PORT = process.env.TINKR_E2E_WEB_PORT || '8123'

process.env.WEB_PORT = WEB_PORT

module.exports = defineConfig({
  testDir: './e2e/specs',
  // one Electron instance at a time: the app is a single window, a connection
  // is a single session, and a store is a file. Parallel workers would share
  // none of that safely.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 120_000,
  expect: {
    timeout: 20_000,
  },
  reporter: [['list'], ['html', {open: 'never', outputFolder: 'e2e/report'}]],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    // the app loads editor.html from here in development, and `is.development`
    // is what makes it do that: the entry is the source main, not a package
    command: 'corepack yarn workspace tinkr-renderer start',
    url: `http://localhost:${WEB_PORT}/editor.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...process.env,
      WEB_PORT,
    },
  },
})
