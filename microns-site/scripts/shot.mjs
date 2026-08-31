import { chromium } from "playwright-core";
import fs from "node:fs";

const paths = process.argv[2]?.split(",") ?? ["/"];
const out = "/tmp/claude-0/-home-user-my-first-project/9365d613-5919-5685-afa5-486ddb753c4c/scratchpad/shots";
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--disable-background-networking","--no-sandbox"] });
for (const p of paths) {
  for (const [w, h, tag] of [[390, 844, "m"], [1280, 900, "d"]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.goto("http://localhost:3100" + p, { waitUntil: "load" });
    await page.waitForTimeout(2800);
    const name = (p === "/" ? "home" : p.replaceAll("/", "")) + "-" + tag;
    await page.screenshot({ path: `${out}/${name}.png`, fullPage: process.env.FULL === "1" });
    // fold check
    if (tag === "m") {
      const info = await page.evaluate(() => {
        const btn = document.querySelector('[data-cta="book"]:not([tabindex="-1"])');
        const r = btn?.getBoundingClientRect();
        return { bottom: r ? Math.round(r.bottom) : null, vh: window.innerHeight, scrollW: document.documentElement.scrollWidth };
      });
      console.log(name, JSON.stringify(info));
    }
    await ctx.close();
  }
}
await browser.close();
