// Capture full-page screenshots of every route at the workbook's check widths.
// Usage: node scripts/ui-screenshots.mjs <base-url> <out-dir>
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const base = process.argv[2] || "http://127.0.0.1:3000";
const out = path.resolve(process.argv[3] || "screenshots");
const routes = [
  ["upload", "/"],
  ["runs", "/runs"],
  ["records", "/records"],
  ["approve", "/cms/approve"],
];
const widths = [1440, 900, 390];

await mkdir(out, { recursive: true });
const browser = await chromium.launch();
try {
  for (const width of widths) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    for (const [name, route] of routes) {
      await page.goto(base + route, { waitUntil: "networkidle" });
      await page.waitForTimeout(400);
      await page.screenshot({
        path: path.join(out, `${name}-${width}.png`),
        fullPage: true,
      });
    }
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(`Saved screenshots to ${out}`);
