import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

await mkdir(".artifacts/ui-qa", { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--use-angle=d3d11"] });
const results = [];
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport }), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("http://127.0.0.1:5180/", { waitUntil: "domcontentloaded" });
    await page.addStyleTag({ content: "* { scroll-behavior: auto !important; }" });
    await page.locator("#anatomy-view-tab").click();
    await page.waitForFunction(() => document.querySelector("#atlas-canvas")?.dataset.ready === "true", null, { timeout: 120000 });
    assert.equal(await page.locator("#twin-view-grid").isVisible(), false);
    assert.equal(await page.locator("#atlas-bone-count").textContent(), "277");
    assert.equal(await page.locator("#atlas-muscle-count").textContent(), "683");
    const canvas = page.locator("#atlas-canvas");
    await canvas.scrollIntoViewIfNeeded(); await page.waitForTimeout(250);
    const full = await canvas.screenshot();
    const pixels = await page.evaluate(async url => {
      const img = new Image(); img.src = url; await img.decode();
      const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
      const ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, c.width, c.height).data; let visible = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i] + data[i+1] + data[i+2] > 230) visible++;
      return visible;
    }, `data:image/png;base64,${full.toString("base64")}`);
    assert.ok(pixels > 1000, `Atlas must be nonblank: ${pixels}`);
    const name = viewport.width > 700 ? "desktop" : "mobile";
    await page.locator("#anatomy-atlas").screenshot({ path: `.artifacts/ui-qa/anatomy-${name}.png` });
    await page.locator("#atlas-muscles").uncheck(); await canvas.scrollIntoViewIfNeeded();
    await page.waitForTimeout(150); const bones = await canvas.screenshot();
    assert.equal(bones.equals(full), false, "Muscle visibility must change the rendered atlas");
    await canvas.screenshot({ path: `.artifacts/ui-qa/anatomy-bones-${name}.png` });
    await page.locator("#atlas-search").fill("femur");
    const options = await page.locator("#atlas-structures option").allTextContents();
    assert.ok(options.includes("Femur (left)") && options.includes("Femur (right)"));
    await page.locator("#atlas-structures").selectOption({ label: "Femur (left)" });
    await page.locator("#atlas-focus").click(); await canvas.scrollIntoViewIfNeeded();
    await page.waitForTimeout(150); const focused = await canvas.screenshot();
    assert.equal(focused.equals(bones), false, "Focus must change the camera and highlight a structure");
    await page.locator("#atlas-reset").click();
    await page.locator("#atlas-muscles").check();
    await page.locator("#atlas-opacity").fill("0.25"); await page.locator("#atlas-opacity").dispatchEvent("input");
    await canvas.scrollIntoViewIfNeeded(); await page.waitForTimeout(150);
    const transparent = await canvas.screenshot(); assert.equal(transparent.equals(full), false);
    await page.locator("#atlas-wire").check(); await canvas.scrollIntoViewIfNeeded(); await page.waitForTimeout(150);
    assert.equal((await canvas.screenshot()).equals(transparent), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await page.locator("#motion-view-tab").click();
    assert.equal(await page.locator("#twin-view-grid").isVisible(), true);
    assert.deepEqual(errors, []);
    results.push({ viewport, structures: 960, nonblankPixels: pixels, layers: true, searchAndFocus: true, wire: true, opacity: true, errors });
    await page.close();
  }
  await writeFile(".artifacts/ui-qa/anatomy-results.json", JSON.stringify(results, null, 2));
  console.log(results);
} finally { await browser.close(); }
