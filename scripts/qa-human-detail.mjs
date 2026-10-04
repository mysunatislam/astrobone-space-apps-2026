import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const baseUrl = process.argv[2] || "http://127.0.0.1:5180/";
const samplePath = process.argv[3] || ".artifacts/mediapipe-woman-hands.jpg";
const sample = await readFile(samplePath);
const out = ".artifacts/ui-qa";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: process.env.ASTROBONE_QA_ANGLE ? [`--use-angle=${process.env.ASTROBONE_QA_ANGLE}`] : [] });
const results = [];
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const name = viewport.width > 700 ? "desktop" : "mobile";
    if (process.argv[4] && process.argv[4] !== name) continue;
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error" || message.text().includes("worker")) console.log(`[browser] ${message.text()}`); });
    await page.route("**/__qa-frame.jpg", (route) => route.fulfill({ contentType: "image/jpeg", body: sample }));
    await page.addInitScript(() => {
      window.qaDetailResults = [];
      window.qaDetailErrors = [];
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        constructor(url, options) {
          super(url, options);
          const detailWorker = String(url).includes("detailDetection.worker");
          this.addEventListener("message", ({ data }) => {
            if (data.type === "progress" || data.type === "error" || data.type === "ready") console.log(`${String(url).split("/").pop()}: ${data.label || data.error || data.type}`);
            if (!detailWorker) {
              if (data.type === "result") window.qaPoseVisibility = data.landmarks?.[0]?.map(({x, y, visibility, presence}) => ({x, y, visibility, presence}));
              return;
            }
            if (data.type === "error") window.qaDetailErrors.push(data.error);
            if (data.type === "result") {
              window.qaDetailResults.push({
                hands: data.hands.map((hand) => hand.landmarks.length),
                face: data.face?.landmarks.length || 0,
                blendshapes: data.face?.blendshapes,
                inferenceMs: data.inferenceMs,
              });
              if (window.qaDetailResults.length > 20) window.qaDetailResults.shift();
            }
          });
        }
      };
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        configurable: true,
        value: async () => {
          const img = new Image();
          img.src = "/__qa-frame.jpg";
          await img.decode();
          const canvas = document.createElement("canvas");
          canvas.width = 640; canvas.height = 960;
          const ctx = canvas.getContext("2d");
          const draw = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          draw();
          window.qaCameraTimer = setInterval(draw, 100);
          return canvas.captureStream(10);
        },
      });
    });
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => document.querySelector("#twin-canvas")?.dataset.rigReady === "true", null, { timeout: 60000 });
    await page.addStyleTag({ content: "* { scroll-behavior: auto !important; }" });
    await page.locator("#object-awareness").evaluate((input) => { input.checked = false; input.dispatchEvent(new Event("change")); });
    await page.locator("#toggle-camera").click();
    try {
      await page.waitForFunction(() => window.qaDetailErrors.length || window.qaDetailResults.filter((result) => result.hands.length === 2 && result.face === 478).length >= 3, null, { timeout: 120000 });
    } catch (error) {
      console.log(await page.evaluate(() => ({ camera: document.querySelector("#camera-status").textContent, warning: document.querySelector("#functional-warning").textContent, details: document.querySelector("#detail-status").textContent, results: window.qaDetailResults, errors: window.qaDetailErrors })));
      throw error;
    }
    assert.deepEqual(await page.evaluate(() => window.qaDetailErrors), []);
    const detection = await page.evaluate(() => window.qaDetailResults.findLast((result) => result.hands.length === 2 && result.face === 478));
    assert.deepEqual(detection.hands, [21, 21]);
    for (const name of ["eyeBlinkLeft", "eyeBlinkRight", "jawOpen"]) assert.ok(Number.isFinite(detection.blendshapes[name]));
    console.log(`[human-detail] ${name}: actual hand + face models returned landmarks`);
    const canvas = page.locator("#twin-canvas");
    await canvas.scrollIntoViewIfNeeded();
    await canvas.screenshot({ path: `${out}/human-detail-${name}-model.png` });
    await page.locator(".live-view").screenshot({ path: `${out}/human-detail-${name}-camera.png` });
    const pixels = await page.evaluate(() => {
      const canvas = document.createElement("canvas"); canvas.width = 160; canvas.height = 200;
      const ctx = canvas.getContext("2d"); ctx.drawImage(document.querySelector("#twin-canvas"), 0, 0, 160, 200);
      const data = ctx.getImageData(0, 0, 160, 200).data;
      let bright = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i] + data[i + 1] + data[i + 2] > 300) bright++;
      return bright;
    });
    assert.ok(pixels > 100, "human renderer must contain visible geometry");
    const readouts = await page.locator(".detail-analysis").innerText();
    assert.match(readouts, /Eyes open|Eyes closed/);
    await page.locator(".detail-analysis").screenshot({ path: `${out}/human-detail-${name}-readouts.png` });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    assert.equal(overflow, false, "viewport must not overflow horizontally");
    await page.locator("#toggle-camera").click();
    assert.equal(await page.locator("#detail-eyes").textContent(), "Not resolved");
    assert.deepEqual(errors, []);
    results.push({ viewport, realInference: true, sample: "Official MediaPipe woman_hands.jpg sample (static)", detection, visiblePixels: pixels, readouts });
    await page.close();
  }
  await writeFile(`${out}/human-detail-results.json`, JSON.stringify({ testedAt: new Date().toISOString(), results }, null, 2));
} finally {
  await browser.close();
}
