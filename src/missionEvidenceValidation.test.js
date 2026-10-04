import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateMissionResearch,validateExtendedResearch,validateBoneResearch,validateCirculationReference } from "./missionEvidenceValidation.js";
const read = name => JSON.parse(readFileSync(new URL(`../public/data/${name}.json`,import.meta.url),"utf8"));
const fixtures = { research: ["mission-research",validateMissionResearch], extended: ["mission-research-extended",validateExtendedResearch], bone: ["osdr-804-summary",validateBoneResearch], circulation: ["circulation-reference",validateCirculationReference] };
for (const [name,[file,validate]] of Object.entries(fixtures)) test(`${name}: actual bundled artifact passes without mutation`,()=>{
  const data=read(file),before=JSON.stringify(data); assert.equal(validate(data),data); assert.equal(JSON.stringify(data),before);
});
const badCases = [
  ["research","wrong CRP units",d=>{d.cardiovascular.unit="pg/mL";}],
  ["research","negative record counts",d=>{d.radiation.groups[0].n=-1;}],
  ["research","unreconciled radiation exclusions",d=>{d.radiation.excludedMissing++;}],
  ["research","invalid ejection fraction",d=>{d.radiation.groups[0].median=120;}],
  ["research","unsafe study link",d=>{d.cardiovascular.url="javascript:alert(1)";}],
  ["research","misassigned source accession",d=>{d.cardiovascular.sources[0].url=d.radiation.sources[0].url;}],
  ["research","restricted source",d=>{d.radiation.sources[0].restricted=true;}],
  ["extended","empty study list",d=>{d.studies=[];}],
  ["extended","duplicate visits",d=>{d.studies[0].metrics[0].points[1].visit=d.studies[0].metrics[0].points[0].visit;}],
  ["extended","NPQ relabeled as mass concentration",d=>{d.studies[1].metrics[0].unit="ng/mL";}],
  ["extended","ambiguous assay field",d=>{d.studies[0].metrics[0].field="hemoglobin_value_percent";}],
  ["extended","median outside range",d=>{d.studies[0].metrics[0].points[0].median=10000;}],
  ["extended","missing values counted as participants",d=>{d.studies[0].metrics[0].points[0].missing=4;}],
  ["bone","wrong species",d=>{d.study.organism="Homo sapiens";}],
  ["bone","nonfinite cortical value",d=>{d.flightVsGroundControl.find(r=>r.site==="CorticalFemur"&&r.measure==="cortical_thickness_millimeter").flightMean=NaN;}],
  ["circulation","empty presets with no failing flags",d=>{d.scenarios=[];}],
  ["circulation","numerical failure hidden by passed flag",d=>{d.scenarios[0].verification.conservedVolumeErrorMl=12;}],
  ["circulation","nonfinite sample",d=>{d.scenarios[0].samples[1].ventricularPressure=Infinity;}],
  ["circulation","string pretending to be a number",d=>{d.scenarios[0].samples[1].ventricularVolume="100";}],
  ["circulation","reordered time samples",d=>{d.scenarios[0].samples.reverse();}],
  ["circulation","missing cycle endpoint",d=>{d.scenarios[0].samples.pop();}],
  ["circulation","negative ideal-valve flow",d=>{d.scenarios[0].samples[0].aorticFlow=-1;}],
  ["circulation","wrong pressure units",d=>{d.units.pressure="Pa";}],
];
for (const [kind,name,change] of badCases) test(`withholds ${name}`,()=>{
  const [file,validate]=fixtures[kind],data=read(file);change(data);assert.throws(()=>validate(data));
});

test("missing assay aggregates remain null; reported zero is valid",()=>{
  const data=read("mission-research-extended"),p=data.studies[0].metrics[0].points[0];
  p.missing=p.n;p.n=0;p.min=p.max=p.median=null;p.reportedZeros=0;
  assert.equal(validateExtendedResearch(data),data);
  p.n=p.missing;p.missing=0;p.min=p.max=p.median=0;p.reportedZeros=p.n;
  assert.equal(validateExtendedResearch(data),data);
});
