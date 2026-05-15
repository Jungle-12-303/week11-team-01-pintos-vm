import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure"
  },
  webServer: {
    command: "npm run dev:e2e",
    url: "http://127.0.0.1:5173",
    env: {
      ...process.env,
      SYMBOL_DIFF_STATE_DIR: ".tmp/e2e-state"
    },
    reuseExistingServer: !process.env.CI,
    timeout: 30000
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
