import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { analyzePoseLandmarks } from "../src/functionalAssessment.js";
import { canRetargetSegment } from "../src/skeletalRetargeter.js";

const input = resolve(process.argv[2] || ".artifacts/knee-video/pose_squats.mp4");
const mode = process.argv[3] === "mobile" ? "mobile" : "desktop";
const viewport = mode === "mobile" ? {width:390,height:844} : {width:1440,height:1000};
const output = process.argv[4] || ".artifacts/knee-video";
await mkdir(output, {recursive:true});
const browser = await chromium.launch({headless:true,args:["--use-angle=d3d11"]});
const range = values => ({min:Math.min(...values),max:Math.max(...values),span:Math.max(...values)-Math.min(...values)});
try {
  const page = await browser.newPage({viewport}), errors = [];
  page.on("pageerror", error => errors.push(error.message));
  // Observe real worker outputs; inference and video input are never mocked.
  await page.addInitScript(() => {
    window.qaPackets = []; window.qaRendered = [];
    const Native = window.Worker;
    window.Worker = class extends Native {
      constructor(url, options) {
        super(url, options);
        if (String(url).includes("poseDetection.worker")) this.addEventListener("message", ({data}) => {
          if (data.type === "result") window.qaPackets.push(data);
        });
      }
    };
    setInterval(() => {
      const canvas = document.querySelector("#twin-canvas"), video = document.querySelector("#pose-video");
      if (!canvas || !video || video.paused || !Number.isFinite(video.duration)) return;
      if (!canvas.dataset.leftKneeFlexion && !canvas.dataset.rightKneeFlexion) return;
      window.qaRendered.push({time:video.currentTime, state:canvas.dataset.tracking,
        heading:canvas.dataset.bodyHeadingYaw ? Number(canvas.dataset.bodyHeadingYaw) : null,
        left:canvas.dataset.leftKneeFlexion ? Number(canvas.dataset.leftKneeFlexion) : null,
        right:canvas.dataset.rightKneeFlexion ? Number(canvas.dataset.rightKneeFlexion) : null});
    }, 50);
  });
  await page.goto("http://127.0.0.1:5180/#movement-capture", {timeout:60000});
  await page.waitForFunction(() => document.querySelector("#twin-canvas")?.dataset.rigReady === "true");
  await page.locator("#detail-tracking").uncheck();
  await page.locator("#video-precompute").check();
  const chooser = page.waitForEvent("filechooser");
  await page.locator("#upload-video").click();
  await (await chooser).setFiles(input);
  await page.locator("#twin-canvas").scrollIntoViewIfNeeded();
  await page.waitForFunction(() => ["recording", "error"].includes(document.querySelector("#camera-status")?.dataset.state), null, {timeout:180000});
  assert.equal(await page.locator("#camera-status").getAttribute("data-state"), "recording", await page.locator("#functional-warning").textContent());
  console.log(`[knee-video] ${mode}: actual video and MediaPipe ready`);
  await page.waitForFunction(() => document.querySelector("#camera-status")?.dataset.state === "ended", null, {timeout:130000});
  const {packets, rendered} = await page.evaluate(() => ({packets:window.qaPackets,rendered:window.qaRendered}));
  const source = packets.map(packet => {
    const image = packet.landmarks?.[0], world = structuredClone(packet.worldLandmarks?.[0]);
    if (!image || !world) return null;
    image.forEach((p,i) => { world[i].visibility = Math.min(world[i].visibility ?? 1,
      p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1 ? 0 : Math.min(p.visibility ?? 1,p.presence ?? 1)); });
    const frame = analyzePoseLandmarks(world,image,{timestamp:packet.timestamp,detected:true});
    return frame ? {time:packet.mediaTime,usable:frame.usable,
      left:canRetargetSegment(frame,"leftLeg") ? 180-frame.angles.left.knee : null,
      right:canRetargetSegment(frame,"rightLeg") ? 180-frame.angles.right.knee : null} : null;
  }).filter(Boolean);
  const summary = {};
  for (const side of ["left","right"]) {
    const measured = source.filter(row => Number.isFinite(row[side]));
    const shown = rendered.filter(row => Number.isFinite(row[side]));
    assert.ok(measured.length > 12 && shown.length > 12, `need multiple real ${side} knee samples`);
    const recovered = measured.filter(row => !row.usable).length;
    summary[side] = {poseInput:range(measured.map(row=>row[side])), renderedRig:range(shown.map(row=>row[side])),
      sourceFrames:measured.length, framesPreviouslyBlockedByAssessmentGate:recovered};
    assert.ok(summary[side].renderedRig.span > 20, `${side} 3D knee must visibly bend through the squat`);
  }
  const sorted = rendered.filter(row=>Number.isFinite(row.right)).sort((a,b)=>a.right-b.right);
  for (const [label,sample] of [["extended",sorted[0]],["bent",sorted.at(-1)]]) {
    await page.locator("#video-scrub").evaluate((slider, time) => {slider.value=String(time);slider.dispatchEvent(new Event("input",{bubbles:true}));},sample.time);
    await page.locator("#twin-canvas").scrollIntoViewIfNeeded();
    await page.waitForFunction(target => {
      const canvas = document.querySelector("#twin-canvas"), angle = canvas.dataset.rightKneeFlexion;
      return angle !== "" && Math.abs(Number(angle)-target) < 10;
    }, sample.right, {timeout:30000}).catch(async error => {
      console.log(JSON.stringify({label,target:sample,actual:await page.locator("#twin-canvas").evaluate(el=>({...el.dataset})),video:await page.locator("#pose-video").evaluate(el=>({currentTime:el.currentTime,paused:el.paused,ended:el.ended}))}));
      throw error;
    });
    await page.waitForTimeout(1100);
    assert.equal(await page.locator("#twin-canvas").getAttribute("data-tracking"),"paused","matched paused pose must not expire into tracking lost");
    assert.match(await page.locator("#anatomical-coverage").textContent(),/Paused video/);
    await page.locator(".skeleton-view").screenshot({path:`${output}/${mode}-${label}.png`});
  }
  assert.deepEqual(errors, []);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth+2), false);
  const headings=rendered.filter(row=>Number.isFinite(row.heading));
  assert.ok(headings.length>12,"need measured rig heading samples");
  const maximumHeadingStep=Math.max(0,...headings.slice(1).map((row,i)=>Math.abs(row.heading-headings[i].heading)));
  assert.ok(maximumHeadingStep<25,"no abrupt waist heading jump between rendered samples");
  const report = {testedAt:new Date().toISOString(),viewport,inputName:input.split(/[\\/]/).at(-1),
    inputSha256:createHash("sha256").update(await readFile(input)).digest("hex"),actualVideo:true,actualMediaPipe:true,
    sourceFrameCount:source.length,renderedSamples:rendered.length,knees:summary,
    waistHeadingDegrees:{...range(headings.map(row=>row.heading)),maximumSampleStep:maximumHeadingStep},pausedPosePersists:true,
    limitation:"Pipeline and retargeting verification on an unlabelled real video. Model pose estimates are not independent ground truth; this is not clinical or 3D accuracy validation."};
  await writeFile(`${output}/report-${mode}.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
} finally {await browser.close();}
