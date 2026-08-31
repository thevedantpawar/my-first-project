import { chromium } from "playwright-core";

const B = "http://localhost:3100";
const launch = { executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--disable-background-networking","--no-sandbox"] };
const pages = ["/", "/systems", "/about", "/book", "/audit"];
const log = (...a) => { console.log(...a); };

const browser = await chromium.launch(launch);

// 1. Horizontal overflow at every breakpoint
log("\n== horizontal overflow ==");
for (const w of [390, 768, 1280, 1600]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
  const p = await ctx.newPage();
  for (const path of pages) {
    await p.goto(B + path, { waitUntil: "load" });
    const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (over > 0) log(`  FAIL ${w}px ${path}: overflows by ${over}px`);
  }
  await ctx.close();
  log(`  ${w}px: checked ${pages.length} pages`);
}

// 2. Hero fold on 390x844 — the hero CTA, not the header one
log("\n== 390px fold ==");
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  await p.goto(B + "/", { waitUntil: "load" });
  const r = await p.evaluate(() => {
    const h1 = document.querySelector("h1").getBoundingClientRect();
    const sub = document.querySelector("h1 ~ p").getBoundingClientRect();
    const cta = [...document.querySelectorAll('main [data-cta="book"]')][0].getBoundingClientRect();
    return { h1Bottom: Math.round(h1.bottom), subTop: Math.round(sub.top), ctaBottom: Math.round(cta.bottom), ctaHeight: Math.round(cta.height), vh: window.innerHeight };
  });
  log(" ", JSON.stringify(r), r.ctaBottom <= r.vh ? "PASS" : "FAIL");
  await ctx.close();
}

// 3. Tap targets >= 44px on mobile
log("\n== tap targets (390px) ==");
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  for (const path of pages) {
    await p.goto(B + path, { waitUntil: "load" });
    const small = await p.evaluate(() =>
      [...document.querySelectorAll("a, button, summary, input, select, textarea, label")]
        .filter((el) => el.offsetParent !== null)
        .map((el) => ({ t: el.tagName, x: el.textContent.trim().slice(0, 28), h: Math.round(el.getBoundingClientRect().height) }))
        .filter((el) => el.h > 0 && el.h < 44));
    if (small.length) log(`  ${path}:`, JSON.stringify(small));
  }
  log("  done");
  await ctx.close();
}

// 4. Keyboard traversal + visible focus ring
log("\n== keyboard focus ==");
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  for (const path of pages) {
    await p.goto(B + path, { waitUntil: "load" });
    const interactive = await p.evaluate(() => document.querySelectorAll('a[href], button, summary, input:not([tabindex="-1"]), textarea, select').length);
    let seen = 0, noRing = [];
    for (let i = 0; i < interactive + 6; i++) {
      await p.keyboard.press("Tab");
      const info = await p.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const s = getComputedStyle(el);
        return { tag: el.tagName, label: (el.textContent || el.name || "").trim().slice(0, 24), outline: s.outlineWidth + " " + s.outlineStyle };
      });
      if (!info) continue;
      seen++;
      if (info.outline.startsWith("0px") || info.outline.includes("none")) noRing.push(info.label || info.tag);
    }
    log(`  ${path}: reached ${seen} of ${interactive} interactive elements; no ring on: ${noRing.length ? noRing.join(", ") : "none"}`);
  }
  await ctx.close();
}

// 5. prefers-reduced-motion
log("\n== prefers-reduced-motion ==");
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  const p = await ctx.newPage();
  await p.goto(B + "/", { waitUntil: "load" });
  const r = await p.evaluate(() => {
    const els = [...document.querySelectorAll(".seq, .seq-rule, .seq-scale")];
    return {
      count: els.length,
      animated: els.filter((el) => getComputedStyle(el).animationName !== "none").length,
      allVisible: els.every((el) => Number(getComputedStyle(el).opacity) === 1),
    };
  });
  log(" ", JSON.stringify(r), r.animated === 0 && r.allVisible ? "PASS" : "FAIL");
  await ctx.close();
}

// 6. Audit form: invalid then valid
log("\n== audit form ==");
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const p = await ctx.newPage();
  await p.goto(B + "/audit", { waitUntil: "load" });
  await p.click('button[type="submit"]');
  await p.waitForTimeout(300);
  const errs = await p.$$eval("p.text-micron", (ns) => ns.map((n) => n.textContent.trim()));
  log("  empty submit ->", JSON.stringify(errs));

  await p.fill('input[name="name"]', "Jenna");
  await p.fill('input[name="clinic"]', "Clinic");
  await p.fill('input[name="email"]', "not-an-email");
  await p.check('input[name="leak"][value="No-shows"]');
  await p.click('button[type="submit"]');
  await p.waitForTimeout(300);
  log("  bad email ->", JSON.stringify(await p.$$eval("p.text-micron", (ns) => ns.map((n) => n.textContent.trim()))));

  await p.fill('input[name="email"]', "owner@example.com");
  await p.click('button[type="submit"]');
  await p.waitForSelector("text=Got it.", { timeout: 5000 });
  log("  valid submit -> success state shown PASS");
  await ctx.close();
}

// 7. Metadata per page
log("\n== metadata ==");
{
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  for (const path of pages) {
    await p.goto(B + path, { waitUntil: "load" });
    const m = await p.evaluate(() => ({
      title: document.title,
      desc: document.querySelector('meta[name="description"]')?.content?.length ?? 0,
      og: !!document.querySelector('meta[property="og:title"]'),
      ogImg: document.querySelector('meta[property="og:image"]')?.content?.split("/").pop() ?? null,
      ld: document.querySelectorAll('script[type="application/ld+json"]').length,
      h1: document.querySelectorAll("h1").length,
      landmarks: ["header","nav","main","footer"].filter((t) => document.querySelector(t)).join("+"),
    }));
    log(` ${path}`, JSON.stringify(m));
  }
  await ctx.close();
}

await browser.close();
