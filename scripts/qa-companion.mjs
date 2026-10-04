import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const base = process.argv[2] || "http://127.0.0.1:5180";
const out = ".artifacts/ui-qa";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--use-angle=swiftshader"] });
const results = [];
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const name = viewport.width > 700 ? "desktop" : "mobile";
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${base}/#crew-companion`);
    await page.addStyleTag({ content: "*, *::before, *::after { scroll-behavior: auto !important; transition: none !important; animation: none !important; }" });
    await page.locator("#companion-service").filter({ hasText: /Local llama|Rules ready/ }).waitFor({ timeout: 20000 });
    await page.locator("#crew-demo").click();
    await page.locator(".companion-demo-badge").waitFor();
    const profileId = await page.locator("#crew-select").inputValue();
    await page.locator("#companion-use-llm").uncheck();
    await page.locator("#companion-run").click();
    await page.locator("#companion-result h4").waitFor({ timeout: 20000 });
    assert.match(await page.locator("#crew-comparison").innerText(), /-12\.1%/);
    assert.match(await page.locator("#companion-gates").innerText(), /not established/i);
    assert.ok(await page.locator("#companion-sources a").count() > 0);
    assert.equal(await page.locator("#companion-export").isEnabled(), true);
    const chart = await page.locator("#crew-timeline").evaluate(canvas => {
      const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      let painted = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i]) painted++;
      return painted;
    });
    assert.ok(chart > 1000, `Timeline is blank: ${chart}`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, "Page overflow");
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({ path: `${out}/companion-${name}.png`, fullPage: true });
    await page.screenshot({ path: `${out}/companion-${name}-viewport.png` });
    await page.locator("#companion-red-flag").check();
    await page.locator("#companion-run").click();
    await page.waitForFunction(() => document.querySelector("#companion-result h4")?.textContent === "human review now");
    assert.match(await page.locator("#companion-result").innerText(), /approved.*protocol|human/i);
    await page.locator("#crew-select").selectOption("");
    assert.equal(await page.locator("#companion-trace").innerText(), "Waiting for review");
    assert.match(await page.locator("#companion-gates").innerText(), /Not checked/);
    await page.locator("#twin-tab").click();
    await page.waitForFunction(() => document.querySelector("#twin-canvas")?.dataset.rigReady === "true", null, { timeout: 60000 });
    assert.equal(await page.locator(".workspace").isVisible(), true);
    await page.locator("#companion-tab").click();
    assert.equal(await page.locator("#crew-companion").isVisible(), true);
    assert.deepEqual(errors, []);
    await page.request.delete(`http://127.0.0.1:8010/api/companion/profiles/${profileId}`);
    results.push({ viewport: name, chartPaintedPixels: chart, profileIsolation: "pass", redFlagReview: "pass", errors });
    console.log(`[companion] ${name}: timeline, reports, gates, responsive layout and twin navigation passed`);
    await page.close();
  }
  await writeFile(`${out}/companion-results.json`, JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
