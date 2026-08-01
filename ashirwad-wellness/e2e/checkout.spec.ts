import { test, expect } from "@playwright/test";

import {
  signIn,
  waitForPath,
  addOtcItemToCart,
  placeH1OrderAwaitingReview,
  sql,
  CUSTOMER,
  PHARMACIST,
} from "./helpers";

/**
 * Pincode serviceability, the COD ceiling, and the pharmacist approval flow
 * through to a Schedule H1 register entry.
 *
 * Each spec arranges its own preconditions. An earlier version skipped when the
 * database happened not to be in the right state, which meant three of the five
 * flows the build is meant to guarantee were quietly covering nothing.
 */

test("an unserviceable pincode is refused before the address is asked for", async ({
  page,
}) => {
  await signIn(page, CUSTOMER);

  // Clear saved addresses so the form is shown rather than a saved selection.
  sql(`
    DELETE FROM addresses WHERE "userId" IN (SELECT id FROM users WHERE email = '${CUSTOMER}')
      AND id NOT IN (SELECT "addressId" FROM orders)
  `);
  await addOtcItemToCart(page);

  await page.goto("/checkout", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  expect(new URL(page.url()).pathname).toBe("/checkout");

  const addNew = page.getByRole("button", { name: /add a new address/i });
  if (await addNew.isVisible().catch(() => false)) {
    await addNew.click();
    await page.waitForTimeout(800);
  }

  const pincode = page.locator("input[name=pincode]");

  // 400001 is Mumbai — a real pincode, deliberately not on the allow-list,
  // because dispensing is tied to the licensed premises in Nashik.
  await pincode.fill("400001");
  await pincode.blur();
  await page.waitForTimeout(2500);

  await expect(page.getByText(/do not deliver to this pincode/i)).toBeVisible();
  // The rest of the form stays disabled until serviceability passes.
  await expect(page.locator("input[name=fullName]")).toBeDisabled();

  await pincode.fill("422001");
  await pincode.blur();
  await page.waitForTimeout(2500);

  await expect(page.getByText(/Delivering to Nashik/i)).toBeVisible();
  await expect(page.locator("input[name=fullName]")).toBeEnabled();
});

test("cash on delivery is withdrawn above the ceiling", async ({ page }) => {
  const ceiling = Number(process.env.COD_CEILING_PAISE ?? 500_000);

  await signIn(page, CUSTOMER);

  sql(`
    DELETE FROM cart_items WHERE "cartId" IN (
      SELECT c.id FROM carts c JOIN users u ON u.id = c."userId" WHERE u.email = '${CUSTOMER}')
  `);

  const cartId = sql(`
    SELECT c.id FROM carts c JOIN users u ON u.id = c."userId" WHERE u.email = '${CUSTOMER}'
  `);
  const product = sql(`
    SELECT id || '|' || "sellingPricePaise" || '|' || "maxPerOrder"
    FROM products
    WHERE "requiresPrescription" = false AND "isActive" = true AND stock > 50
    ORDER BY "sellingPricePaise" DESC LIMIT 1
  `);
  const [productId, priceStr, maxStr] = product.split("|");
  const needed = Math.ceil((ceiling + 10_000) / Number(priceStr));

  if (needed > Number(maxStr)) {
    // Raise the per-order cap for this fixture only — the ceiling is what is
    // under test, not the cap.
    sql(`UPDATE products SET "maxPerOrder" = ${needed}, stock = ${needed + 10} WHERE id = '${productId}'`);
  }

  sql(`
    INSERT INTO cart_items (id, "cartId", "productId", quantity, "createdAt", "updatedAt")
    VALUES ('e2e-cod-item', '${cartId}', '${productId}', ${needed}, now(), now())
    ON CONFLICT ("cartId", "productId") DO UPDATE SET quantity = ${needed}
  `);

  await page.goto("/checkout", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);

  const codOption = page.locator("label", { hasText: "Cash on delivery" });
  await expect(codOption).toContainText(/available on orders up to/i);
  await expect(codOption.locator("input[type=radio]")).toBeDisabled();

  sql(`DELETE FROM cart_items WHERE id = 'e2e-cod-item'`);
});

test("pharmacist approval writes a Schedule H1 register entry", async ({
  page,
  browser,
}) => {
  // Arrange a real H1 order the Rx gate actually let through.
  const orderNumber = await placeH1OrderAwaitingReview(page, browser);

  const heldStatus = sql(`SELECT status FROM orders WHERE "orderNumber" = '${orderNumber}'`);
  expect(heldStatus).toBe("PENDING_PHARMACIST_REVIEW");

  const before = Number(sql("SELECT COUNT(*) FROM schedule_h1_register"));

  const pharmacistContext = await browser.newContext();
  const pharmacist = await pharmacistContext.newPage();
  await signIn(pharmacist, PHARMACIST);

  await pharmacist.goto("/pharmacist/orders", { waitUntil: "domcontentloaded" });
  await pharmacist.waitForTimeout(1500);

  // Target this order, not "the first Review link" — the queue may hold others.
  const row = pharmacist.locator("li", { hasText: orderNumber });
  await expect(row).toHaveCount(1);
  await row.getByRole("link", { name: /^Review$/ }).click();
  await waitForPath(pharmacist, (p) => /^\/pharmacist\/orders\/.+/.test(p));
  await pharmacist.waitForTimeout(2000);

  // Batch and expiry are mandatory before an H1 item can be dispensed.
  const batchInput = pharmacist.locator('input[list^="batches-"]');
  await expect(batchInput).toHaveCount(1);

  // The form's submit button, NOT the mode tab — both used to be called
  // "Approve for dispensing", so `.first()` silently clicked the tab and the
  // assertion below passed for the wrong reason.
  const submit = pharmacist.locator('form button[type="submit"]');

  await submit.click();
  await pharmacist.waitForTimeout(1000);
  expect(
    await pharmacist.locator("input:invalid").count(),
    "approval must be refused without batch and expiry",
  ).toBeGreaterThan(0);
  expect(
    sql(`SELECT status FROM orders WHERE "orderNumber" = '${orderNumber}'`),
    "the order must still be held after a refused approval",
  ).toBe("PENDING_PHARMACIST_REVIEW");

  await batchInput.fill("E2E-BATCH-01");
  await pharmacist.locator("input[type=date]").first().fill("2028-03-31");
  await submit.click();
  await waitForPath(pharmacist, (p) => p === "/pharmacist/orders", 45_000);
  await pharmacistContext.close();

  // Exactly one new register entry, carrying both registration numbers.
  const after = Number(sql("SELECT COUNT(*) FROM schedule_h1_register"));
  expect(after).toBe(before + 1);

  const entry = sql(`
    SELECT r."drugName" || '|' || r."batchNumber" || '|' || r."pharmacistRegNo" || '|' || r."prescriberRegNo"
    FROM schedule_h1_register r
    JOIN orders o ON o.id = r."orderId"
    WHERE o."orderNumber" = '${orderNumber}'
  `);
  expect(entry).toContain("E2E-BATCH-01");
  expect(entry).toContain("MSPC-E2E-0001");
  expect(entry).toContain("MMC-2011-44821");

  expect(sql(`SELECT status FROM orders WHERE "orderNumber" = '${orderNumber}'`)).toBe(
    "CONFIRMED",
  );

  // And the register refuses to be edited, even by the database owner.
  let refused = false;
  try {
    sql(`UPDATE schedule_h1_register SET quantity = 999 WHERE "serialNo" = (SELECT MAX("serialNo") FROM schedule_h1_register)`);
  } catch {
    refused = true;
  }
  expect(refused, "the register must reject UPDATE").toBe(true);
});
