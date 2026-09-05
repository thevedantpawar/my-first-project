import { expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import zlib from "node:zlib";

export const SEED_PASSWORD = "Ashirwad@2026";
export const CUSTOMER = "customer@example.invalid";
export const PHARMACIST = "pharmacist@ashirwadwellness.in";
export const ADMIN = "admin@ashirwadwellness.in";

/**
 * Waits for a client-side route change.
 *
 * NOT `page.waitForURL`: the App Router navigates with `router.push`, which is
 * a soft navigation and fires no `load` event, so waitForURL's default
 * `waitUntil: "load"` hangs forever even though the URL has already changed.
 * Polling `location.pathname` is what actually works here.
 */
export async function waitForPath(
  page: Page,
  predicate: (pathname: string) => boolean,
  timeout = 30_000,
) {
  await page.waitForFunction(
    (src) => new Function("p", `return (${src})(p)`)(window.location.pathname),
    predicate.toString(),
    { timeout, polling: 200 },
  );
}

/**
 * Signs in and waits for the redirect away from /login.
 *
 * Waits before filling: these pages are server-rendered, and typing into an
 * input before React hydrates leaves the value invisible to the form.
 */
export async function signIn(page: Page, email: string) {
  await page.goto("/login", { waitUntil: "domcontentloaded" });

  // Already signed in? /login redirects, and there is no form to fill.
  if (!page.url().includes("/login")) return;

  await page.waitForSelector("input[name=email]", { timeout: 30_000 });

  await page.fill("input[name=email]", email);
  await page.fill("input[name=password]", SEED_PASSWORD);
  await page.click("button[type=submit]");

  // Generous, and deliberately not a retry loop: once the click lands the
  // button goes into its pending state, so a second click would just wait out
  // the action timeout on a disabled element and hide the real cause.
  // globalSetup pre-compiles this path, so in practice it resolves quickly.
  await waitForPath(page, (pathname) => !pathname.startsWith("/login"), 60_000);
}

/**
 * Clicks until the click actually does something.
 *
 * A server-rendered button is present and *enabled* long before React attaches
 * its handler, so waiting for "enabled" proves nothing — the click is simply
 * swallowed. There is no reliable hydration flag to wait on, so the honest
 * approach is to click, check whether the intended effect happened, and try
 * again if it did not.
 */
export async function clickUntilEffect(
  page: Page,
  click: () => Promise<void>,
  happened: () => Promise<boolean> | boolean,
  { attempts = 8, settleMs = 1_500 }: { attempts?: number; settleMs?: number } = {},
) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (await happened()) return;
    await click();

    const deadline = Date.now() + settleMs * 2;
    while (Date.now() < deadline) {
      await page.waitForTimeout(300);
      if (await happened()) return;
    }
  }

  throw new Error(`Click never took effect after ${attempts} attempts.`);
}

/** Waits for a named button to exist and not be disabled. */
export async function waitForEnabled(page: Page, pattern: string) {
  await page.waitForFunction(
    (src) => {
      const el = [...document.querySelectorAll("button")].find((b) =>
        new RegExp(src, "i").test(b.textContent ?? ""),
      );
      return !!el && !(el as HTMLButtonElement).disabled;
    },
    pattern,
    { timeout: 30_000 },
  );
}

/** A structurally valid PNG, generated rather than committed as a fixture. */
export function makePrescriptionImage(): string {
  const W = 480;
  const H = 300;
  const rows: Buffer[] = [];

  for (let y = 0; y < H; y++) {
    const row = Buffer.alloc(1 + W * 3, 250);
    row[0] = 0; // filter byte
    for (let x = 0; x < W; x++) {
      const dark =
        (y > 34 && y < 46 && x > 30 && x < 330) ||
        (y > 80 && y < 90 && x > 30 && x < 260) ||
        (y > 120 && y < 130 && x > 30 && x < 360) ||
        (y > 210 && y < 220 && x > 30 && x < 300);
      if (dark) {
        row[1 + x * 3] = 70;
        row[2 + x * 3] = 70;
        row[3 + x * 3] = 70;
      }
    }
    rows.push(row);
  }

  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour

  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);

  const dir = mkdtempSync(path.join(tmpdir(), "aw-e2e-"));
  const file = path.join(dir, "prescription.png");
  writeFileSync(file, png);
  return file;
}

/**
 * Runs SQL against the test database.
 *
 * Used only to arrange preconditions the UI cannot reach quickly (clearing a
 * customer's carts between specs, setting a pharmacist's registration number)
 * and to assert on rows the UI deliberately does not expose. No compliance
 * behaviour is *exercised* through here — that all goes through the app.
 */
export function sql(statement: string): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required for the e2e suite.");
  const bare = url.split("?")[0];
  return execFileSync("psql", [bare, "-tAc", statement], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/** Clears a customer's transient state so specs start from a known point. */
export function resetCustomerState(email: string) {
  sql(`
    DELETE FROM cart_items WHERE "cartId" IN (
      SELECT c.id FROM carts c JOIN users u ON u.id = c."userId" WHERE u.email = '${email}');
    DELETE FROM prescriptions WHERE "userId" IN (
      SELECT id FROM users WHERE email = '${email}')
      AND id NOT IN (SELECT "prescriptionId" FROM order_items WHERE "prescriptionId" IS NOT NULL);
  `);
}

export async function expectNoHorizontalOverflow(page: Page) {
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  expect(overflows, "page must not scroll horizontally").toBe(false);
}

/** Polls the database until the customer's cart holds at least `min` items. */
export async function waitForCartCount(email: string, min: number, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const count = Number(
      sql(`
        SELECT COALESCE(SUM(ci.quantity), 0) FROM cart_items ci
        JOIN carts c ON c.id = ci."cartId"
        JOIN users u ON u.id = c."userId"
        WHERE u.email = '${email}'
      `),
    );
    if (count >= min) return count;
    await new Promise((r) => setTimeout(r, 500));
  }

  throw new Error(`Cart for ${email} never reached ${min} item(s).`);
}

