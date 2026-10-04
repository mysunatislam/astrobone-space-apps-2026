import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
const url = process.argv[2] || "http://127.0.0.1:5180/";
const out = ".artifacts/ui-qa"; await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--use-angle=d3d11"] });
const results = [];
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport }), errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.route("http://127.0.0.1:8010/**", r => r.abort());
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.querySelector("#twin-canvas")?.dataset.rigReady === "true", { timeout: 60000 });
    await page.locator('[data-layer="integrated"]').click();
    await page.waitForTimeout(1200);
    const pixels = await page.locator("#twin-canvas").evaluate(canvas => {
      const gl = canvas.getContext("webgl2"), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      const data = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, data);
      let visible = 0; for (let i = 0; i < data.length; i += 4) if (Math.max(data[i], data[i + 1], data[i + 2]) > 90) visible++;
      return visible;
    });
    assert.ok(pixels > 1000, `Blank 3D view: ${pixels}`);
    const size = viewport.width > 700 ? "desktop" : "mobile";
    await page.screenshot({ path: `${out}/multisystem-${size}-capture.png`, fullPage: true });
    await page.locator(".skeleton-view").screenshot({ path: `${out}/multisystem-${size}-layers.png` });
    await page.locator("#companion-tab").click();
    await page.waitForFunction(() => document.querySelector("#companion-service").textContent.includes("Browser-only"));
    await page.locator("#crew-demo").click();
    await page.waitForFunction(() => document.querySelectorAll("#health-comparison tr").length === 4);
    assert.match(await page.locator("#health-profile-status").textContent(), /SYNTHETIC/);
    assert.equal(await page.locator("#health-charts canvas").count(), 5);
    assert.equal(await page.locator("#health-entry").isVisible(), false);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(overflow, false);
    await page.screenshot({ path: `${out}/multisystem-${size}-review.png`, fullPage: true });
    assert.deepEqual(errors, []);
    results.push({ size, pixels, charts: 5, syntheticIsolated: true, noHorizontalOverflow: true, errors });
    await page.close();
  }
  await writeFile(`${out}/multisystem-results.json`, JSON.stringify(results, null, 2)); console.log(results);
} finally { await browser.close(); }
