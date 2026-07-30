import { defineConfig } from "@playwright/test";

const baseURL = process.env.AELYRIS_PLAYWRIGHT_BASE_URL ?? "http://localhost:1420";

/**
 * Playwright E2E config for Aelyris (Tauri + WebView2).
 *
 * Connection strategy:
 * 1. Start `pnpm tauri dev` manually (or via webServer config)
 * 2. Connect to WebView2 via CDP (Chrome DevTools Protocol)
 *    - Tauri sets WEBKIT_INSPECTOR_SERVER env for debug port
 *    - Or use `--remote-debugging-port` in tauri dev args
 * 3. Alternatively, test against Vite dev server directly (localhost:1420)
 *    for frontend-only tests
 *
 * Usage:
 *   pnpm test:e2e         # Run all E2E tests
 *   pnpm test:e2e:ui      # Open Playwright UI
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 1,
  use: {
    // Local Tauri/Vite keeps localhost; hosted CI injects its exact IPv4 listener.
    baseURL,
    headless: true,
    screenshot: "only-on-failure",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "frontend",
      use: {
        browserName: "chromium",
      },
    },
  ],
  // Uncomment to auto-start Vite dev server
  // webServer: {
  //   command: "pnpm dev",
  //   port: 1420,
  //   reuseExistingServer: true,
  // },
});
