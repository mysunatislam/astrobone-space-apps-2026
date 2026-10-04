import {readFile,writeFile,mkdir,readdir} from "node:fs/promises";
import {createHash} from "node:crypto";
import {resolve,dirname} from "node:path";
import os from "node:os";
import {chromium} from "playwright";
import {analyzePoseLandmarks} from "../src/functionalAssessment.js";
import {canRetargetSegment} from "../src/skeletalRetargeter.js";
import {VIDEO_POSE_HZ} from "../src/videoPoseTrack.js";
import {runEngineeringChecks} from "../src/engineeringValidation.js";
import {summarizeMotionRun,repeatedRunAgreement,evaluateMotionTargets} from "../src/motionValidation.js";

const planPath=resolve(process.argv[2] || "validation/motion-pilot-v1.json");
const planBytes=await readFile(planPath), plan=JSON.parse(planBytes);
if(plan.schema!=="astrobone-motion-pilot-v1" || plan.samplingHz!==VIDEO_POSE_HZ || plan.split!=="development")
  throw new Error("Unsupported protocol or sampling plan");
const digest=bytes=>createHash("sha256").update(bytes).digest("hex");
const stamp=new Date().toISOString().replace(/[:.]/g,"-");
const output=resolve(process.argv[3] || `.artifacts/validation/${stamp}`);
const requestedDelegate=process.env.ASTROBONE_POSE_DELEGATE || "AUTO";
if(!["AUTO","GPU","CPU"].includes(requestedDelegate)) throw new Error("Invalid ASTROBONE_POSE_DELEGATE");
await mkdir(dirname(output),{recursive:true});
await mkdir(output); // Never overwrite a frozen validation run.
const sourceHashes={};
for(const name of (await readdir("src")).filter(name=>name.endsWith(".js")).sort()) sourceHashes[`src/${name}`]=digest(await readFile(`src/${name}`));
for(const path of ["public/models/pose_landmarker_lite.task","package-lock.json","scripts/validate-motion.mjs"])
  sourceHashes[path]=digest(await readFile(path));
const clips=[];
for(const clip of plan.clips) {
  if(!/^[a-z0-9-]+$/.test(clip.id) || !Number.isInteger(clip.repeats) || clip.repeats<1 || clip.repeats>5) throw new Error("Invalid clip plan");
  clips.push({...clip,path:resolve(clip.path),sha256:digest(await readFile(resolve(clip.path)))});
}
await writeFile(resolve(output,"frozen-manifest.json"),JSON.stringify({frozenAt:new Date().toISOString(),plan,planSha256:digest(planBytes),
  requestedDelegate,sourceHashes,inputs:clips.map(({path,...clip})=>clip)},null,2));
const browser=await chromium.launch({headless:true,args:["--use-angle=d3d11"]});
const report={schema:"astrobone-motion-pilot-report-v1",startedAt:new Date().toISOString(),protocolId:plan.protocolId,
  planSha256:digest(planBytes),split:plan.split,accuracy:{status:"not_validated",reason:"No independent synchronized angle reference supplied"},
  environment:{os:`${os.platform()} ${os.release()}`,architecture:os.arch(),cpu:os.cpus()[0]?.model,logicalProcessors:os.cpus().length,
    node:process.version,browser:browser.version(),requestedDelegate,poseDelegates:[],poseModel:"MediaPipe Pose Landmarker Lite",samplingHz:VIDEO_POSE_HZ},
  engineering:runEngineeringChecks(),runs:[],repeatability:[],limitations:[
    "Two previously used development clips, not an independent or astronaut validation cohort.",
    "Synthetic stress variants share their source participant; they do not increase subject count.",
    "Prepared replay is not a live-camera latency benchmark; timings are uncached inference and capture-to-result during preparation.",
    "Knee values are unsigned three-point geometric flexion estimates, not independently measured clinical joint coordinates.",
    "No force, muscle activation, bone density, fracture-risk, rPPG accuracy, or clinical validation claim."]};

