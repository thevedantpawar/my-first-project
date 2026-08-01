import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end suite.
 *
 * Runs against the dev server rather than a production build, because the
 * local-disk private-storage driver deliberately refuses to run with
 * NODE_ENV=production — prescription images must go to real private object
 * storage there. That refusal is a feature, so the tests work with it.
 *
 * Serial, single worker: the specs share one seeded database and several of
 * them assert on queue contents, which concurrent runs would make
 * non-deterministic.
 */
/** process.env with undefined values dropped, which is what webServer.env wants. */
function inheritedEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

export default defineConfig({
  testDir: "./e2e",
  // Compiles the dev server's route and Server Action graph before any spec
  // asserts on it. See e2e/global-setup.ts.
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : [["list"]],
  timeout: 90_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 20_000,
  },

  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // The image ships Chromium at a fixed path; Playwright's own download
        // is disabled here (PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD).
        launchOptions: process.env.CHROMIUM_PATH
          ? { executablePath: process.env.CHROMIUM_PATH }
          : {},
      },
    },
  ],

  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npx next dev -p 3100",
        url: "http://localhost:3100/login",
        // Never reuse: in-process state (rate-limit windows) from an earlier
        // run would otherwise change how the suite behaves.
        reuseExistingServer: false,
        timeout: 120_000,
        // Playwright REPLACES process.env with whatever is given here rather
        // than merging, so the parent environment has to be spread in
        // explicitly. Without it, Next's own internal variables go missing and
        // rendering fails with "Unexpected end of JSON input".
        env: {
          ...inheritedEnv(),
          AUTH_SECRET: process.env.AUTH_SECRET ?? "e2e-only-secret",
          NEXT_PUBLIC_SITE_URL: "http://localhost:3100",
          // The suite signs in on nearly every spec and would otherwise trip
          // the sign-in limit. The bypass throws if NODE_ENV=production.
          RATE_LIMIT_DISABLED: "true",
        },
      },
});
