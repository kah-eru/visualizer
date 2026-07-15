import { defineConfig, devices } from "@playwright/test";

// One smoke test over the BUILT app (see e2e/smoke.spec.js). This is the only automated check that
// exercises the DOM render pipeline end to end — the unit suite covers the pure modules in Node and
// can't see wiring, import order, or a Chart.js/PapaParse upgrade breaking the page.
//
// It runs against `npm run preview` (the production bundle) rather than the dev server, so it also
// covers the build itself. Note the /visualizer/ base path — GitHub Project Pages serves from a
// subpath, and vite.config.js sets `base` to match; a bare "/" would 404 here.
export default defineConfig({
  testDir: "e2e",
  // Vitest owns tests/**/*.test.js and Playwright owns e2e/**/*.spec.js — the globs don't overlap,
  // so the two runners never try to collect each other's files.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0, // a flaky smoke test is worse than none — if it fails, it should mean something
  // CI gets both: `list` for readable step logs, plus the HTML report that ci.yml uploads as an
  // artifact when the run fails (a failure you can't inspect is a failure you'll be tempted to
  // rerun until it passes). `open: never` keeps it from trying to launch a browser on the runner.
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "html",
  use: {
    baseURL: "http://localhost:4173/visualizer/",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run preview",
    url: "http://localhost:4173/visualizer/",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
