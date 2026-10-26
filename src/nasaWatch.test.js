import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { boneRule, immuneRule, heartRule, nasaWatchPlan, NASA_EVIDENCE_FILES } from "./nasaWatch.js";

const load = async path => JSON.parse(await readFile(new URL(`../public/${path}`, import.meta.url), "utf8"));
const evidence = { bone: await load(NASA_EVIDENCE_FILES.bone), research: await load(NASA_EVIDENCE_FILES.research), extended: await load(NASA_EVIDENCE_FILES.extended) };

test("bone rule: OSD-804 supports loss at the distal femur and femoral head, not the spine", () => {
  const rule = boneRule(evidence.bone);
  assert.deepEqual(rule.values.supportedSites.sort(), ["DistalFemur", "FemoralHead"]);
  assert.ok(rule.values.notSupportedSites.includes("Vertebrae"));
  assert.equal(rule.values.headline.site, "DistalFemur");
  assert.equal(rule.values.headline.measure, "bone_volume_total_volume_millimeter_cubed");
  assert.match(rule.finding, /distal femur above the knee \(p = 0\.00\d\)/);
  assert.match(rule.finding, /corrected across 5 sites/);
  assert.match(rule.finding, /spine showed no clear change/);
  assert.equal(rule.status, "active");
  assert.deepEqual(rule.sources, ["OSD-804 · LSDS-130"]);
});

test("OSD-804 statistics are internally consistent", () => {
  const { flightVsGroundControl: rows, siteTests, statistics } = evidence.bone;
  assert.equal(statistics.fdrAlpha, 0.05);
  for (const r of rows) {
    assert.ok(r.qValue >= r.pValue && r.qValue <= 1, `${r.site} ${r.measure} q >= p`);
    assert.ok(r.hedgesGCi95[0] <= r.hedgesG && r.hedgesG <= r.hedgesGCi95[1]);
    assert.equal(Math.sign(r.hedgesG), Math.sign(r.flightMean - r.groundMean));
    if (r.percentReliable) assert.ok(r.percentCi95[0] <= r.percentDifference && r.percentDifference <= r.percentCi95[1]);
    else assert.equal(r.percentCi95, null);
    assert.equal(r.adverse, Boolean(r.worse) && r.qValue < statistics.fdrAlpha);
  }
  // A percent of a control mean that straddles zero is not interpretable (femoral head pattern factor).
  assert.equal(rows.find(r => r.site === "FemoralHead" && r.measure === "trabecular_bone_pattern_factor").percentReliable, false);
  assert.equal(siteTests.length, 5);
  for (const t of siteTests) assert.ok(t.pHolm >= t.pValue && t.significant === t.pHolm < 0.05);
});

test("immune window comes from OSD-656: raised through day 45 after return, back by day 82", () => {
  const rule = immuneRule(evidence.extended);
  assert.equal(rule.values.windowDays, 45);
  assert.equal(rule.values.recoveredDay, 82);
  assert.equal(rule.status, "on-return");
  assert.equal(rule.values.windowDaysVsMedian, 45, "the window does not depend on which pre-flight summary is used");
  assert.match(rule.finding, /\(2\.04–2\.12\) stayed above every pre-flight visit \(0\.33–1\.60\)/);
  assert.match(rule.finding, /White blood cells the day after return \(6\.25\) were within the pre-flight range \(5\.95–8\.5\)/);
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
