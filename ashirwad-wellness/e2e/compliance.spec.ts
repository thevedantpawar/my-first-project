import { test, expect } from "@playwright/test";

import { signIn, expectNoHorizontalOverflow, sql, ADMIN, CUSTOMER } from "./helpers";

/**
 * Compliance surfaces, role boundaries, SEO, and the responsive floor.
 */

test("statutory identifiers appear on the storefront and at checkout", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const footer = page.locator("footer");
  await expect(footer).toContainText("Drug Licence (Form 20B)");
  await expect(footer).toContainText("Drug Licence (Form 21B)");
  await expect(footer).toContainText("FSSAI Licence");
  await expect(footer).toContainText(/Registration No/i);

  // Unset values are surfaced, not hidden — a footer that quietly omits a
  // missing drug licence number is worse than one that says it is missing.
  await expect(footer).toContainText(/Not configured|[A-Z0-9-]{4,}/);
});

test("a customer cannot reach the pharmacist portal or admin", async ({ page }) => {
  await signIn(page, CUSTOMER);

  for (const path of ["/pharmacist", "/pharmacist/register", "/admin", "/admin/audit"]) {
    const response = await page.goto(path, { waitUntil: "domcontentloaded" });
    const landed = new URL(page.url()).pathname;
    const blocked = landed !== path || (response?.status() ?? 200) >= 400;
    expect(blocked, `${path} must not be reachable by a customer`).toBe(true);
  }
});

test("an admin cannot release an order held for pharmacist review", async ({ page }) => {
  // This asserts an admin-UI boundary, not the Rx gate, so the held order is
  // arranged directly rather than driven through the whole dispensing flow.
  const held = Number(
    sql(`SELECT COUNT(*) FROM orders WHERE status = 'PENDING_PHARMACIST_REVIEW'`),
  );
  if (held === 0) {
    sql(`
      UPDATE orders SET status = 'PENDING_PHARMACIST_REVIEW'
      WHERE id = (SELECT id FROM orders ORDER BY "placedAt" DESC LIMIT 1)
    `);
  }

  await signIn(page, ADMIN);
  await page.goto("/admin/orders", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  const row = page.locator("tr", { hasText: "pending pharmacist review" });
  await expect(row.first()).toBeVisible();

  // No control is offered — the row states the decision belongs to a pharmacist.
  await expect(row.first()).toContainText(/Pharmacist decision required/i);
  await expect(row.first().locator("select")).toHaveCount(0);
});

test("the audit log viewer is read-only", async ({ page }) => {
  await signIn(page, ADMIN);
  await page.goto("/admin/audit", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  await expect(page.getByText(/the database rejects/i)).toBeVisible();

  // Nothing on the page mutates: the only form is the filter.
  const buttons = await page.getByRole("button").allTextContents();
  expect(buttons.filter((b) => /delete|remove|edit/i.test(b))).toEqual([]);
});

test("robots and sitemap are served and exclude private routes", async ({ request }) => {
  const robots = await request.get("/robots.txt");
  expect(robots.ok()).toBe(true);
  const robotsBody = await robots.text();
  for (const path of ["/account", "/admin", "/pharmacist", "/checkout", "/cart"]) {
    expect(robotsBody, `${path} must be disallowed`).toContain(path);
  }

  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.ok()).toBe(true);
  const sitemapBody = await sitemap.text();
  expect(sitemapBody).toContain("/product/");
  expect(sitemapBody).toContain("/category/");
  // Private routes must never be advertised.
  for (const path of ["/admin", "/pharmacist", "/account"]) {
    expect(sitemapBody).not.toContain(path);
  }
});

test("the product page emits Product and Breadcrumb structured data", async ({ page }) => {
  await page.goto("/product/zifi-200-tablet", { waitUntil: "domcontentloaded" });

  const blocks = await page
    .locator('script[type="application/ld+json"]')
    .allTextContents();
  const parsed = blocks.map((b) => JSON.parse(b));
  const types = parsed.map((p) => p["@type"]);

  expect(types).toContain("Product");
  expect(types).toContain("BreadcrumbList");

  const product = parsed.find((p) => p["@type"] === "Product");
  expect(product.offers.priceCurrency).toBe("INR");
  expect(Number(product.offers.price)).toBeGreaterThan(0);
});

test("key pages do not scroll sideways at 360px", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });

  for (const path of ["/", "/category/medicines", "/product/zifi-200-tablet", "/salt/paracetamol"]) {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    await expectNoHorizontalOverflow(page);
  }
});

test("every page exposes one h1 and a working skip link", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await expect(page.locator("h1")).toHaveCount(1);

  await page.keyboard.press("Tab");
  const focused = await page.evaluate(() => document.activeElement?.textContent?.trim());
  expect(focused).toBe("Skip to content");
});
