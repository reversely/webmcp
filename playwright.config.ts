import { defineConfig, devices } from "@playwright/test";

/**
 * The scripted demo (PRD 21, 22) and the WebMCP integration suite (PRD 23) run against the dev
 * server on port 3111. A server already listening there is reused; otherwise Playwright starts one.
 * Videos record every run so the demo can be cut from the test output; Ben's and Zach's contexts
 * in tests/demo.spec.ts write theirs to tests/videos.
 */
export default defineConfig({
  testDir: "./tests",
  outputDir: "test-results",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 180_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:3111",
    video: "on",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    viewport: { width: 1440, height: 900 }
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: "npm run dev -- -p 3111",
    url: "http://localhost:3111/api/projects",
    reuseExistingServer: true,
    timeout: 120_000
  }
});
