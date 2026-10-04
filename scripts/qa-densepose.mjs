import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true, args: ["--use-angle=d3d11"] });
const results = [];
await mkdir(".artifacts/ui-qa", { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    const NativeWorker = Worker;
    window.Worker = class extends EventTarget {
      constructor(url, options) { super(); if (!String(url).includes("poseDetection.worker")) return new NativeWorker(url, options); }
      postMessage(message) {
        if (message.type === "initialize") queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", { data: { type: "ready" } })));
        if (message.type === "frame") {
          message.bitmap.close();
          queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", { data: { type: "result", landmarks: [], worldLandmarks: [], cameraSessionId: message.cameraSessionId, timestamp: message.timestamp, inferenceMs: 1 } })));
        }
      }
      terminate() {}
    };
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { configurable: true, value: async () => {
      const canvas = document.createElement("canvas"); canvas.width = 320; canvas.height = 240;
      const ctx = canvas.getContext("2d");
      const draw = () => { ctx.fillStyle = "#203030"; ctx.fillRect(0,0,320,240); ctx.fillStyle = "#b8ddd3"; ctx.fillRect(135,30,50,170); };
      draw(); const timer = setInterval(draw, 80); const stream = canvas.captureStream(12);
      stream.getTracks()[0].addEventListener("ended", () => clearInterval(timer)); return stream;
    } });
  });
  let requests = 0, frames = 0, inFlight = 0, maxInFlight = 0, responseDelay = 80;
  let output;
  await page.route("http://127.0.0.1:8012/**", async route => {
    requests++;
    if (route.request().url().endsWith("/initialize")) return route.fulfill({ json: { ready: true, retains_frames: false } });
    frames++; inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise(resolve => setTimeout(resolve, responseDelay));
    inFlight--;
    await route.fulfill({ json: output }).catch(() => {});
  });
  await page.goto(process.argv[2] || "http://127.0.0.1:5180/", { timeout: 60000 });
  await page.waitForSelector("#densepose-start");
  output = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 320; canvas.height = 240;
    const ctx = canvas.getContext("2d"); ctx.fillStyle = "rgba(200,60,140,.65)"; ctx.fillRect(135,30,50,170);
    return { status: "estimated", width: 320, height: 240, people: 1, device: "cuda", retains_frames: false,
      inference_ms: 30, detection_score: .91, visible_parts: [1, 2], overlay: canvas.toDataURL(), iuv: canvas.toDataURL() };
  });
  await page.locator("#densepose-start").click();
  assert.match(await page.locator("#densepose-status").textContent(), /Consent is required/);
  assert.equal(requests, 0, "no service requests before consent");
  await page.locator("#densepose-consent").check();
  await page.locator("#densepose-start").click();
  await page.locator("#toggle-camera").click();
  await page.waitForFunction(() => !document.querySelector(".densepose-overlay").hidden, null, { timeout: 30000 });
  assert.match(await page.locator(".densepose-frame-label").textContent(), /analyzed frame/);
  await page.locator("#pose-viewport").screenshot({ path: ".artifacts/ui-qa/densepose-camera.png" });
  responseDelay = 300;
  const beforeSeek = frames;
  await page.evaluate(() => document.querySelector("#pose-video").dispatchEvent(new Event("seeking")));
  await page.waitForFunction(() => !document.querySelector(".densepose-overlay").hidden);
  await page.waitForTimeout(800);
  assert.ok(frames > beforeSeek + 1, "source epoch change must not stall the loop");
  await page.locator("#video-precompute").uncheck();
  await page.evaluate(async () => {
    const canvas = document.createElement("canvas"); canvas.width = 320; canvas.height = 240;
    const ctx = canvas.getContext("2d"), stream = canvas.captureStream(12);
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8" });
    const chunks = [];
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    let x = 0;
    const draw = () => { ctx.fillStyle = "#303020"; ctx.fillRect(0,0,320,240); ctx.fillStyle = "#d7cba4"; ctx.fillRect(140 + Math.sin(x++) * 5,30,40,170); };
    draw(); const timer = setInterval(draw, 80);
    const stopped = new Promise(resolve => recorder.addEventListener("stop", resolve, { once: true }));
    recorder.start(); await new Promise(resolve => setTimeout(resolve, 10200)); recorder.stop(); await stopped;
    clearInterval(timer); stream.getTracks().forEach(track => track.stop());
    const transfer = new DataTransfer(); transfer.items.add(new File(chunks, "densepose-synthetic.webm", { type: "video/webm" }));
    const input = document.querySelector("#exercise-video-file"); input.files = transfer.files; input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForFunction(() => !document.querySelector(".densepose-frame-label").hidden && /[0-9]+[.][0-9]{2} s/.test(document.querySelector(".densepose-frame-label").textContent), null, { timeout: 30000 });
  await page.evaluate(() => document.querySelector("#pose-video").pause());
  await page.waitForTimeout(800);
  const pausedCount = frames;
  await page.waitForTimeout(600);
  assert.equal(frames, pausedCount, "paused video must not repeatedly infer the same frame");
  await page.waitForTimeout(1800);
  assert.equal(await page.locator(".densepose-overlay").isVisible(), true, "an unchanged paused video keeps its analyzed overlay");
  await page.evaluate(() => { document.querySelector("#pose-video").currentTime = 2; });
  await page.waitForFunction(() => !document.querySelector(".densepose-frame-label").hidden && document.querySelector(".densepose-frame-label").textContent.includes("2.00 s"));
  await page.locator("#pose-viewport").screenshot({ path: ".artifacts/ui-qa/densepose-uploaded-video.png" });
  await page.locator("#densepose-consent").uncheck();
  const afterStop = frames;
  await page.waitForTimeout(500);
  assert.equal(frames, afterStop, "withdrawal stops requests");
  assert.equal(await page.locator(".densepose-overlay").isVisible(), false);
  assert.equal(await page.locator("#densepose-export").isDisabled(), true);
  assert.equal(maxInFlight, 1, "at most one frame request in flight");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false);
    results.push({ width, consentBoundary: true, staleSourceRecovery: true, oneInFlight: true, pausedVideo: true, seek: true, testInput: "synthetic camera and uploaded WebM", service: "mocked, not accuracy validation" });
  }
  assert.deepEqual(errors, []);
  await writeFile(".artifacts/ui-qa/densepose-results.json", JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
} finally { await browser.close(); }
