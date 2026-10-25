import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { CREW_BLOOD_FILE, analyteDefinition, replaySeries, replayCrew, crewWideChanges, labRangeChanges, crewReplayCard } from "./crewReplay.js";

const data = JSON.parse(await readFile(new URL(`../public/${CREW_BLOOD_FILE}`, import.meta.url), "utf8"));
const replay = replayCrew(data, { permutations: 300 });
const analyte = key => data.analytes.find(a => a.key === key);

test("bundle: 4 de-identified crew, 7 draws, raw OSDR files hashed, no sex field copied", () => {
  assert.deepEqual(data.crew, ["C001", "C002", "C003", "C004"]);
  assert.deepEqual(data.visits, ["L-92", "L-44", "L-3", "R+1", "R+45", "R+82", "R+194"]);
  assert.deepEqual(data.sources.map(s => s.study), ["OSD-569", "OSD-575", "OSD-575", "OSD-575"]);
  for (const s of data.sources) assert.match(s.sha256, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(JSON.stringify(data), /"SEX"|"sex"/);
});

test("review floor is the EFLM reference change value: RCV = 1.96 x sqrt(2) x sqrt(1.25) x CVI", () => {
  for (const a of data.analytes) assert.ok(Math.abs(a.rcvPct - 1.96 * Math.SQRT2 * Math.sqrt(1.25) * a.eflm.cviPct) < 0.06, a.key);
  const wbc = analyte("wbc");
  assert.equal(wbc.eflm.name, "Leukocytes");
  assert.equal(analyteDefinition(wbc, 6).floor, (wbc.rcvPct / 100) * 6);
});

test("replay never looks ahead: changing a later draw does not change an earlier verdict", () => {
  const points = data.series.C001.mcv.map(p => [...p]);
  const before = replaySeries(analyte("mcv"), points).results[0];
  points[6][1] = 50;
  assert.deepEqual(replaySeries(analyte("mcv"), points).results[0], before);
});

test("a measure with under three pre-flight draws stays in baseline, it is never judged", () => {
  const r = replaySeries(analyte("mchc"), data.series.C002.mchc);
  assert.equal(r.preUsable, 0);
  assert.ok(r.results.every(x => x.status === "baseline" || x.status === "notChecked"));
});

test("real crew: mean cell volume fell in all four the day after landing, inside the lab range", () => {
  const mcv = replay.summary.crewWide.find(w => w.key === "mcv");
  assert.equal(mcv.visit, "R+1");
  assert.equal(mcv.changed, 4);
  assert.equal(mcv.direction, "down");
  assert.equal(mcv.outsideLabRange, 0);
  assert.deepEqual(mcv.percentRange, [-5.2, -3.4]);
});

test("real crew: the R+45 glucose drop is one draw, gone by R+82, so handling is checked first", () => {
  const glucose = replay.summary.crewWide.find(w => w.key === "glucose");
  assert.equal(glucose.visit, "R+45");
  assert.equal(glucose.goneByNextVisit, true);
});

test("real crew: personal baseline flags what the population range misses, and spares the usual outliers", () => {
  const s = replay.summary;
  assert.equal(s.judged, 418);
  assert.ok(s.personalOnly > s.both, "most personal flags sit inside the lab range");
  assert.ok(s.labOnly > 0, "some out-of-range values are usual for that person");
  assert.equal(s.personalOnly + s.both, s.changedWithLabRange);
  // Half a year after return the flag rate is near the 5 % a 95 % change limit allows.
  const late = s.byVisit["R+194"];
  assert.ok(late.changed / late.judged < 0.08);
});

test("lab printed different reference ranges for C003 before and after flight", () => {
  const changes = labRangeChanges(data);
  assert.ok(changes.length > 0);
  assert.ok(changes.every(c => c.crew === "C003"));
  assert.ok(changes.some(c => c.key === "hemoglobin"));
});

test("crew-wide check needs most of the crew moving the same way at one draw", () => {
  const row = (crew, dir) => ({ crew, key: "x", label: "X", visit: "R+1", status: dir ? "changed" : "stable", percentFromBaseline: dir * 5, outsideLabRange: false });
  assert.equal(crewWideChanges([row("a", 1), row("b", 1), row("c", 1), row("d", 0)]).length, 1);
  assert.equal(crewWideChanges([row("a", 1), row("b", -1), row("c", 1), row("d", 0)]).length, 0);
  assert.equal(crewWideChanges([row("a", 1), row("b", 1)]).length, 0);
});

test("shuffle test is seeded and reproducible", () => {
  const again = replayCrew(data, { permutations: 300 });
  assert.deepEqual(again.summary.crewWideTest, replay.summary.crewWideTest);
  assert.ok(replay.summary.crewWideTest.p > 0 && replay.summary.crewWideTest.p <= 1);
});

test("app card states counts, crew-wide signals and its limits without diagnosing", () => {
  const card = crewReplayCard(replay);
  assert.match(card.finding, /mean cell volume down in 4 of 4 crew at R\+1/);
  assert.match(card.finding, /does not diagnose/);
  assert.doesNotMatch(card.finding, /anemi|disease|patholog/i);
  assert.deepEqual(card.sources.slice(0, 2), ["OSD-569 · LSDS-7", "OSD-575 · LSDS-8"]);
});
