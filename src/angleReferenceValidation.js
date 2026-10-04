import {evaluateReferencePairs} from "./engineeringValidation.js";

export const KNEE_DEFINITION="unsigned_hip_knee_ankle_flexion_deg";
const finite=value=>typeof value==="number" && Number.isFinite(value);
const text=value=>typeof value==="string" && value.trim().length>0;

export function evaluateTimedAngleReference(run,reference) {
  if(reference?.schema!=="astrobone-timed-angle-reference-v1" || reference.unit!=="deg" || reference.angleDefinition!==KNEE_DEFINITION)
    throw new Error("Reference schema, units, and three-point angle definition must match");
  if(!/^[a-f0-9]{64}$/.test(reference.videoSha256) || reference.videoSha256!==run?.sourceSha256)
    throw new Error("Reference does not match this exact video hash");
  if(reference.subjectId!==run.subjectId || !text(reference.subjectId) || !text(reference.trialId))
    throw new Error("Reference subject/trial identity is missing or mismatched");
  if(reference.independentFromPoseModel!==true || typeof reference.synthetic!=="boolean"
    || !text(reference.referenceDevice) || !text(reference.sourceUrl) || !text(reference.protocol))
    throw new Error("Independent reference provenance and synthetic declaration required");
  if(!["development","locked_test"].includes(reference.split)) throw new Error("Declare the reference split");
  const sync=reference.synchronization;
  if(!sync || !finite(sync.referenceMinusVideoSeconds) || !finite(sync.maxMatchDeltaSeconds)
    || sync.maxMatchDeltaSeconds<=0 || sync.maxMatchDeltaSeconds>.1 || sync.lockedBeforeEvaluation!==true || !text(sync.method))
    throw new Error("Explicit locked synchronization and a tolerance up to 0.1 seconds are required");
  if(!Array.isArray(run.rows) || !run.rows.length || !Array.isArray(reference.samples) || reference.samples.length<2)
    throw new Error("Prediction rows and at least two reference samples required");
  for(const rows of [run.rows,reference.samples]) rows.forEach((row,i)=>{
    if(!finite(row.timeSeconds) || (i>0 && row.timeSeconds<=rows[i-1].timeSeconds)) throw new Error("Sample times must be finite and strictly increasing");
    for(const side of ["left","right"]) {
      const value=row[`${side}KneeFlexionDeg`];
      if(value!==null && (!finite(value)||value<0||value>180)) throw new Error("Knee values must be 0-180 degrees or explicit null");
    }
  });
  const pairs={left:[],right:[]}, alignment=[];
  let cursor=0;
  for(const row of run.rows) {
    const target=row.timeSeconds+sync.referenceMinusVideoSeconds;
    while(cursor+1<reference.samples.length && reference.samples[cursor+1].timeSeconds<=target) cursor++;
    const candidates=[reference.samples[cursor],reference.samples[cursor+1]].filter(Boolean);
    const nearest=candidates.reduce((best,sample)=>Math.abs(sample.timeSeconds-target)<Math.abs(best.timeSeconds-target)?sample:best);
    const delta=Math.abs(nearest.timeSeconds-target), matched=delta<=sync.maxMatchDeltaSeconds;
    alignment.push({videoTimeSeconds:row.timeSeconds,referenceTimeSeconds:matched?nearest.timeSeconds:null,deltaSeconds:matched?delta:null});
    if(!matched) continue;
    for(const side of ["left","right"]) if(finite(nearest[`${side}KneeFlexionDeg`])) pairs[side].push({
      id:`${reference.trialId}:${side}:${row.timeSeconds}`,subject_id:reference.subjectId,
      reference:nearest[`${side}KneeFlexionDeg`],estimate:row[`${side}KneeFlexionDeg`]});
  }
  const channels={};
  for(const side of ["left","right"]) {
    const input={schema:"astrobone-reference-v1",metric:"knee_flexion",unit:"deg",synthetic:reference.synthetic,
      reference_device:reference.referenceDevice,protocol:reference.protocol,pairs:pairs[side]};
    const valid=pairs[side].filter(pair=>finite(pair.estimate)).length;
    channels[side]={referenceAvailableFrames:pairs[side].length,referenceCoverage:pairs[side].length/run.rows.length,
      predictionCoverage:pairs[side].length?valid/pairs[side].length:null,pairs:input,
      metrics:valid>=2?evaluateReferencePairs(input):null,status:valid>=2?"evaluated":"insufficient_pairs"};
  }
  return {schema:"astrobone-timed-angle-evaluation-v1",subjectId:reference.subjectId,trialId:reference.trialId,
    declaredSplit:reference.split,synthetic:reference.synthetic,videoSha256:reference.videoSha256,
    angleDefinition:KNEE_DEFINITION,synchronization:sync,plannedFrames:run.rows.length,
    matchedFrames:alignment.filter(row=>row.referenceTimeSeconds!==null).length,alignment,channels,
    limitation:"Reference provenance is declared, not independently audited. No time-offset fitting, per-test tuning, clinical approval, or population generalization. Samples from one recording are correlated."};
}
