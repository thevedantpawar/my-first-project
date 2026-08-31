import { chromium } from "playwright-core";

const B = "http://localhost:3100";
const pages = ["/", "/systems", "/about", "/book", "/audit"];
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--disable-background-networking","--no-sandbox"] });
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
const p = await ctx.newPage();

const internal = new Set();
for (const path of pages) {
  await p.goto(B + path, { waitUntil: "load" });
  const els = await p.evaluate(() =>
    [...document.querySelectorAll("a, button")].map((el) => ({
      tag: el.tagName,
      text: (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 34),
      href: el.getAttribute("href"),
      type: el.getAttribute("type"),
      disabled: el.disabled ?? false,
    })));
  console.log(`\n== ${path} ==`);
  for (const e of els) {
    if (e.tag === "BUTTON") {
      console.log(`  BUTTON  "${e.text}"  type=${e.type} ${e.disabled ? "DISABLED" : "-> has handler"}`);
      continue;
    }
    if (!e.href) { console.log(`  ** ANCHOR WITH NO HREF: "${e.text}"`); continue; }
    if (e.href.startsWith("mailto:") || e.href.startsWith("tel:")) { console.log(`  mail    "${e.text}" -> ${e.href}`); continue; }
    if (e.href.startsWith("http")) { console.log(`  ext     "${e.text}" -> ${e.href}`); continue; }
    internal.add(e.href.split("#")[0] || "/");
    console.log(`  link    "${e.text}" -> ${e.href}`);
  }
}

console.log("\n== internal targets resolve ==");
for (const href of [...internal].sort()) {
  const r = await p.goto(B + href, { waitUntil: "load" });
  console.log(`  ${String(r.status()).padEnd(4)} ${href}`);
}
await b.close();
