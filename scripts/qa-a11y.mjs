// WCAG 2.1 A/AA scan (axe-core) of every view at desktop and phone width: the seven experiences,
// the self-check's own-profile steps with the passcode form open, and lab.html.
// Usage: npx vite preview --base=/astrobone-space-apps-2026/ --port 5311, then
//   AXE_CORE=/path/to/axe-core/axe.min.js node scripts/qa-a11y.mjs [base-url]
// axe-core is not a dependency (npm install --no-save axe-core). Exits 1 on any violation.
// The headless flags are the ones this project uses for SwiftShader WebGL; CHROMIUM_PATH picks another browser build.
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const base = process.argv[2] || "http://127.0.0.1:5311/astrobone-space-apps-2026/";
const axe = readFileSync(process.env.AXE_CORE || "node_modules/axe-core/axe.min.js", "utf8");
const views = ["mission", "selfcheck", "twin", "functional", "impact", "physiology", "evidence"];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
let failures = 0;
async function scan(page, label) {
  await page.addScriptTag({ content: axe });
  const violations = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } }))
    .violations.map(v => `${v.id} (${v.impact}) ×${v.nodes.length}: ${v.nodes[0].target.join(" ")}`));
  failures += violations.length;
  console.log(`${label}: ${violations.length ? violations.join("; ") : "no violations"}`);
}
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    await page.goto(base, { waitUntil: "load", timeout: 90000 }); await page.waitForTimeout(5000);
    for (const view of views) { await page.evaluate(v => { location.hash = v; }, view); await page.waitForTimeout(1500); await scan(page, `${viewport.width}px #${view}`); }
    await page.evaluate(() => { location.hash = "selfcheck"; }); await page.waitForTimeout(800);
    await page.getByRole("button", { name: "You · this device" }).click();
    await page.locator(".sc-consent input").check();
    await page.getByRole("button", { name: "Add a passcode" }).click();
    await scan(page, `${viewport.width}px self-check, passcode form`);
    for (const step of ["2 Movement", "3 Reaction", "4 Sleep", "5 Body", "6 Result"]) {
      await page.getByRole("button", { name: new RegExp(step) }).click(); await page.waitForTimeout(500);
      await scan(page, `${viewport.width}px self-check ${step}`);
    }
    await page.close();
    const lab = await browser.newPage({ viewport });
    await lab.goto(`${base}lab.html`, { waitUntil: "load", timeout: 90000 }); await lab.waitForTimeout(4000);
    await scan(lab, `${viewport.width}px lab.html`);
    await lab.close();
  }
} finally { await browser.close(); }
console.log(failures ? `${failures} violation types found` : "No WCAG 2.1 A/AA violations");
process.exit(failures ? 1 : 0);
