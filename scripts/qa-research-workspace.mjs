import assert from "node:assert/strict";
import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";
import { bodyPose } from "./fixtures/bodyPose.mjs";

const browser = await chromium.launch({ headless: true, args: ["--use-angle=d3d11"] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.addInitScript({ content: `window.qaBodyPose = ${bodyPose.toString()};` });
  await page.addInitScript(() => {
    const Native = window.Worker;
    window.Worker = class extends EventTarget {
      constructor(url, options) { super(); if (!String(url).includes("poseDetection.worker")) return new Native(url, options); }
      postMessage(message) {
        if (message.type === "initialize") { setTimeout(() => this.dispatchEvent(new MessageEvent("message", { data: { type: "ready" } })), 1); return; }
        if (message.type !== "frame") return;
        message.bitmap.close();
        const points = window.qaBodyPose(message.mediaTime < 5 ? "left-up" : "right-up");
        setTimeout(() => this.dispatchEvent(new MessageEvent("message", { data: { type: "result", landmarks: [points], worldLandmarks: [points], timestamp: message.timestamp, mediaTime: message.mediaTime, cameraSessionId: message.cameraSessionId, inferenceMs: 2 } })), 2);
      }
      terminate() {}
    };
  });
  await page.goto("http://127.0.0.1:5180/", { waitUntil: "domcontentloaded" });
  await page.addStyleTag({ content: "* { scroll-behavior: auto !important; }" });
  assert.equal(await page.locator("#detail-tracking").isChecked(), false);
  assert.equal(await page.locator("#object-awareness").isChecked(), false);
  assert.match(await page.locator("#engineering-check-status").textContent(), /12\/12/);
  const reference = { schema: "astrobone-reference-v1", metric: "heart_rate", unit: "bpm", synthetic: true, reference_device: "SYNTHETIC", protocol: "test-only", pairs: [{ id: "1", subject_id: "A", reference: 70, estimate: 72 }, { id: "2", subject_id: "A", reference: 80, estimate: 78 }, { id: "3", subject_id: "A", reference: 75, estimate: null }] };
  await page.locator("#reference-file").setInputFiles({ name: "reference.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(reference)) });
  await page.waitForFunction(() => document.querySelector("#reference-result").textContent.includes("MAE 2.00 bpm"));
  assert.match(await page.locator("#reference-result").textContent(), /66.7%/);
  await page.locator("#beam-force").fill("200"); await page.locator("#beam-force").dispatchEvent("input");
  assert.match(await page.locator("#beam-result").textContent(), /10.00 N m/);
  await page.locator("#engineering-validation").screenshot({ path: ".artifacts/ui-qa/engineering-desktop.png" });
  await page.evaluate(async () => {
    const canvas = document.createElement("canvas"); canvas.width = 320; canvas.height = 240;
    const ctx = canvas.getContext("2d"), stream = canvas.captureStream(12), chunks = [];
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8" });
    recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    let i = 0; const timer = setInterval(() => { ctx.fillStyle = "#182d27"; ctx.fillRect(0, 0, 320, 240); ctx.fillStyle = "white"; ctx.fillText(`SYNTHETIC timing fixture ${i++}`, 10, 80); }, 80);
    recorder.start(); await new Promise(r => setTimeout(r, 10500));
    const done = new Promise(r => recorder.addEventListener("stop", r, { once: true })); recorder.stop(); await done;
    clearInterval(timer); stream.getTracks().forEach(t => t.stop());
    const transfer = new DataTransfer(); transfer.items.add(new File(chunks, "timing-fixture.webm", { type: "video/webm" }));
    const input = document.querySelector("#exercise-video-file"); input.files = transfer.files; input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForFunction(() => ["recording", "error", "ended"].includes(document.querySelector("#camera-status").dataset.state), null, { timeout: 90000 }).catch(async error => {
    console.log(await page.locator("#camera-status").textContent(), errors);
    await page.screenshot({ path: ".artifacts/ui-qa/research-video-failure.png" }); throw error;
  });
  assert.equal(await page.locator("#camera-status").getAttribute("data-state"), "recording", `${await page.locator("#camera-status").textContent()}; ${await page.locator("#functional-warning").textContent()}; ${errors.join(";")}`);
  await page.locator("#video-play-pause").click();
  await page.locator("#video-scrub").fill("3"); await page.locator("#video-scrub").dispatchEvent("input");
  await page.locator("#twin-canvas").scrollIntoViewIfNeeded(); await page.waitForTimeout(350);
  const left = await page.locator("#twin-canvas").screenshot();
  await page.locator("#video-scrub").fill("7"); await page.locator("#video-scrub").dispatchEvent("input");
  await page.locator("#twin-canvas").scrollIntoViewIfNeeded(); await page.waitForTimeout(350);
  const right = await page.locator("#twin-canvas").screenshot();
  assert.equal(left.equals(right), false, "Seeking across cached left/right poses must change the actual GLB render");
  await page.locator(".simulation-shell").screenshot({ path: ".artifacts/ui-qa/research-video-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#engineering-validation").screenshot({ path: ".artifacts/ui-qa/engineering-mobile.png" });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  assert.deepEqual(errors, []);
  const result = { analyticalChecks: 12, referenceArithmetic: true, recordedVideo: true, syntheticPoseWorker: true, seekUpdatesActualGlb: true, lowLatencyDefaults: true, responsive: true, errors };
  await writeFile(".artifacts/ui-qa/research-workspace.json", JSON.stringify(result, null, 2)); console.log(result);
} finally { await browser.close(); }
