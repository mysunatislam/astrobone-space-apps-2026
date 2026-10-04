import assert from "node:assert/strict";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {chromium} from "playwright";
const output = resolve(".artifacts/video-clips");
await mkdir(output,{recursive:true});
const browser = await chromium.launch({headless:true,args:["--use-angle=d3d11"]});
try {
  const page = await browser.newPage({viewport:{width:1440,height:1000}}), errors=[];
  page.on("pageerror",error=>errors.push(error.message));
  await page.goto("http://127.0.0.1:5180/#movement-capture");
  await page.waitForFunction(()=>document.querySelector("#twin-canvas")?.dataset.rigReady === "true");
  await page.locator("#detail-tracking").uncheck();
  const upload = async file => {
    const picker = page.waitForEvent("filechooser");
    await page.locator("#upload-video").click();
    await (await picker).setFiles(resolve(file));
    await page.waitForFunction(()=>["recording","error"].includes(document.querySelector("#camera-status").dataset.state),null,{timeout:180000});
    assert.equal(await page.locator("#camera-status").getAttribute("data-state"),"recording",await page.locator("#video-upload-feedback").textContent());
  };
  await upload(".artifacts/knee-video/squat-7s.mp4");
  assert.match(await page.locator("#video-clip-info").textContent(),/Observation: 6.5 s/);
  await page.waitForFunction(()=>document.querySelector("#camera-status").dataset.state === "ended",null,{timeout:30000});
  assert.equal(await page.locator("#export-movement-evidence").isEnabled(),true);
  const download = page.waitForEvent("download");
  await page.locator("#export-movement-evidence").click();
  const file = resolve(output,"seven-second-evidence.json"); await (await download).saveAs(file);
  const evidence = JSON.parse(await readFile(file,"utf8"));
  assert.equal(evidence.capture.quality.durationSeconds,6.5);
  assert.equal(evidence.capture.videoSegment.observationDurationSeconds,6.5);
  await page.locator("#video-play-pause").click();
  await page.waitForFunction(()=>document.querySelector("#camera-status").dataset.state === "recording");
  console.log("[clips] seven-second upload, assessment export, and replay passed");
  await page.locator("#toggle-camera").click();
  await page.locator("#video-precompute").uncheck();
  await upload(".artifacts/knee-video/squat-loop-135s.mp4");
  assert.match(await page.locator("#video-clip-info").textContent(),/Auto-trimmed: 0:00 - 2:00/);
  assert.equal(await page.locator("#video-scrub").getAttribute("max"),"120");
  await page.locator("#video-scrub").evaluate(el=>{el.value="119.5";el.dispatchEvent(new Event("input",{bubbles:true}));});
  await page.waitForFunction(()=>document.querySelector("#camera-status").dataset.state === "ended",null,{timeout:15000});
  const playback = await page.locator("#pose-video").evaluate(video=>({time:video.currentTime,duration:video.duration,paused:video.paused}));
  assert.equal(playback.paused,true); assert.equal(playback.time,120); assert.ok(playback.duration>120);
  for (const width of [1440,390]) {
    await page.setViewportSize({width,height:1000});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);
    await page.locator("#video-clip-info").scrollIntoViewIfNeeded();
    await page.screenshot({path:resolve(output,`trimmed-${width}.png`)});
  }
  await page.locator("#video-play-pause").click();
  await page.waitForFunction(()=>document.querySelector("#pose-video").currentTime<2 && !document.querySelector("#pose-video").paused);
  await page.locator("#toggle-camera").click();
  assert.equal(await page.locator("#video-clip-info").isHidden(),true);
  assert.deepEqual(errors,[]);
  const report={actualMediaPipe:true,sevenSecondObservation:6.5,longVideo:playback,errors};
  await writeFile(resolve(output,"report.json"),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
} finally {await browser.close();}
