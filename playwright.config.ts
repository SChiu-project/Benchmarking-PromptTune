import { defineConfig, devices } from "@playwright/test";

// UI checks from the workbook's acceptance list (§12). Point UI_BASE_URL at a
// running app, or let Playwright start `next dev` on port 3100. Pages only read
// workspace data; the specs start no benchmark runs.
const baseURL = process.env.UI_BASE_URL || "http://127.0.0.1:3100";

export default defineConfig({
  testDir: "tests/ui",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL, ...devices["Desktop Chrome"] },
  webServer: process.env.UI_BASE_URL
    ? undefined
    : {
        command:
          "node node_modules/next/dist/bin/next dev --webpack --hostname 127.0.0.1 --port 3100",
        url: baseURL,
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
