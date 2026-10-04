import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { chromium } from "playwright";

const input = resolve(process.argv[2] || ".artifacts/knee-video/squat-7s.mp4");
const output = resolve(process.argv[3] || ".artifacts/densepose-video");
await mkdir(output, {recursive:true});
const browser = await chromium.launch({headless:true,args:["--use-angle=d3d11"]});
try {
  const page = await browser.newPage({viewport:{width:1440,height:1000}}), errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("http://127.0.0.1:5180/#movement-capture", {timeout:60000});
  await page.waitForFunction(() => document.querySelector("#twin-canvas")?.dataset.rigReady === "true");
  await page.locator("#detail-tracking").uncheck();
  await page.locator("#video-precompute").uncheck();
  const chooser = page.waitForEvent("filechooser");
  await page.locator("#upload-video").click();
  await (await chooser).setFiles(input);
  await page.waitForFunction(() => document.querySelector("#camera-status").dataset.state === "recording", null, {timeout:90000});
  await page.locator("#pose-video").evaluate(video => {video.pause();video.currentTime=1.5;});
  await page.waitForFunction(() => !document.querySelector("#pose-video").seeking);
  await page.locator("#densepose-consent").check();
  const response = page.waitForResponse(res => res.url().endsWith(":8012/frame"), {timeout:180000});
  await page.locator("#densepose-start").click();
  const packet = await (await response).json();
  assert.equal(packet.status,"estimated"); assert.equal(packet.device,"cuda");
  assert.ok(packet.visible_parts.length>5);
  await page.waitForFunction(() => !document.querySelector(".densepose-overlay").hidden, null, {timeout:30000});
  assert.match(await page.locator(".densepose-frame-label").textContent(),/1.50 s/);
  const paintedPixels = await page.evaluate(async source => {
    const image=new Image();image.src=source;await image.decode();
    const canvas=document.createElement("canvas");canvas.width=image.width;canvas.height=image.height;
    const ctx=canvas.getContext("2d");ctx.drawImage(image,0,0);
    const rgba=ctx.getImageData(0,0,canvas.width,canvas.height).data;
    let count=0;
    for(let i=0;i<rgba.length;i+=4) if(rgba[i+3]>0 && Math.max(rgba[i],rgba[i+1],rgba[i+2])-Math.min(rgba[i],rgba[i+1],rgba[i+2])>30) count++;
    return count;
  },packet.overlay);
  assert.ok(paintedPixels>1000,"real DensePose overlay must contain colored surface pixels");
  await page.waitForTimeout(2000);
  assert.equal(await page.locator(".densepose-overlay").isVisible(),true,"paused exact-frame overlay persists");
  for(const width of [1440,390]) {
    await page.setViewportSize({width,height:1000});
    await page.locator("#pose-viewport").scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth>innerWidth+2),false);
    await page.locator("#pose-viewport").screenshot({path:resolve(output,`overlay-${width}.png`)});
  }
  const playbackFrames=[];
  let nextFrame=page.waitForResponse(res => res.url().endsWith(":8012/frame"), {timeout:60000});
  await page.locator("#pose-video").evaluate(video => video.play());
  for(let i=0;i<2;i++) {
    const frame=await (await nextFrame).json();
    assert.equal(frame.status,"estimated"); assert.equal(frame.device,"cuda");
    playbackFrames.push({inferenceMs:frame.inference_ms,visibleParts:frame.visible_parts.length});
    if(i===0) nextFrame=page.waitForResponse(res => res.url().endsWith(":8012/frame"), {timeout:60000});
  }
  await page.locator("#pose-video").evaluate(video => {video.pause();video.currentTime=4.5;});
  await page.waitForFunction(() => !document.querySelector("#pose-video").seeking);
  await page.waitForFunction(() => {
    const label=document.querySelector(".densepose-frame-label");
    return !label.hidden && label.textContent.includes("4.50 s");
  },null,{timeout:60000});
  await page.waitForTimeout(1800);
  assert.equal(await page.locator(".densepose-overlay").isVisible(),true,"seeked paused frame remains mapped");
  const status=await page.locator("#densepose-status").textContent();
  await page.locator("#densepose-consent").uncheck();
  assert.equal(await page.locator(".densepose-overlay").isVisible(),false);
  await page.locator("#toggle-camera").click();
  assert.deepEqual(errors,[]);
  const result={testedAt:new Date().toISOString(),inputName:input.split(/[\\/]/).at(-1),
    inputSha256:createHash("sha256").update(await readFile(input)).digest("hex"),
    actualVideo:true,actualCudaDensePose:true,visibleParts:packet.visible_parts.length,paintedPixels,status,pausedOverlay:true,playbackFrames,seekedFrameSeconds:4.5,errors};
  await writeFile(resolve(output,"report.json"),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
} finally {await browser.close();}
