import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { bodyPose } from "./fixtures/bodyPose.mjs";

const out = ".artifacts/ui-qa";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: process.env.ASTROBONE_QA_ANGLE ? [`--use-angle=${process.env.ASTROBONE_QA_ANGLE}`] : [] });
const results = [];
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const name = viewport.width > 700 ? "desktop" : "mobile";
    if (process.argv[3] && process.argv[3] !== name) continue;
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript({ content: `window.qaBodyPose = ${bodyPose.toString()};` });
    await page.addInitScript(() => {
      window.qaPoseKind = "neutral";
      const canvas = document.createElement("canvas");
      canvas.width = 640; canvas.height = 480;
      const ctx = canvas.getContext("2d");
      const draw = () => {
        ctx.fillStyle = "#111b21"; ctx.fillRect(0, 0, 640, 480);
        ctx.fillStyle = "#ffffff"; ctx.font = "18px sans-serif";
        ctx.fillText("SYNTHETIC CAMERA TEST", 16, 30);
        if (window.qaPoseKind === "lost") return;
        const pose = window.qaBodyPose(window.qaPoseKind);
        ctx.strokeStyle = "#6febc2"; ctx.lineWidth = 7;
        for (const [a, b] of [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28]]) {
          ctx.beginPath(); ctx.moveTo(pose[a].x*640,pose[a].y*480);
          ctx.lineTo(pose[b].x*640,pose[b].y*480); ctx.stroke();
        }
      };
      draw();
      setInterval(draw, 50);
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        configurable: true, value: async () => canvas.captureStream(20),
      });
      const NativeWorker = window.Worker;
      window.Worker = class extends EventTarget {
        constructor(url, options) {
          super();
          if (!String(url).includes("poseDetection.worker")) return new NativeWorker(url, options);
        }
        postMessage(message) {
          if (this.closed) return;
          if (message.type === "initialize") {
            queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", { data: { type: "ready" } })));
          }
          if (message.type === "frame") {
            message.bitmap.close();
            const poses = window.qaPoseKind === "lost" ? [] : [window.qaBodyPose(window.qaPoseKind)];
            setTimeout(() => this.dispatchEvent(new MessageEvent("message", { data: {
              type: "result", landmarks: poses, worldLandmarks: poses,
              cameraSessionId: message.cameraSessionId, timestamp: message.timestamp, inferenceMs: 5,
            } })), 5);
          }
        }
        terminate() { this.closed = true; }
      };
    });
    await page.goto(process.argv[2] || "http://127.0.0.1:5180/", { timeout: 60000 });
    await page.addStyleTag({ content: "*, *::before, *::after { scroll-behavior: auto !important; transition: none !important; animation: none !important; }" });
    await page.waitForFunction(() => document.querySelector("#twin-canvas")?.dataset.rigReady === "true", null, { timeout: 60000 });
    console.log(`[live-rig] ${name}: GLB ready`);
    assert.equal(await page.locator("#twin-canvas").getAttribute("data-surface"), "anatomical-rig");
    const framing = await page.evaluate(() => {
      const canvas = document.querySelector("#twin-canvas").getBoundingClientRect();
      const header = document.querySelector(".twin-pane-header--model").getBoundingClientRect();
      const toolbar = document.querySelector(".anatomy-toolbar").getBoundingClientRect();
      return { topClear: header.bottom <= canvas.top + 1, bottomClear: toolbar.top >= canvas.bottom - 1 };
    });
    assert.deepEqual(framing, { topClear: true, bottomClear: true }, "labels and layer controls must not overlap the mesh viewport");
    await page.locator("#object-awareness").evaluate((input) => { input.checked = false; input.dispatchEvent(new Event("change")); });
    await page.locator("#detail-tracking").uncheck();
    const start = page.locator("#toggle-camera");
    await start.scrollIntoViewIfNeeded();
    await start.click();
    const twin = page.locator("#twin-canvas");
    await twin.scrollIntoViewIfNeeded();
    try {
      await page.waitForFunction(() => document.querySelector("#twin-canvas")?.dataset.tracking === "live", null, { timeout: 30000 });
    } catch (error) {
      console.log(await page.locator("#camera-status").innerText(), await twin.getAttribute("data-tracking"));
      await page.screenshot({ path: `${out}/live-rig-${name}-startup-failure.png` });
      throw error;
    }
    console.log(`[live-rig] ${name}: camera packets linked`);
    const pixelSignature = () => page.evaluate(() => {
      const source = document.querySelector("#twin-canvas");
      const copy = document.createElement("canvas"); copy.width = 160; copy.height = 200;
      const ctx = copy.getContext("2d"); ctx.drawImage(source, 0, 0, 160, 200);
      const pixels = ctx.getImageData(0, 0, 160, 200).data;
      let bright = 0;
      for (let i=0;i<pixels.length;i+=4) if (pixels[i]+pixels[i+1]+pixels[i+2] > 300) bright++;
      return { bright, pixels: Array.from(pixels) };
    });
    await page.waitForTimeout(1600);
    const neutral = await pixelSignature();
    assert.ok(neutral.bright > 100, "rendered skeleton must be nonblank");
    await page.evaluate(() => { window.qaPoseKind = "left-up"; });
    await page.waitForFunction((before) => {
      const source = document.querySelector("#twin-canvas");
      if (source.dataset.tracking !== "live") return false;
      const copy = document.createElement("canvas"); copy.width = 160; copy.height = 200;
      const ctx = copy.getContext("2d"); ctx.drawImage(source, 0, 0, 160, 200);
      const pixels = ctx.getImageData(0, 0, 160, 200).data;
      let changed = 0;
      for (let i = 0; i < pixels.length; i++) if (Math.abs(pixels[i] - before[i]) > 20) changed++;
      return changed > 250;
    }, neutral.pixels, { timeout: 30000 });
    const raised = await pixelSignature();
    assert.ok(raised.pixels.filter((n,i) => Math.abs(n-neutral.pixels[i]) > 20).length > 250, "camera landmarks must move rendered GLB pixels");
    await twin.screenshot({ path: `${out}/live-rig-${name}-left-up.png` });
    await page.locator(".skeleton-view").screenshot({ path: `${out}/anatomical-rig-${name}.png` });
    await page.locator("#motion-muscles").uncheck();
    await page.waitForTimeout(200);
    await page.locator(".skeleton-view").screenshot({ path: `${out}/anatomical-bones-${name}.png` });
    assert.ok((await pixelSignature()).bright > 100, "bone layer must render independently");
    await page.locator("#motion-muscles").check();
    await page.locator("#motion-bones").uncheck();
    await page.waitForTimeout(200);
    await page.locator(".skeleton-view").screenshot({ path: `${out}/anatomical-muscles-${name}.png` });
    const musclePixels = await pixelSignature();
    console.log(`[live-rig] ${name}: muscle bright pixels ${musclePixels.bright}`);
    assert.ok(musclePixels.bright > 100, "muscle layer must render independently");
    await page.locator("#motion-bones").check();
    assert.match(await page.locator("#anatomical-coverage").textContent(), /body 16\/16/);
    for (const mirrored of [false, true]) {
      await page.locator("#mirror-preview").setChecked(mirrored);
      await twin.scrollIntoViewIfNeeded();
      await page.waitForFunction((value) => document.querySelector("#twin-canvas").dataset.mirrored === String(value), mirrored);
      const transforms = await page.evaluate(() => ["#pose-video", "#pose-overlay", "#twin-canvas"].map((selector) => {
        const transform = getComputedStyle(document.querySelector(selector)).transform;
        return transform === "none" ? 1 : new DOMMatrix(transform).a;
      }));
      assert.deepEqual(transforms, Array(3).fill(mirrored ? -1 : 1), "all three views must share one mirror convention");
    }
    await page.evaluate(() => { window.qaPoseKind = "upper-only"; });
    await page.waitForFunction(() => {
      const rig = document.querySelector("#twin-canvas");
      return rig.dataset.tracking === "partial" && Number(rig.dataset.trackedBones) > 0;
    });
    console.log(`[live-rig] ${name}: mirroring and partial-body passed`);
    await page.evaluate(() => { window.qaPoseKind = "lost"; });
    await page.waitForFunction(() => document.querySelector("#twin-canvas").dataset.tracking === "lost");
    await page.waitForTimeout(500);
    const held = await pixelSignature();
    await page.waitForTimeout(800);
    const heldLater = await pixelSignature();
    // Allow at most two channel levels of GPU raster rounding, not mesh motion.
    const holdPixelDelta = held.pixels.reduce((maximum, value, i) => Math.max(maximum, Math.abs(value-heldLater.pixels[i])), 0);
    assert.ok(holdPixelDelta <= 2, `tracking loss must hold the skeleton (maximum channel difference ${holdPixelDelta})`);
    await page.evaluate(() => { window.qaPoseKind = "right-up"; });
    await page.waitForFunction(() => document.querySelector("#twin-canvas").dataset.tracking === "live");
    await page.waitForTimeout(1500);
    await twin.screenshot({ path: `${out}/live-rig-${name}-right-up.png` });
    assert.deepEqual(errors, []);
    const result = { viewport, syntheticCamera: true, actualGlb: true, trackedBones: await twin.getAttribute("data-tracked-bones"), mirroredBothViews: true, partialBody: true, lossHeld: true, recovered: true };
    results.push(result);
    console.log(JSON.stringify(result));
    await page.close();
  }
  await writeFile(`${out}/live-rig-results.json`, JSON.stringify({ testedAt: new Date().toISOString(), results }, null, 2));
} finally { await browser.close(); }
