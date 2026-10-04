import assert from "node:assert/strict";
import { mkdir,writeFile } from "node:fs/promises";
import { chromium } from "playwright";
const out=".artifacts/cardiovascular-research-qa"; await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,args:["--use-angle=d3d11"]}), results=[];
try {
  for(const viewport of [{width:1440,height:1100},{width:390,height:844}]) {
    const page=await browser.newPage({viewport}),errors=[]; page.on("pageerror",e=>errors.push(e.message));
    await page.goto("http://127.0.0.1:5180/#mission-demo",{waitUntil:"networkidle",timeout:90000});
    await page.waitForFunction(()=>document.querySelector("#mi-human-canvas")?.dataset.cardioReady==="true",null,{timeout:90000});
    await page.locator('.mi-layer-tabs [data-system="cardiovascular"]').click(); await page.waitForTimeout(800);
    const canvas=page.locator("#mi-human-canvas");
    const pixels=await canvas.evaluate(c=>{
      const t=document.createElement("canvas");t.width=200;t.height=300;const x=t.getContext("2d");x.drawImage(c,0,0,200,300);
      const data=x.getImageData(0,0,200,300).data;let color=0;for(let i=0;i<data.length;i+=4)if(Math.max(data[i],data[i+1],data[i+2])-Math.min(data[i],data[i+1],data[i+2])>35)color++;
      return color;
    });assert.ok(pixels>300,"cardiovascular anatomy must be visible");
    await page.screenshot({path:`${out}/anatomy-${viewport.width}.png`,fullPage:true});
    await page.locator("#mi-circulation").click(); await page.waitForSelector("#mi-model-rate");
    assert.match(await page.locator("#mi-dialog-body").innerText(),/Not calibrated/);
    await page.locator("#mi-model-rate").selectOption("90"); assert.match(await page.locator("#mi-model-verification").innerText(),/90 bpm/);
    await page.locator("#mi-cycle-phase").fill("60"); const paused=await page.locator("#mi-cycle-values").innerText();
    await page.locator("#mi-cycle-play").click(); await page.waitForTimeout(330); assert.notEqual(await page.locator("#mi-cycle-values").innerText(),paused);
    await page.locator("#mi-cycle-play").click(); const stopped=await page.locator("#mi-cycle-values").innerText(); await page.waitForTimeout(200);assert.equal(await page.locator("#mi-cycle-values").innerText(),stopped);
    await page.screenshot({path:`${out}/circulation-${viewport.width}.png`});await page.locator("#mi-close").click();
    await page.locator("#mi-nasa-data").click();const options=await page.locator("#mi-research-metric option").evaluateAll(ns=>ns.map(n=>n.value));
    assert.equal(new Set(options.map(v=>v.match(/^OSD-\d+/)[0])).size,5);
    await page.locator("#mi-research-metric").selectOption("OSD-569-hematocrit_value_percent");assert.match(await page.locator("#mi-dialog-body").innerText(),/28 source records.*4 participants/);
    await page.screenshot({path:`${out}/nasa-${viewport.width}.png`});
    await page.locator("#mi-research-metric").selectOption("OSD-656-vcam1_concentration_npq");assert.match(await page.locator("#mi-dialog-body").innerText(),/22 source records/);assert.match(await page.locator("#mi-dialog-body").innerText(),/NPQ/);
    assert.equal(await page.locator("#mi-dialog").evaluate(n=>n.scrollWidth>n.clientWidth+2),false);await page.locator("#mi-close").click();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);assert.deepEqual(errors,[]);
    results.push({viewport,passed:true,coloredAnatomyPixels:pixels,nasaDatasets:5});await page.close();
  }
  const page=await browser.newPage();
  await page.route("**/models/anatomy/cardiovascular.glb",route=>route.abort());
  await page.route("**/data/circulation-reference.json",route=>route.abort());
  await page.route("**/data/mission-research-extended.json",route=>route.abort());
  await page.goto("http://127.0.0.1:5180/#mission-demo",{waitUntil:"networkidle",timeout:90000});
  await page.waitForFunction(()=>document.querySelector("#mi-human-canvas")?.dataset.cardioReady==="false",null,{timeout:90000});
  await page.locator('.mi-layer-tabs [data-system="cardiovascular"]').click();
  assert.match(await page.locator("#mi-human-stage").innerText(),/atlas unavailable/);
  await page.locator("#mi-circulation").click();assert.match(await page.locator("#mi-dialog-body").innerText(),/simulation unavailable/);assert.equal(await page.locator("#mi-model-rate").count(),0);await page.locator("#mi-close").click();
  await page.locator("#mi-nasa-data").click();const options=await page.locator("#mi-research-metric option").evaluateAll(ns=>ns.map(n=>n.value));
  assert.equal(new Set(options.map(v=>v.match(/^OSD-\d+/)[0])).size,3);
  results.push({failureInjection:true,passed:true,remainingNasaDatasets:3});await page.close();
  const corrupted=await browser.newPage(), corruptErrors=[];corrupted.on("pageerror",e=>corruptErrors.push(e.message));
  const corruptions=[
    ["mission-research.json",data=>{data.cardiovascular.unit="pg/mL";}],
    ["mission-research-extended.json",data=>{data.studies[1].metrics[0].unit="ng/mL";}],
    ["circulation-reference.json",data=>{data.scenarios=[];}],
  ];
  for(const [file,change] of corruptions) await corrupted.route(`**/data/${file}`,async route=>{
    const response=await route.fetch(),data=await response.json();change(data);await route.fulfill({response,json:data});
  });
  await corrupted.goto("http://127.0.0.1:5180/#mission-demo",{waitUntil:"networkidle",timeout:90000});
  await corrupted.locator("#mi-origin").click();
  await corrupted.waitForFunction(()=>document.querySelectorAll('#mi-artifact-checks [data-status="withheld"]').length===3);
  assert.match(await corrupted.locator("#mi-artifact-checks").innerText(),/Unexpected serum units/);
  assert.match(await corrupted.locator("#mi-artifact-checks").innerText(),/Unknown assay field or unit/);
  assert.match(await corrupted.locator("#mi-artifact-checks").innerText(),/missing or invalid rows/);
  await corrupted.screenshot({path:`${out}/withheld-corrupt-artifacts.png`});await corrupted.locator("#mi-close").click();
  assert.equal(await corrupted.locator("#mi-cache").getAttribute("data-ready"),"false");
  await corrupted.locator("#mi-circulation").click();assert.match(await corrupted.locator("#mi-dialog-body").innerText(),/simulation unavailable/);assert.equal(await corrupted.locator("#mi-cycle-play").count(),0);await corrupted.locator("#mi-close").click();
  await corrupted.locator("#mi-handoff").click();
  assert.match(await corrupted.locator("#mi-dialog-body").innerText(),/WITHHELD \/ Prepared NASA sources/);
  assert.deepEqual(corruptErrors,[]);results.push({corruptArtifactInjection:true,passed:true,withheld:3});await corrupted.close();
} finally { await browser.close();await writeFile(`${out}/report.json`,JSON.stringify(results,null,2)); }
console.log(JSON.stringify(results));
