import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
const out = process.argv[3] || process.env.ASTROBONE_QA_OUTPUT || ".artifacts/mission-intelligence-qa";
const url = (process.argv[2] || process.env.ASTROBONE_QA_BASE_URL || "http://127.0.0.1:5180/").split("#")[0] + "#mission-demo";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--use-angle=d3d11"] });
const results = [];
try {
  for (const viewport of [{ width: 1440, height: 1100 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport }), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(url, { waitUntil: "networkidle", timeout: 90000 });
    await page.waitForFunction(() => document.querySelector("#mi-human-canvas")?.dataset.ready === "true", null, { timeout: 90000 });
    await page.waitForFunction(() => document.querySelector("#mi-cache")?.dataset.ready === "true");
    assert.equal(await page.locator("#mi-day").innerText(), "147");
    assert.match(await page.locator("#mi-observation").innerText(), /165 to 151/);
    assert.match(await page.locator("#mi-gates").innerText(), /8\/8/);
    const canvas = page.locator("#mi-human-canvas");
    assert.equal(await canvas.evaluate(c => c.clientWidth >= c.parentElement.clientWidth - 2 && c.clientHeight >= c.parentElement.clientHeight - 2), true, "canvas must fill the viewer, not use default intrinsic dimensions");
    const signature = () => canvas.evaluate(source => {
      const copy = document.createElement("canvas"); copy.width = 200; copy.height = 300;
      const ctx = copy.getContext("2d"); ctx.drawImage(source, 0, 0, 200, 300);
      const data = Array.from(ctx.getImageData(0, 0, 200, 300).data), points = [];
      for (let i = 0; i < data.length; i += 4) if (data[i] + data[i+1] + data[i+2] > 300) points.push([i / 4 % 200, Math.floor(i / 800)]);
      return { data, bright: points.length, minY: Math.min(...points.map(p => p[1])), maxY: Math.max(...points.map(p => p[1])) };
    });
    await page.waitForTimeout(700); const first = await signature(); assert.ok(first.bright > 300);
    assert.ok(first.minY > 2 && first.maxY < 298, "full reference must fit");
    await page.screenshot({ path: `${out}/overview-${viewport.width}.png`, fullPage: true });
    await canvas.scrollIntoViewIfNeeded(); const box = await canvas.boundingBox();
    await page.mouse.move(box.x + box.width * .5, box.y + box.height * .5); await page.mouse.down(); await page.mouse.move(box.x + box.width * .65, box.y + box.height * .5, { steps: 8 }); await page.mouse.up();
    await page.waitForTimeout(200); const rotated = await signature(); assert.ok(rotated.data.filter((v, i) => Math.abs(v - first.data[i]) > 20).length > 500);
    for (const system of ["skeletal", "muscular", "cardiovascular", "radiation", "movement", "multisystem", "outer"]) {
      await page.locator(`.mi-layer-tabs [data-system="${system}"]`).click(); await page.waitForTimeout(system === "outer" ? 2500 : 650);
      assert.equal(await canvas.getAttribute("data-layer"), system); assert.ok((await signature()).bright > 100, `${system} nonblank`);
      if (system === "cardiovascular") await page.screenshot({ path: `${out}/cardiovascular-${viewport.width}.png`, fullPage: true });
    }
    await page.locator("#mi-reset").click();
    await page.locator("#mi-slider").fill("0"); assert.equal(await page.locator("#mi-day").innerText(), "1"); assert.match(await page.locator("#mi-verdict").innerText(), /baseline/);
    await page.locator("#mi-current").click(); await page.locator("#mi-why").click(); assert.equal(await page.locator(".mi-path li").count(), 7);
    assert.match(await page.locator("#mi-dialog-body").innerText(), /no LLM call/i); await page.screenshot({ path: `${out}/why-${viewport.width}.png` }); await page.locator("#mi-close").click();
    await page.locator("#mi-evidence").click(); await page.getByRole("button", { name: "OSD-575", exact: true }).click(); assert.match(await page.locator(".mi-node-detail").innerText(), /Human/);
    await page.screenshot({ path: `${out}/evidence-${viewport.width}.png` });
    await page.getByRole("button", { name: "Inspect external X-ray / MODEL OUTPUT" }).click(); assert.match(await page.locator("#mi-dialog-body").innerText(), /not live inference/);
    assert.equal(await page.locator("#mi-dialog-body img").evaluate(i => i.complete && i.naturalWidth > 0), true); await page.locator("#mi-close").click();
    await page.locator("#mi-origin").click(); assert.match(await page.locator("#mi-dialog-body").innerText(), /not authenticated/); assert.equal(await page.locator("#mi-dialog-body code").count(), 6); await page.locator("#mi-close").click();
    await page.locator("#mi-event").click(); assert.match(await page.locator('[data-domain="radiation"]').innerText(), /32.05 mGy/);
    await page.locator("#mi-handoff").click(); const downloadPromise = page.waitForEvent("download"); await page.locator("#mi-export").click(); const download = await downloadPromise;
    const report = JSON.parse(await readFile(await download.path(), "utf8")); assert.equal(report.dose, 22.05); assert.equal(report.doseWithEvent, 32.05); assert.equal(report.externalEvidence.xray.patientLinked, false); assert.equal(report.gates.length, 8);
    await page.locator("#mi-close").click(); await page.locator("#mi-lab").click(); await page.locator("#mi-low-quality").check(); await page.locator("#mi-no-sensor").check(); await page.locator("#mi-no-evidence").check();
    assert.match(await page.locator("#mi-dialog-body").innerText(), /INSUFFICIENT DATA/); await page.locator("#mi-close").click(); assert.match(await page.locator("#mi-observation").innerText(), /withheld/);
    await page.locator('[data-astra="evidence"]').click(); assert.match(await page.locator("#mi-astra-response").innerText(), /INSUFFICIENT EVIDENCE/);
    await page.locator("#mi-reset").click(); assert.equal(await page.locator("#mission-intelligence").getAttribute("data-lab"), "false"); assert.equal(await page.locator("#mi-event-marker").innerText(), ""); assert.match(await page.locator("#mi-gates").innerText(), /8\/8/);
    await page.locator("#mi-earth").click(); assert.match(await page.locator("#mi-mode").innerText(), /remote medical review pending/);
    await page.context().setOffline(true); await page.locator("#mi-current").click(); await page.locator("#mi-why").click(); assert.match(await page.locator("#mi-dialog-body").innerText(), /OSD-804/); await page.locator("#mi-close").click(); await page.context().setOffline(false);
    await page.keyboard.press("Shift+D"); assert.match(await page.locator("#mi-dialog-title").innerText(), /Presenter/); await page.locator("#mi-close").click();
    await page.locator("#mi-play").click(); await page.waitForTimeout(2000); assert.equal(await page.locator("#mi-day").innerText(), "30"); await page.locator("#mi-play").click();
    await page.locator("#mi-demo").click(); await page.waitForTimeout(200); await page.locator("#mi-demo").click(); await page.locator("#mi-reset").click();
    await page.waitForTimeout(800); const frameBefore = Number(await canvas.getAttribute("data-frames")); await page.waitForTimeout(700); assert.equal(Number(await canvas.getAttribute("data-frames")), frameBefore, "idle scene must not keep rendering");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false);
    const perf = await canvas.evaluate(c => ({ frames: Number(c.dataset.frames), drawCalls: Number(c.dataset.drawCalls), triangles: Number(c.dataset.triangles), derivationMs: Number(document.querySelector("#mission-intelligence").dataset.derivationMs) }));
    await page.locator("#mi-research").click(); assert.equal(await page.locator("#mission-intelligence").isVisible(), false); assert.equal(await page.locator("#crew-companion").isVisible(), true);
    await page.locator("#twin-tab").click(); assert.equal(await page.locator("#upload-video").isVisible(), true);
    assert.deepEqual(errors, []); results.push({ viewport, passed: true, brightPixels: first.bright, bodyYRange: [first.minY, first.maxY], performance: perf }); console.log(JSON.stringify(results.at(-1))); await page.close();
  }
} finally { await browser.close(); await writeFile(`${out}/report.json`, JSON.stringify(results, null, 2)); }
