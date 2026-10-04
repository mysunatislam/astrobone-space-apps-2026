import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const baseUrl = process.argv[2] || "http://127.0.0.1:5180/";
const output = resolve(".artifacts/competition-qa");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.querySelector("#nasa-evidence-status")?.textContent.includes("170 records"));
    await page.waitForFunction(() => document.querySelector("#twin-canvas")?.dataset.rigReady === "true");
    if (viewport.width < 700) {
      const feed = await page.locator("#pose-viewport").boundingBox();
      assert.ok(feed.y < viewport.height, "Camera workspace must begin in the first mobile viewport");
    }
    assert.equal(await page.locator("#camera-status").textContent(), "Camera off");
    await page.locator("#open-mission-review").click();
    const dialog = page.locator("#mission-review-dialog");
    assert.equal(await dialog.evaluate((element) => element.open), true);
    assert.equal(await dialog.locator(".mission-check").count(), 5);
    assert.equal(await dialog.locator('[data-available="false"]').count(), 2);
    const box = await dialog.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= viewport.width + 1);
    assert.ok(box.y >= 0 && box.y + box.height <= viewport.height + 1);
    const screenshot = resolve(output, `mission-review-${viewport.width}.jpg`);
    await page.screenshot({ path: screenshot, type: "jpeg", quality: 70 });
    const downloadReady = page.waitForEvent("download");
    await page.locator("#review-export").click();
    const download = await downloadReady;
    const report = JSON.parse(await readFile(await download.path(), "utf8"));
    assert.equal(report.schemaVersion, "astrobone-competition-brief-v4");
    assert.equal(report.missionReview.competition.officialChallenge, null);
    assert.equal(report.missionReview.nasaProvenance.accession, "OSD-804");
    assert.match(report.missionReview.nasaProvenance.dataSha256, /^[a-f0-9]{64}$/);
    assert.equal(report.missionReview.unresolvedGates.length, 5);
    await page.keyboard.press("Escape");
    assert.equal(await dialog.evaluate((element) => element.open), false);
    assert.equal(await page.evaluate(() => document.activeElement.id), "open-mission-review");
    await page.locator('[data-workflow-stage="1"]').click();
    await page.locator("#save-scenario-reference").click();
    const before = await page.locator("#reference-dcr").textContent();
    await page.locator("#speed").evaluate((input) => {
      input.value = "2";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    assert.match(await page.locator("#comparison-delta").textContent(), /-50.0% modeled DCR/);
    assert.equal(await page.locator("#reference-dcr").textContent(), before);
    assert.match(await page.locator("#comparison-inputs").textContent(), /Speed: 4 to 2 m\/s/);
    await page.locator("#scenario-comparison").scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(output, `scenario-comparison-${viewport.width}.jpg`), type: "jpeg", quality: 70 });
    await page.locator("#clear-scenario-reference").click();
    assert.equal(await page.locator("#scenario-comparison").isHidden(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    assert.deepEqual(errors, []);
    results.push({ viewport, missionReview: "passed", export: "passed", comparison: "passed", screenshot, errors });
    await page.close();
  }
} finally {
  await browser.close();
}
await writeFile(resolve(output, "results.json"), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