function toRows(packets,duration) {
  const count=Math.ceil((Math.min(duration,120)-.02)*VIDEO_POSE_HZ), byIndex=new Map();
  for(const packet of packets) {
    const index=Math.round(packet.mediaTime*VIDEO_POSE_HZ);
    if(index>=0 && index<count && !byIndex.has(index)) byIndex.set(index,packet);
  }
  return Array.from({length:count},(_,sampleIndex)=>{
    const packet=byIndex.get(sampleIndex), image=packet?.landmarks?.[0], world=structuredClone(packet?.worldLandmarks?.[0]);
    if(image&&world) image.forEach((p,i)=>{world[i].visibility=Math.min(world[i].visibility??1,
      p.x<0||p.x>1||p.y<0||p.y>1 ? 0 : Math.min(p.visibility??1,p.presence??1));});
    const frame=image&&world ? analyzePoseLandmarks(world,image,{timestamp:packet.timestamp,detected:true}) : null;
    const knee=side=>canRetargetSegment(frame,`${side}Leg`) && Number.isFinite(frame?.angles?.[side]?.knee) ? 180-frame.angles[side].knee : null;
    return {sampleIndex,timeSeconds:sampleIndex/VIDEO_POSE_HZ,received:Boolean(packet),detected:Boolean(image&&world),
      assessmentUsable:Boolean(frame?.usable),leftKneeFlexionDeg:knee("left"),rightKneeFlexionDeg:knee("right"),
      inferenceMs:packet?.inferenceMs??null,captureToResultMs:packet?.captureToResultMs??null,
      poseDelegate:packet?.runtime?.delegate??"unknown"};
  });
}

async function trial(clip,repeat) {
  const page=await browser.newPage({viewport:{width:1440,height:1000}}), errors=[];
  page.on("pageerror",error=>errors.push(error.message));
  await page.addInitScript(requestedDelegate=>{
    window.validationPackets=[]; window.validationWorker={};
    const Native=window.Worker;
    window.Worker=class extends Native {
      constructor(url,options) {
        super(url,options); this.poseWorker=String(url).includes("poseDetection.worker");
        if(this.poseWorker) this.addEventListener("message",({data})=>{
          if(data.type==="ready") {
            window.validationWorker.readyMs=performance.now()-window.validationWorker.startedAt;
            window.validationWorker.runtime=data.runtime;
          }
          if(data.type==="backend") window.validationWorker.runtime=data.runtime;
          if(data.type==="result") window.validationPackets.push({...data,captureToResultMs:performance.now()-data.timestamp});
        });
      }
      postMessage(...args) {
        if(this.poseWorker && args[0]?.type==="initialize") {
          window.validationWorker.startedAt=performance.now();
          args[0]={...args[0],delegate:requestedDelegate};
        }
        return super.postMessage(...args);
      }
    };
  },requestedDelegate);
  const started=performance.now();
  try {
    await page.goto("http://127.0.0.1:5180/#movement-capture",{timeout:60000});
    await page.waitForFunction(()=>document.querySelector("#twin-canvas")?.dataset.rigReady==="true",null,{timeout:60000});
    await page.locator("#detail-tracking").uncheck();
    await page.locator("#object-awareness").uncheck();
    await page.locator("#video-precompute").check();
    const chooser=page.waitForEvent("filechooser");
    await page.locator("#upload-video").click();
    const prepareStarted=performance.now();
    await (await chooser).setFiles(clip.path);
    await page.waitForFunction(()=>["recording","error"].includes(document.querySelector("#camera-status")?.dataset.state),null,{timeout:180000});
    if(await page.locator("#camera-status").getAttribute("data-state")==="error") throw new Error(await page.locator("#functional-warning").textContent());
    const data=await page.evaluate(()=>{
      const video=document.querySelector("#pose-video"); video.pause();
      return {packets:window.validationPackets,worker:window.validationWorker,duration:video.duration,width:video.videoWidth,height:video.videoHeight};
    });
    const rows=toRows(data.packets,data.duration), summary=summarizeMotionRun(rows,rows.length);
    const result={id:clip.id,repeat,subjectId:clip.subjectId,role:clip.role,sourceSha256:clip.sha256,
      poseRuntime:data.worker.runtime??null,poseDelegates:[...new Set(rows.filter(row=>row.received).map(row=>row.poseDelegate))],
      syntheticModification:clip.syntheticModification,sourceDurationSeconds:data.duration,resolution:[data.width,data.height],
      workerStartupMs:data.worker.readyMs??null,preparationWallMs:performance.now()-prepareStarted,totalRunWallMs:performance.now()-started,
      ...summary,checks:evaluateMotionTargets(summary,clip.role,plan.targets),pageErrors:errors,rows};
    if(errors.length) result.checks.push({name:"No browser errors",status:"fail",actual:errors.length,limit:0});
    await writeFile(resolve(output,`${clip.id}-run-${repeat}.json`),JSON.stringify(result,null,2));
    return result;
  } finally {await page.close();}
}

