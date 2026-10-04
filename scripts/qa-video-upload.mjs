import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const input = resolve(process.argv[2] || ".artifacts/knee-video/pose_squats.mp4");
const output = resolve(".artifacts/video-upload");
await mkdir(output, {recursive:true});
const browser = await chromium.launch({headless:true,args:["--use-angle=d3d11"]});
try {
  for (const [mode,viewport] of [["desktop",{width:1440,height:1000}],["mobile",{width:390,height:844}]]) {
    const page = await browser.newPage({viewport}), errors = [];
    page.on("pageerror", error=>errors.push(error.message));
    // Only the unanswered camera permission is simulated. Video decoding and pose inference are real.
    await page.addInitScript(()=>Object.defineProperty(navigator.mediaDevices,"getUserMedia",{value:()=>new Promise(()=>{})}));
    await page.goto("http://127.0.0.1:5180/#movement-capture", {timeout:60000});
    await page.waitForFunction(()=>document.querySelector("#twin-canvas")?.dataset.rigReady === "true");
    await page.locator("#detail-tracking").uncheck();
    const choose = async selector => {
      const picker = page.waitForEvent("filechooser", {timeout:5000});
      await page.locator(selector).click();
      return picker;
    };
    await choose("#upload-video");
    await page.locator("#toggle-camera").click();
    assert.equal(await page.locator("#camera-status").getAttribute("data-state"), "requesting");
    assert.equal(await page.locator("#upload-video").isEnabled(), true);
    await choose("#source-video");
    assert.equal(await page.locator("#camera-status").getAttribute("data-state"), "requesting", "cancelling the picker preserves the session");
    await (await choose("#upload-video")).setFiles({name:"unsupported.mov",mimeType:"video/quicktime",buffer:Buffer.from("unsupported")});
    assert.equal(await page.locator("#video-upload-feedback").isVisible(), true);
    assert.match(await page.locator("#video-upload-feedback").textContent(), /MP4 or WebM/);
    assert.equal(await page.locator("#camera-status").getAttribute("data-state"), "requesting");
    await page.locator("#video-upload-feedback").scrollIntoViewIfNeeded();
    await page.screenshot({path:resolve(output,`${mode}-error.png`)});
    await (await choose("#source-video")).setFiles(input);
    await page.waitForFunction(()=>document.querySelector("#camera-status")?.dataset.state === "preparing-video", null, {timeout:90000});
    assert.equal(await page.locator("#upload-video").isEnabled(), true);
    await page.locator("#video-precompute").uncheck();
    await (await choose("#upload-video")).setFiles(input);
    await page.waitForFunction(()=>document.querySelector("#camera-status")?.dataset.state === "recording", null, {timeout:90000});
    await page.waitForFunction(()=>document.querySelector("#pose-video").currentTime > .3);
    assert.equal(await page.locator("#video-upload-feedback").isHidden(), true);
    assert.equal(await page.locator("#twin-feed-label").textContent(), "Local exercise video");
    await choose("#source-video");
    assert.ok(await page.locator("#pose-video").evaluate(video=>!video.paused && video.currentTime > 0));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth > innerWidth+2), false);
    await page.locator(".live-view").scrollIntoViewIfNeeded();
    await page.screenshot({path:resolve(output,`${mode}-playing.png`)});
    await page.locator("#toggle-camera").click();
    assert.equal(await page.locator("#camera-status").getAttribute("data-state"), "off");
    assert.deepEqual(errors, []);
    console.log(`[video-upload] ${mode}: pickers, startup replacement, error recovery, preparation replacement, playback and cleanup passed`);
    await page.close();
  }
} finally { await browser.close(); }