/**
 * Puts an item in the customer's cart and waits for it to actually land.
 *
 * Waiting on the effect rather than a fixed sleep: the first add-to-cart on a
 * cold dev server compiles the Server Action, which can outlast any sleep
 * short enough to keep the suite quick.
 */
export async function addToCartBySlug(page: Page, slug: string, email = CUSTOMER) {
  const cartCount = () =>
    Number(
      sql(`
        SELECT COALESCE(SUM(ci.quantity), 0) FROM cart_items ci
        JOIN carts c ON c.id = ci."cartId"
        JOIN users u ON u.id = c."userId"
        WHERE u.email = '${email}'
      `),
    );

  const before = cartCount();

  await page.goto(`/product/${slug}`, { waitUntil: "domcontentloaded" });
  await waitForEnabled(page, "add to cart");

  await clickUntilEffect(
    page,
    () => page.getByRole("button", { name: /add to cart/i }).click(),
    () => cartCount() > before,
  );
}

/**
 * Puts a non-prescription item in the customer's cart.
 *
 * Used by specs that need checkout reachable without the Rx gate being the
 * thing under test.
 */
export async function addOtcItemToCart(page: Page) {
  const slug = sql(`
    SELECT slug FROM products
    WHERE "requiresPrescription" = false AND "isActive" = true AND stock > 5
    ORDER BY "sellingPricePaise" ASC LIMIT 1
  `);
  await addToCartBySlug(page, slug);
}

/**
 * Drives a complete Schedule H1 order into PENDING_PHARMACIST_REVIEW.
 *
 * Every step goes through the running application — upload, pharmacist
 * verification, linking, and checkout — so the resulting order is one the Rx
 * gate genuinely let through, not a row inserted behind the app's back.
 *
 * Returns the order number.
 */
export async function placeH1OrderAwaitingReview(
  page: Page,
  browser: import("@playwright/test").Browser,
  h1Slug = "zifi-200-tablet",
): Promise<string> {
  sql(`UPDATE users SET "pharmacistRegNo" = 'MSPC-E2E-0001' WHERE email = '${PHARMACIST}'`);

  await signIn(page, CUSTOMER);

  await addToCartBySlug(page, h1Slug);

  await page.goto("/cart", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const prescriptionsBefore = Number(sql(`SELECT COUNT(*) FROM prescriptions`));
  await page.setInputFiles("input[type=file]", makePrescriptionImage());
  await waitForEnabled(page, "upload prescription");
  await clickUntilEffect(
    page,
    () => page.getByRole("button", { name: /upload prescription/i }).click(),
    () => Number(sql(`SELECT COUNT(*) FROM prescriptions`)) > prescriptionsBefore,
  );

  // Verify it in a separate context — sessions are per-context cookies.
  const pharmacistContext = await browser.newContext();
  const pharmacist = await pharmacistContext.newPage();
  await signIn(pharmacist, PHARMACIST);
  await pharmacist.goto("/pharmacist", { waitUntil: "domcontentloaded" });
  await pharmacist.waitForTimeout(1500);
  await pharmacist.getByRole("link", { name: /^Review$/ }).first().click();
  await waitForPath(pharmacist, (p) => p.startsWith("/pharmacist/prescriptions/"));
  await pharmacist.waitForTimeout(1500);
  await pharmacist.fill("input[name=doctorName]", "Dr R Kulkarni");
  await pharmacist.fill("input[name=doctorRegNo]", "MMC-2011-44821");
  await pharmacist.fill("input[name=validityDays]", "30");
  await pharmacist.fill("input[name=refillsAllowed]", "1");
  await pharmacist.getByRole("button", { name: /verify prescription/i }).click();
  await waitForPath(pharmacist, (p) => p === "/pharmacist");
  await pharmacistContext.close();

  // Attach and place the order.
  await page.goto("/cart", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);

  const linked = () =>
    Number(
      sql(`
        SELECT COUNT(*) FROM cart_items ci
        JOIN carts c ON c.id = ci."cartId"
        JOIN users u ON u.id = c."userId"
        WHERE u.email = '${CUSTOMER}' AND ci."prescriptionId" IS NOT NULL
      `),
    ) > 0;

  await clickUntilEffect(
    page,
    () => page.locator('select[id^="rx-"]').first().selectOption({ index: 1 }).then(() => {}),
    linked,
  );

  await page.goto("/checkout", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  await ensureAddress(page);

  await page.getByRole("button", { name: /place order/i }).click();
  await waitForPath(page, (p) => p.startsWith("/order/"), 45_000);

  return new URL(page.url()).pathname.split("/").pop()!;
}

/** Fills the checkout address form if no saved address is offered. */
export async function ensureAddress(page: Page) {
  const pincodeField = page.locator("input[name=pincode]");
  if ((await pincodeField.count()) === 0) return; // a saved address is selected

  await pincodeField.fill("422001");
  await pincodeField.blur();
  await page.waitForTimeout(2500);
  await page.fill("input[name=fullName]", "E2E Customer");
  await page.fill("input[name=phone]", "9876543210");
  await page.fill("input[name=line1]", "1 Gangapur Road");
  await page.getByRole("button", { name: /save address/i }).click();
  await page.waitForTimeout(3000);
}
