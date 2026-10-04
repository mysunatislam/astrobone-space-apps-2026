const finite = value => typeof value === "number" && Number.isFinite(value);

export function distribution(values) {
  const sorted=values.filter(finite).sort((a,b)=>a-b);
  if (!sorted.length) return {count:0,mean:null,p50:null,p95:null,max:null};
  const percentile=q => {
    const at=(sorted.length-1)*q, low=Math.floor(at), high=Math.ceil(at);
    return sorted[low]+(sorted[high]-sorted[low])*(at-low);
  };
  return {count:sorted.length,mean:sorted.reduce((a,b)=>a+b,0)/sorted.length,
    p50:percentile(.5),p95:percentile(.95),max:sorted.at(-1)};
}

export function summarizeMotionRun(rows, expectedFrames) {
  if (!Number.isInteger(expectedFrames) || expectedFrames<1 || rows.length!==expectedFrames)
    throw new Error("Every planned sample, including missing frames, must be retained");
  if (new Set(rows.map(row=>row.sampleIndex)).size!==rows.length) throw new Error("Duplicate sample index");
  const count=predicate=>rows.filter(predicate).length;
  const summarizeSide=side=>{
    const key=`${side}KneeFlexionDeg`, values=rows.map(row=>row[key]).filter(finite);
    return {usableFrames:values.length,coverage:values.length/expectedFrames,
      rangeDeg:values.length ? {min:Math.min(...values),max:Math.max(...values)} : null};
  };
  return {expectedFrames,receivedFrames:count(row=>row.received),detectedFrames:count(row=>row.detected),
    detectionCoverage:count(row=>row.detected)/expectedFrames,
    fullAssessmentCoverage:count(row=>row.assessmentUsable)/expectedFrames,
    left:summarizeSide("left"),right:summarizeSide("right"),
    inferenceMs:distribution(rows.map(row=>row.inferenceMs)),
    captureToResultMs:distribution(rows.map(row=>row.captureToResultMs))};
}

export function repeatedRunAgreement(runs) {
  if (runs.length<2) return {status:"not_measured",reason:"At least two repeated runs required"};
  const differences={left:[],right:[]}; let plannedPairs=0;
  for(let i=0;i<runs.length;i++) for(let j=i+1;j<runs.length;j++) {
    const a=runs[i], b=runs[j];
    if(a.sourceSha256!==b.sourceSha256 || a.rows.length!==b.rows.length) throw new Error("Repeated runs must use the same source and sampling plan");
    for(let k=0;k<a.rows.length;k++) {
      if(a.rows[k].sampleIndex!==b.rows[k].sampleIndex || Math.abs(a.rows[k].timeSeconds-b.rows[k].timeSeconds)>1e-6)
        throw new Error("Repeated runs are not time aligned");
      plannedPairs++;
      for(const side of ["left","right"]) {
        const key=`${side}KneeFlexionDeg`, x=a.rows[k][key], y=b.rows[k][key];
        if(finite(x)&&finite(y)) differences[side].push(Math.abs(x-y));
      }
    }
  }
  return {status:"measured",runs:runs.length,plannedPairs,
    ...Object.fromEntries(["left","right"].map(side=>[side,{absoluteDifferenceDeg:distribution(differences[side]),pairedCoverage:differences[side].length/plannedPairs}])),
    limitation:"Same-video repeatability, not accuracy, independent participants, or clinical confidence intervals."};
}

export function evaluateMotionTargets(summary, role, targets) {
  const check=(name,actual,limit,mode)=>({name,actual,limit,comparison:mode,
    status:!finite(actual)?"not_measured":(mode==="minimum"?actual>=limit:actual<=limit)?"pass":"fail"});
  if(role==="blank") return [check("No detected person in blank frames",summary.detectionCoverage,0,"maximum")];
  if(role==="occluded_legs") return ["left","right"].map(side=>check(`${side} knee withheld under occlusion`,summary[side].coverage,targets.occludedLegMaximumCoverage,"maximum"));
  const checks=[check("Inference p95 budget",summary.inferenceMs.p95,targets.inferenceP95Ms,"maximum"),
    check("Capture-to-result p95 budget",summary.captureToResultMs.p95,targets.captureToResultP95Ms,"maximum")];
  if(role==="baseline") checks.push(...["left","right"].map(side=>check(`${side} knee coverage`,summary[side].coverage,targets.baselineMinimumCoverage,"minimum")));
  return checks;
}