const value=x=>Number.isFinite(x)?x.toFixed(2):"not measured";
function markdown() {
  const lines=["# AstroBone Motion Validation Pilot","",`Protocol: ${report.protocolId}`,"",
    "**Measurement accuracy: NOT VALIDATED.** No independent reference angles were provided. This report measures engineering behavior on development videos.","",
    "## Measured Results","","| Clip / repeat | Backend | L knee coverage | R knee coverage | Inference p95 (ms) | Capture-to-result p95 (ms) | Checks |",
    "| --- | --- | ---: | ---: | ---: | ---: | --- |"];
  for(const r of report.runs) lines.push(r.error?`| ${r.id} / ${r.repeat} | -- | error | error | -- | -- | ERROR |`:
    `| ${r.id} / ${r.repeat} | ${r.poseDelegates.join(", ")} | ${value(r.left.coverage*100)}% | ${value(r.right.coverage*100)}% | ${value(r.inferenceMs.p95)} | ${value(r.captureToResultMs.p95)} | ${r.checks.every(c=>c.status==="pass")?"PASS":"FAIL / NOT MEASURED"} |`);
  lines.push("","## Same-Video Repeatability","","These are differences between reruns, not errors against ground truth.","");
  for(const r of report.repeatability) lines.push(`- ${r.id}: mean absolute difference L ${value(r.left?.absoluteDifferenceDeg.mean)} deg; R ${value(r.right?.absoluteDifferenceDeg.mean)} deg. ${r.status}.`);
  lines.push("","## Findings","");
  const failures=report.runs.flatMap(r=>r.error?[`${r.id}/${r.repeat}: ${r.error}`]:r.checks.filter(c=>c.status!=="pass").map(c=>`${r.id}/${r.repeat}: ${c.name}; ${c.status}; actual ${value(c.actual)}, target ${c.comparison} ${c.limit}.`));
  lines.push(...(failures.length?failures.map(text=>`- ${text}`):["- No failures against the predeclared engineering targets in these runs."]));
  lines.push("","## Analytical Verification","",`${report.engineering.filter(c=>c.passed).length}/${report.engineering.length} closed-form mechanics and geometric-angle checks passed. This is not tissue or physiological validation.`,"","## Limits","",...report.limitations.map(text=>`- ${text}`),"",
    "## Next Gate","","Obtain synchronized independent reference trajectories, fix angle definitions and time alignment on a development subset, then evaluate a subject-disjoint locked test subset. Keep all failures in coverage denominators. Do not use these development clips as a held-out accuracy test.");
  return lines.join("\n")+"\n";
}
try {
  for(const clip of clips) {
    const repeated=[];
    for(let repeat=1;repeat<=clip.repeats;repeat++) {
      console.log(`[validation] ${clip.id} ${repeat}/${clip.repeats}`);
      try {
        const result=await trial(clip,repeat); repeated.push(result);
        const {rows,...summary}=result; report.runs.push(summary);
        report.environment.poseDelegates=[...new Set(report.runs.flatMap(run=>run.poseDelegates??[]))];
        console.log(JSON.stringify({id:clip.id,repeat,leftCoverage:summary.left.coverage,rightCoverage:summary.right.coverage,inferenceP95Ms:summary.inferenceMs.p95,
          failed:summary.checks.filter(check=>check.status!=="pass").map(check=>check.name)}));
      } catch(error) {report.runs.push({id:clip.id,repeat,role:clip.role,error:error.message});console.log(`[validation] retained failure: ${error.message}`);}
      await writeFile(resolve(output,"report.json"),JSON.stringify(report,null,2));
    }
    if(clip.repeats>1) {
      const agreement=repeatedRunAgreement(repeated);
      const status=repeated.length!==clip.repeats?"incomplete":
        ["left","right"].every(side=>agreement[side]?.absoluteDifferenceDeg.mean!==null
          && agreement[side]?.absoluteDifferenceDeg.mean<=plan.targets.repeatabilityMeanDifferenceDeg
          && agreement[side]?.pairedCoverage>=plan.targets.baselineMinimumCoverage)?"pass":"fail";
      report.repeatability.push({id:clip.id,...agreement,status,targetMeanDifferenceDeg:plan.targets.repeatabilityMeanDifferenceDeg});
    }
  }
} finally {
  await browser.close(); report.completedAt=new Date().toISOString();
  await writeFile(resolve(output,"report.json"),JSON.stringify(report,null,2));
  await writeFile(resolve(output,"report.md"),markdown());
  console.log(`[validation] report: ${output}`);
}
