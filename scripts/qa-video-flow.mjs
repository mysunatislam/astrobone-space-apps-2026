import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const url = process.argv[2] || "http://127.0.0.1:5180/";
const artifactDir = resolve(".artifacts", "ui-qa");
await mkdir(artifactDir, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--use-angle=d3d11"] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
  assert.equal(await page.locator("#upload-video").isVisible(), true);
  await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 240;
    const context = canvas.getContext("2d");
    const stream = canvas.captureStream(12);
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8" });
    const chunks = [];
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size) chunks.push(event.data);
    });
    let frame = 0;
    const draw = () => {
      context.fillStyle = "#111a18";
      context.fillRect(0, 0, 320, 240);
      context.fillStyle = "#d2e6d9";
      context.fillRect(140 + Math.round(6 * Math.sin(frame / 10)), 45, 40, 140);
      frame++;
    };
    draw();
    const timer = setInterval(draw, 70);
    const stopped = new Promise((resolve) => recorder.addEventListener("stop", resolve, { once: true }));
    recorder.start();
    await new Promise((resolve) => setTimeout(resolve, 11_200));
    recorder.stop();
    await stopped;
    clearInterval(timer);
    stream.getTracks().forEach((track) => track.stop());
    const file = new File(chunks, "synthetic-qa.webm", { type: "video/webm" });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const input = document.querySelector("#exercise-video-file");
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForFunction(() => ["recording", "error"].includes(document.querySelector("#camera-status")?.dataset.state), undefined, { timeout: 90_000 });
  assert.equal(await page.locator("#camera-status").getAttribute("data-state"), "recording", `${await page.locator("#camera-status").textContent()}; ${await page.locator("#functional-warning").textContent()}; ${errors.join(";")}`);
  assert.equal(await page.locator("#twin-feed-label").textContent(), "Local exercise video");
  assert.equal(await page.locator("#record-baseline").isDisabled(), true);
  assert.equal(await page.locator("#replay-video").isVisible(), true);
  await page.screenshot({ path: resolve(artifactDir, "video-assessment-desktop.png"), animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false);
  await page.screenshot({ path: resolve(artifactDir, "video-assessment-mobile.png"), animations: "disabled" });
  await page.waitForFunction(() => document.querySelector("#camera-status")?.dataset.state === "ended", undefined, { timeout: 30_000 });
  await page.locator("#replay-video").click();
  await page.waitForFunction(() => document.querySelector("#camera-status")?.dataset.state === "recording", undefined, { timeout: 10_000 });
  await page.locator("#toggle-camera").click();
  assert.equal(await page.locator("#toggle-camera").innerText(), "Start camera");
  assert.deepEqual(errors, []);
  console.log("[qa] local video, desktop/mobile layout, replay, and cleanup passed");
  await page.close();
} finally {
  await browser.close();
}
