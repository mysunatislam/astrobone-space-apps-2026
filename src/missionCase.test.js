import test from "node:test";
import assert from "node:assert/strict";
import demo from "./demoMission.json" with { type: "json" };
import { buildMissionCase, compareMovement, validateFollowup } from "./missionCase.js";
import { createBrowserCompanion } from "./browserCompanion.js";
const history = demo.observations.map(row => ({...row, id: `day-${row.mission_day}`, source:"synthetic", gravity:demo.gravity, pose_model:demo.pose_model, protocol:demo.protocol, calibrated_distance:false}));
const input = { profile:{astronaut_id:"DEMO",is_demo:true}, history, radiation:demo.radiation };
test("one synthetic case advances baseline, change, refusal, and usable follow-up", () => {
  assert.equal(buildMissionCase({...input,day:1}).status,"baseline_recorded");
  const changed=buildMissionCase({...input,day:180});
  assert.equal(changed.comparison.changes.find(r=>r.metric==="knee_extension_deg").delta,-14);
  assert.equal(changed.dose.cumulative_personal_absorbed_dose_mgy,27);
  const poor=buildMissionCase({...input,day:182});
  assert.equal(poor.status,"insufficient_evidence"); assert.deepEqual(poor.comparison.changes,[]); assert.equal(poor.followup,null);
  const repeat=buildMissionCase({...input,day:194});
  assert.equal(repeat.followup.previousDay,180); assert.equal(repeat.followup.direction,"closer to baseline");
  assert.match(repeat.followup.interpretation,/does not establish recovery/);
});
test("radiation context never changes the movement decision",()=>{
  const a=buildMissionCase({...input,day:180}), b=buildMissionCase({...input,day:180,radiation:[{mission_day:180,cumulative_personal_absorbed_dose_mgy:999}]});
  assert.equal(a.status,b.status); assert.deepEqual(a.comparison,b.comparison); assert.notEqual(a.dose,b.dose);
});
test("no common metric, bad protocol, nonfinite quality, and gravity mismatch withhold comparison",()=>{
  const first=history[0],last=history[3];
  for(const change of [{metrics:{hip_rom_left_deg:30}},{protocol:"different"},{gravity:"earth"},{tracking_quality:NaN}]) {
    assert.equal(compareMovement([first,{...last,...change}]).comparable,false);
  }
});
test("no resolved change is not a clearance and severe symptoms bypass camera gates",()=>{
  const same={...history[0],id:"same",mission_day:2,is_baseline:false};
  const result=buildMissionCase({...input,history:[history[0],same]});
  assert.equal(result.status,"no_resolved_change"); assert.match(result.confidence,/not established/);
  const urgent=buildMissionCase({...input,day:182,redFlags:true});
  assert.equal(urgent.status,"human_review_now"); assert.match(urgent.nextAction,/do not wait/);
});
test("follow-up actions require consent and belong to the selected observation",()=>{
  const value={assessment_id:"day-180",mission_day:180,kind:"repeat_requested",consent_to_store:true};
  assert.equal(validateFollowup(value,history).kind,"repeat_requested");
  for(const overrides of [{consent_to_store:false},{mission_day:194},{assessment_id:"someone-else"},{kind:"prescribe"}]) assert.throws(()=>validateFollowup({...value,...overrides},history));
});
test("browser records and reports use the same selected day and retain follow-up actions",async()=>{
  const store=createBrowserCompanion(null), post=(path,body)=>store.request(path,{method:"POST",body:JSON.stringify(body)});
  const profile=await post("/demo",{}), path=`/profiles/${profile.astronaut_id}`;
  const data=await store.request(path), row=data.history.find(r=>r.mission_day===180);
  await post(`${path}/followups`,{assessment_id:row.id,mission_day:180,kind:"repeat_requested",consent_to_store:true});
  const run=await post("/runs",{astronaut_id:profile.astronaut_id,prompt:"Review",red_flags:[],as_of_day:180});
  const report=(await store.request(`/runs/${run.id}`)).report;
  assert.equal(report.comparison.current_day,180);assert.equal(report.environment.radiation.status,"synthetic");assert.equal(report.followups.length,1);
  const poor=await post("/runs",{astronaut_id:profile.astronaut_id,prompt:"Review",red_flags:[],as_of_day:182});
  assert.equal((await store.request(`/runs/${poor.id}`)).report.priority.status,"insufficient_evidence");
  await store.request(path,{method:"DELETE"});assert.deepEqual(await store.request("/profiles"),[]);
});
