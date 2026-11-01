import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const base = process.argv[2] || "http://127.0.0.1:5173/";
const out = resolve(process.argv[3] || ".artifacts/respiratory-upgrade");
const screenshotsEnabled = process.env.ASTROBONE_QA_SCREENSHOTS !== "0";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: process.env.ASTROBONE_BROWSER || "chrome", headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const results = [];
async function capturePage(page, options) {
  if (!screenshotsEnabled) return;
  // A navigation and anchor scroll can leave a compositor frame queued while the
  // on-device model finishes loading. Capture the settled, static UI frame.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return page.screenshot({ animations: "disabled", scale: "css", ...options });
}
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const stage = name => console.log(`[${viewport.width}x${viewport.height}] ${name}`);
    stage("Load mission and verify branding");
    const context = await browser.newContext({ viewport, reducedMotion: "reduce", acceptDownloads: true });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(base, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.locator(".ab-breathing-cta").waitFor({ state: "visible" });
    await page.waitForFunction(() => !document.body.classList.contains("tw-booting"), null, { timeout: 45000 });
    const logo = page.locator(".ab-brand-logo");
    assert.equal(await logo.evaluate(img => img.complete && img.naturalWidth > 0), true);
    await capturePage(page, { path: `${out}/mission-${viewport.width}.png`, fullPage: viewport.width < 500 });
    stage("Open primary daily check and distinguish personal from synthetic profiles");
    await page.getByRole("link", { name: /Open daily self-check/ }).click();
    await page.locator('#twin-root[data-experience="selfcheck"]').waitFor();
    assert.match(await page.locator(".tw-drawer h2").textContent(), /Gather.*evaluate.*act/);
    assert.equal(await page.getByRole("button", { name: "Elena · synthetic demo", exact: true }).isVisible(), true);
    await page.getByRole("button", { name: "You · this device", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "You · this device", exact: true }).getAttribute("aria-pressed"), "true");
    assert.equal(await page.getByRole("combobox", { name: "Mission environment" }).locator("option").count(), 6);
    await page.locator('.tw-nav [data-experience="mission"]').click();
    stage("Browse NASA data and filter sources");
    await page.locator('[data-ab-action="evidence"]').click();
    await page.locator(".ab-expansion-study").first().waitFor({ state: "visible", timeout: 15000 });
    assert.equal(await page.locator(".ab-source-card").count(), 13);
    await page.locator("#ab-evidence-search").fill("Pulmonary");
    assert.equal(await page.locator(".ab-source-card").count(), 2);
    await capturePage(page, { path: `${out}/nasa-evidence-${viewport.width}.png` });
    await page.getByRole("button", { name: "Close NASA evidence" }).click();
    stage("Open respiratory capture and verify initial state");
    await page.locator(".ab-breathing-cta").click();
    await page.locator("#respiratory-monitor .resp-heading").waitFor({ state: "visible", timeout: 45000 });
    assert.equal(await page.locator('[data-resp="rate"]').textContent(), "—");
    assert.equal(await page.locator('[data-resp="save"]').isDisabled(), true);
    stage("Check synthetic estimate, history isolation, and export");
    await page.locator('[data-resp="demo"]').click();
    assert.ok(Math.abs(Number(await page.locator('[data-resp="rate"]').textContent()) - 15) < 0.6);
    assert.match(await page.locator('[data-resp="source"]').textContent(), /SYNTHETIC/);
    assert.equal(await page.locator('[data-resp="save"]').isDisabled(), true);
    assert.equal(await page.evaluate(() => localStorage.getItem("astrobone.respiratory.accepted.v1")), null);
    const downloadPromise = page.waitForEvent("download");
    await page.locator('[data-resp="export"]').click();
    const download = await downloadPromise;
    assert.match(download.suggestedFilename(), /synthetic-demo/);
    await download.saveAs(`${out}/synthetic-demo-${viewport.width}.json`);
    await page.locator("#respiratory-monitor").evaluate(element => {
      const header = document.querySelector(".lab-top"), offset = (header?.getBoundingClientRect().height || 76) + 16;
      window.scrollTo({ top: element.getBoundingClientRect().top + scrollY - offset, behavior: "instant" });
    });
    await capturePage(page, { path: `${out}/respiratory-${viewport.width}.png`, fullPage: false });
    stage("Reject invalid depth units");
    const depthFile = { schema: "astrobone-depth-respiratory-v1", units: "pixels", motionCompensated: true, samples: [] };
    await page.locator('[data-resp="depth"]').setInputFiles({ name: "invalid-depth.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(depthFile)) });
    await page.waitForFunction(() => document.querySelector('[data-resp="status"]').textContent.includes("Depth import rejected"));
    stage("Save an imported recording once and isolate crew history");
    // These artificial samples are marked nonsynthetic only to exercise the real
    // save gate in this disposable browser context, which never shares user storage.
    const profile = page.locator('[data-resp="profile"]');
    await profile.fill("qa-disposable-profile"); await profile.blur();
    const depthRecording = { schema: "astrobone-depth-respiratory-v1", units: "mm", motionCompensated: true, synthetic: false,
      samples: Array.from({ length: 451 }, (_, i) => ({ t: i * 100, chest: 1000 + 2 * Math.sin(2 * Math.PI * .25 * i / 10), abdomen: 1100 + 1.5 * Math.sin(2 * Math.PI * .25 * i / 10), motion: 0, visibility: 1 })) };
    const depthInput = { name: "disposable-qa-depth.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(depthRecording)) };
    await page.locator('[data-resp="depth"]').setInputFiles(depthInput);
    await page.waitForFunction(() => !document.querySelector('[data-resp="save"]').disabled);
    assert.ok(Math.abs(Number(await page.locator('[data-resp="rate"]').textContent()) - 15) < .6);
    await page.locator('[data-resp="save"]').click();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("astrobone.respiratory.accepted.v1")).length), 1);
    assert.match(await page.locator('[data-resp="baseline"]').textContent(), /Save 2 more usable RGB-D/);
    await page.locator('[data-resp="depth"]').setInputFiles(depthInput);
    await page.waitForFunction(() => document.querySelector('[data-resp="save"]').textContent === "Recording already saved");
    assert.equal(await page.locator('[data-resp="save"]').isDisabled(), true);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("astrobone.respiratory.accepted.v1")).length), 1);
    await profile.fill("qa-separate-profile"); await profile.blur();
    assert.match(await page.locator('[data-resp="baseline"]').textContent(), /Save 3 more usable RGB-D/);
    assert.equal(await page.locator('.resp-history-row').count(), 0);
    assert.match(await page.locator('[data-resp="history"]').textContent(), /No saved readings/);
    assert.equal(await page.locator('[data-resp="rate"]').textContent(), "—");
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("astrobone.respiratory.accepted.v1")).length), 1);
    stage("Verify reference comparison coverage and responsive layout");
    const ref = { schema: "astrobone-respiratory-validation-v1", reference: { instrument: "QA synthetic belt", clockOffsetMs: 0 }, synthetic: true, pairs: [0, 1].map((i) => ({ subjectId: "QA", captureId: `QA-${i}`, source: "webcam", startMs: i * 60000, endMs: i * 60000 + 45000, referenceStartMs: i * 60000, referenceEndMs: i * 60000 + 45000, referenceRate: 15, accepted: i === 0, estimatedRate: i === 0 ? 16 : null })) };
    await page.locator("[data-reference-file]").setInputFiles({ name: "synthetic-pairs.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(ref)) });
    await page.waitForFunction(() => document.querySelector("[data-reference-report]").textContent.includes("50% coverage"));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, "Horizontal overflow");
    assert.deepEqual(errors, [], "No browser exceptions");
    results.push({ viewport, passed: true, screenshotsEnabled, checks: ["branding", "daily health workflow", "personal and synthetic profiles", "mission environments", "NASA data", "search", "capture route", "synthetic isolation", "JSON export", "depth rejection", "depth duplicate prevention", "crew history isolation", "reference coverage", "responsive overflow", "browser exceptions"] });
    stage("All functional checks passed");
    await context.close();
  }
} finally { await browser.close(); }
await writeFile(`${out}/report.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
