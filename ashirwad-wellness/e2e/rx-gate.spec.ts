import { test, expect } from "@playwright/test";

import {
  signIn,
  waitForPath,
  addToCartBySlug,
  clickUntilEffect,
  waitForEnabled,
  makePrescriptionImage,
  sql,
  resetCustomerState,
  CUSTOMER,
  PHARMACIST,
} from "./helpers";

/**
 * The Rx gate, through the browser.
 *
 * The unit suite already calls the enforcement path directly. These cover the
 * thing a unit test cannot: that the running application, over HTTP, refuses to
 * take money for a prescription medicine without a pharmacist-verified
 * prescription — and refuses it by more than hiding a button.
 */

const H1_PRODUCT = "/product/zifi-200-tablet";

test.beforeAll(() => {
  resetCustomerState(CUSTOMER);
});

test("a prescription medicine cannot reach checkout without a verified prescription", async ({
  page,
}) => {
  await signIn(page, CUSTOMER);

  await addToCartBySlug(page, H1_PRODUCT.replace("/product/", ""));

  await page.goto("/cart", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  // 1. The cart says why.
  await expect(page.getByText("Prescription needed before checkout")).toBeVisible();

  // 2. The button is disabled.
  const proceed = page.getByRole("link", { name: /proceed to checkout/i });
  await expect(proceed).toHaveAttribute("aria-disabled", "true");

  // 3. And the server refuses the route directly — this is the one that
  //    matters, because a disabled link is only a suggestion.
  await page.goto("/checkout", { waitUntil: "domcontentloaded" });
  expect(new URL(page.url()).pathname).toBe("/cart");
});

test("an unverified prescription does not satisfy the gate", async ({ page }) => {
  await signIn(page, CUSTOMER);

  // Arrange the cart here rather than inheriting it from the spec above.
  await addToCartBySlug(page, H1_PRODUCT.replace("/product/", ""));

  await page.goto("/cart", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);

  // Counted for THIS customer, and only what the upload can add. A global
  // `COUNT(*) > 0` was true before the first click, because prescriptions
  // pinned by order_items survive resetCustomerState by design — so the upload
  // never happened and the assertion below read an older, verified row.
  const ownPrescriptions = () =>
    Number(
      sql(`
        SELECT COUNT(*) FROM prescriptions p JOIN users u ON u.id = p."userId"
        WHERE u.email = '${CUSTOMER}'
      `),
    );
  const before = ownPrescriptions();

  await page.setInputFiles("input[type=file]", makePrescriptionImage());
  await waitForEnabled(page, "upload prescription");
  await clickUntilEffect(
    page,
    () => page.getByRole("button", { name: /upload prescription/i }).click(),
    () => ownPrescriptions() > before,
  );

  // Uploaded, but nobody has verified it yet.
  const status = sql(`
    SELECT p.status FROM prescriptions p JOIN users u ON u.id = p."userId"
    WHERE u.email = '${CUSTOMER}' ORDER BY p."uploadedAt" DESC LIMIT 1
  `);
  expect(status).toBe("UPLOADED");

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);

  // The picker must not offer THIS prescription, because the gate would refuse
  // it. Asserting an exact option list would instead be asserting that no other
  // verified prescription exists, which is a fact about the fixture rather than
  // about the gate.
  const offered = Number(
    sql(`
      SELECT COUNT(*) FROM prescriptions p
      JOIN users u ON u.id = p."userId"
      WHERE u.email = '${CUSTOMER}' AND p.status = 'VERIFIED'
        AND (p."validUntil" IS NULL OR p."validUntil" > now())
    `),
  );
  const options = await page.locator('select[id^="rx-"] option').allTextContents();
  expect(
    options.length,
    "the picker may only offer prescriptions the gate would accept",
  ).toBe(offered + 1); // +1 for the "Not attached yet" placeholder

  await expect(page.getByText("Prescription needed before checkout")).toBeVisible();
  await page.goto("/checkout", { waitUntil: "domcontentloaded" });
  expect(new URL(page.url()).pathname).toBe("/cart");
});

test("the gate opens once a pharmacist verifies, and the order is held for review", async ({
  page,
  browser,
}) => {
  // A pharmacist cannot verify without a registration number on file.
  sql(`
    UPDATE users SET "pharmacistRegNo" = 'MSPC-E2E-0001'
    WHERE email = '${PHARMACIST}'
  `);

  // Arrange the cart and prescription in this test rather than inheriting them
  // from the one above. An order-coupled spec passes only when the whole file
  // runs, and silently tests nothing when it does not.
  await signIn(page, CUSTOMER);
  await addToCartBySlug(page, H1_PRODUCT.replace("/product/", ""));

  await page.goto("/cart", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);

  const alreadyWaiting = Number(
    sql(`SELECT COUNT(*) FROM prescriptions WHERE status IN ('UPLOADED','UNDER_REVIEW')`),
  );
  if (alreadyWaiting === 0) {
    await page.setInputFiles("input[type=file]", makePrescriptionImage());
    await waitForEnabled(page, "upload prescription");
    await page.getByRole("button", { name: /upload prescription/i }).click();
    await page.waitForTimeout(3500);
  }

  // A SEPARATE browser context, not another page in the customer's context.
  // Sessions are cookies, and cookies are per-context — opening a second page
  // would sign the customer out and send /login straight back to the home page.
  const pharmacistContext = await browser.newContext();
  const pharmacist = await pharmacistContext.newPage();
  await signIn(pharmacist, PHARMACIST);
  await pharmacist.goto("/pharmacist", { waitUntil: "domcontentloaded" });
  await pharmacist.waitForTimeout(1500);

  await pharmacist.getByRole("link", { name: /^Review$/ }).first().click();
  await waitForPath(pharmacist, (p) => p.startsWith("/pharmacist/prescriptions/"));
  await pharmacist.waitForTimeout(2000);

  await pharmacist.fill("input[name=doctorName]", "Dr R Kulkarni");
  await pharmacist.fill("input[name=doctorRegNo]", "MMC-2011-44821");
  await pharmacist.fill("input[name=validityDays]", "30");
  await pharmacist.fill("input[name=refillsAllowed]", "1");
  await pharmacist.getByRole("button", { name: /verify prescription/i }).click();
  await waitForPath(pharmacist, (p) => p === "/pharmacist");
  await pharmacistContext.close();

  // Back to the customer — still signed in, because the pharmacist used a
  // different context.
  await page.goto("/cart", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);

  await clickUntilEffect(
    page,
    () => page.locator('select[id^="rx-"]').first().selectOption({ index: 1 }).then(() => {}),
    () =>
      Number(
        sql(`
          SELECT COUNT(*) FROM cart_items ci
          JOIN carts c ON c.id = ci."cartId"
          JOIN users u ON u.id = c."userId"
          WHERE u.email = '${CUSTOMER}' AND ci."prescriptionId" IS NOT NULL
        `),
      ) > 0,
  );

  await expect(page.getByText("Prescription needed before checkout")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: /proceed to checkout/i }),
  ).toHaveAttribute("aria-disabled", "false");

  await page.goto("/checkout", { waitUntil: "domcontentloaded" });
  expect(new URL(page.url()).pathname).toBe("/checkout");
});
