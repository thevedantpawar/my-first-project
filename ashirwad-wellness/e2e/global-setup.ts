import { chromium, type FullConfig } from "@playwright/test";
import { execFileSync } from "node:child_process";

/**
 * Warms the dev server before the suite runs.
 *
 * Next compiles routes on demand in development, and the first sign-in POST
 * has to build the whole auth graph — NextAuth, Prisma, bcrypt — which on a
 * cold server takes longer than any sensible per-action timeout. Without this,
 * the first spec pays that cost and times out while the button is still
 * spinning.
 *
 * Doing one real sign-in here means the action module graph is compiled before
 * any assertion depends on it.
 */
/**
 * Resets the transactional state the suite depends on.
 *
 * Deliberately partial: Schedule H1 register entries are append-only and pin
 * the order items they dispensed, so those orders survive by design. Every
 * spec is written to tolerate pre-existing orders; what must be clean is the
 * customer's cart, prescriptions and addresses.
 */
function resetTestState() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required for the e2e suite.");

  execFileSync(
    "psql",
    [
      url.split("?")[0],
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      `
      DELETE FROM cart_items;
      DELETE FROM prescriptions
        WHERE id NOT IN (SELECT "prescriptionId" FROM order_items WHERE "prescriptionId" IS NOT NULL);
      DELETE FROM addresses
        WHERE id NOT IN (SELECT "addressId" FROM orders);
      UPDATE users SET "pharmacistRegNo" = 'MSPC-E2E-0001'
        WHERE email = 'pharmacist@ashirwadwellness.in';
      `,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
}

export default async function globalSetup(config: FullConfig) {
  resetTestState();

  const baseURL =
    config.projects[0]?.use?.baseURL ?? process.env.E2E_BASE_URL ?? "http://localhost:3100";

  const routes = [
    "/login",
    "/",
    "/cart",
    "/checkout",
    "/account",
    "/pharmacist",
    "/pharmacist/orders",
    "/admin",
    "/admin/orders",
    "/admin/audit",
    "/product/zifi-200-tablet",
    "/category/medicines",
    "/salt/paracetamol",
    "/robots.txt",
    "/sitemap.xml",
  ];

  for (const route of routes) {
    try {
      await fetch(`${baseURL}${route}`, { redirect: "manual" });
    } catch {
      // The webServer health check already proved the server is up; a single
      // warming request failing is not worth aborting the run for.
    }
  }

  // Compile the sign-in Server Action path with one real submission.
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });
  const page = await browser.newPage({ baseURL });

  try {
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("input[name=email]", { timeout: 60_000 });
    await page.fill("input[name=email]", "customer@example.invalid");
    await page.fill("input[name=password]", "Ashirwad@2026");
    await page.click("button[type=submit]");
    await page
      .waitForFunction(() => !window.location.pathname.startsWith("/login"), null, {
        timeout: 120_000,
        polling: 250,
      })
      .catch(() => {
        // Even a failure here has done the useful work of compiling the route.
      });
  } finally {
    await browser.close();
  }
}
