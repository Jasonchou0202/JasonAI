import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  timeout: 30000,
  expect: { timeout: 10000 },
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4173/JasonAI/",
    browserName: "chromium",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  reporter: process.env.CI ? "github" : "list",
  webServer: {
    command: "npm run build -- --outDir dist-e2e && npm run preview -- --outDir dist-e2e --port 4173 --strictPort",
    url: "http://127.0.0.1:4173/JasonAI/",
    timeout: 180000,
    reuseExistingServer: false,
    env: { VITE_CLOUDBASE_ENV_ID: "", VITE_CLOUDBASE_PUBLISHABLE_KEY: "" },
  },
});
