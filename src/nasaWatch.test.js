import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { boneRule, immuneRule, heartRule, nasaWatchPlan, NASA_EVIDENCE_FILES } from "./nasaWatch.js";

const load = async path => JSON.parse(await readFile(new URL(`../public/${path}`, import.meta.url), "utf8"));
const evidence = { bone: await load(NASA_EVIDENCE_FILES.bone), research: await load(NASA_EVIDENCE_FILES.research), extended: await load(NASA_EVIDENCE_FILES.extended) };

test("bone rule ranks the distal femur first from OSD-804 and puts the knee test first", () => {
  const rule = boneRule(evidence.bone);
  assert.equal(rule.values.topSite, "DistalFemur");
  assert.equal(rule.values.topPercent, -54.55);
  assert.equal(rule.values.ranked[1][0], "FemoralHead");
  assert.match(rule.finding, /54\.5 % in the distal femur/);
  assert.equal(rule.status, "active");
  assert.deepEqual(rule.sources, ["OSD-804 · LSDS-130"]);
});

test("immune window comes from OSD-656: raised through day 45 after return, back by day 82", () => {
  const rule = immuneRule(evidence.extended);
  assert.equal(rule.values.windowDays, 45);
  assert.equal(rule.values.recoveredDay, 82);
  assert.equal(rule.status, "on-return");
  assert.match(rule.finding, /0\.33 before launch to 2\.12 after return/);
  assert.match(rule.finding, /White blood cells fell from 8\.5 to 6\.25/);
});

test("immune status follows the crew member's mission timing", () => {
  assert.equal(immuneRule(evidence.extended, { missionDay: 147, returnDay: 240 }).status, "scheduled");
  assert.match(immuneRule(evidence.extended, { missionDay: 147, returnDay: 240 }).note, /day 240 \(93 days from now\)/);
  assert.equal(immuneRule(evidence.extended, { missionDay: 250, returnDay: 240 }).status, "active");
  assert.equal(immuneRule(evidence.extended, { missionDay: 300, returnDay: 240 }).status, "routine");
});

test("heart rule adds no dose alarm because OSD-435 shows no consistent effect", () => {
  const rule = heartRule(evidence.research);
  assert.equal(rule.values.consistent, false);
  assert.equal(rule.status, "no-alarm");
  assert.match(rule.rule, /none is added/);
  assert.match(rule.finding, /9 months after 0\.1–3 Gy/);
});

test("the plan lists one rule per NASA-informed domain, each with its sources", () => {
  const plan = nasaWatchPlan(evidence, { missionDay: 147, returnDay: 240 });
  assert.deepEqual(plan.map(r => r.id), ["bone", "immune", "heart"]);
  for (const rule of plan) assert.ok(rule.sources.length > 0 && rule.finding && rule.rule);
});
