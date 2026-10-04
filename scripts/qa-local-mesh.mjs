import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
// Browser rendering/consent QA replays actual inference output; not a live accuracy test.
const sample = await readFile(".artifacts/mediapipe-woman-hands.jpg");
const frame = JSON.parse(await readFile(".artifacts/vision-benchmark.frame.json", "utf8"));
assert.equal(frame.status, "estimated"); assert.ok(frame.vertices.length > 4000);
const browser = await chromium.launch({ headless: true, args: ["--use-angle=d3d11"] });
const results = [];
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport }), errors = []; let requests = 0;
    page.on("pageerror", e => errors.push(e.message));
    await page.route("**/__qa-frame.jpg", r => r.fulfill({ contentType: "image/jpeg", body: sample }));
    await page.route("http://127.0.0.1:8011/**", async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/frame") requests++;
      await route.fulfill({ json: path === "/initialize" ? { ready: true, mesh: "MHR LOD3" } : frame });
    });
    await page.addInitScript(() => {
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", { configurable: true, value: async () => {
        const img = new Image(); img.src = "/__qa-frame.jpg"; await img.decode();
        const canvas = document.createElement("canvas"); canvas.width = 426; canvas.height = 640;
        const ctx = canvas.getContext("2d"), draw = () => ctx.drawImage(img, 0, 0, 426, 640);
        draw(); setInterval(draw, 100); return canvas.captureStream(10);
      } });
    });
    await page.goto("http://127.0.0.1:5180/", { waitUntil: "domcontentloaded" });
    await page.addStyleTag({ content: "* { scroll-behavior: auto !important; }" });
    await page.waitForFunction(() => document.querySelector("#twin-canvas")?.dataset.rigReady === "true", null, { timeout: 60000 });
    await page.locator("#object-awareness").evaluate(input => { input.checked = false; input.dispatchEvent(new Event("change")); });
    await page.locator("#detail-tracking").uncheck();
    await page.locator("#mesh-start").click(); assert.equal(requests, 0);
    assert.match(await page.locator("#mesh-status").textContent(), /Consent/);
    await page.locator("#toggle-camera").click();
    await page.waitForFunction(() => !document.querySelector("#toggle-camera").disabled, null, { timeout: 60000 });
    await page.locator("#mesh-consent").check(); await page.locator("#mesh-start").click();
    await page.waitForFunction(() => document.querySelector(".twin-source-badge").textContent.includes("MHR"), null, { timeout: 60000 });
    await page.locator("#twin-canvas").scrollIntoViewIfNeeded(); await page.waitForTimeout(1200);
    // Read the composited WebGL screenshot; direct drawImage readback can be
    // empty on mobile ANGLE even while Chromium visibly renders the canvas.
    const rendered = await page.locator("#twin-canvas").screenshot();
    const pixels = await page.evaluate(async url => {
      const img = new Image(); img.src = url; await img.decode();
      const copy = document.createElement("canvas"); copy.width = img.width; copy.height = img.height;
      const ctx = copy.getContext("2d"); ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(24, 100, img.width - 48, img.height - 188).data;
      let count = 0; for (let i = 0; i < data.length; i += 4) if (data[i] + data[i + 1] + data[i + 2] > 300) count++;
      return count;
    }, `data:image/png;base64,${rendered.toString("base64")}`);
    const name = viewport.width > 700 ? "desktop" : "mobile";
    await page.locator(".skeleton-view").screenshot({ path: `.artifacts/ui-qa/mhr-${name}.png` });
    assert.ok(pixels > 150, `Mesh must render nonblank: ${pixels}; ${errors.join("; ")}; ${await page.locator("#mesh-status").textContent()}; ${await page.locator("#twin-canvas").getAttribute("data-mesh-frame")}`);
    await page.locator("#mirror-preview").evaluate(input => { input.checked = !input.checked; input.dispatchEvent(new Event("change")); });
    await page.waitForTimeout(1200);
    const mirrored = await page.locator("#twin-canvas").screenshot();
    assert.equal(rendered.equals(mirrored), false, "Mirror control must update the reconstructed view");
    await page.locator("#mesh-consent").uncheck(); const stoppedAt = requests; await page.waitForTimeout(1000);
    assert.equal(requests, stoppedAt); assert.match(await page.locator(".twin-source-badge").textContent(), /GLB/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []); results.push({ viewport, inferenceReplay: true, vertices: frame.vertices.length, pixels, mirrorUpdates: true, consentAndStop: true, errors });
    await page.close();
  }
  await writeFile(".artifacts/ui-qa/mhr-results.json", JSON.stringify(results, null, 2)); console.log(results);
} finally { await browser.close(); }
