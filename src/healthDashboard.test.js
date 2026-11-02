import test from "node:test";
import assert from "node:assert/strict";
import { dashboardModel, adherenceStrip } from "./healthDashboard.js";
import { ELENA_HISTORY, ELENA_CHECK_DAYS, elenaDay147 } from "./elenaSelfCheck.js";
import { evaluateSelfCheck, INDICATORS, SELF_CHECK_SCHEMA } from "./selfCheck.js";
import { environmentFor } from "./missionEnvironment.js";

const env = environmentFor("marsTransit");

test("Elena's dashboard repeats the self-check's own judgement for every indicator", () => {
  const today = elenaDay147(), ev = evaluateSelfCheck(today, ELENA_HISTORY, { environment: env });
  const model = dashboardModel({ records: ELENA_HISTORY, current: today, environment: env });
  assert.equal(model.empty, false);
  assert.equal(model.overall, ev.overall);
  assert.equal(model.tiles.length, Object.keys(INDICATORS).length);
  for (const tile of model.tiles) assert.equal(tile.status, ev.domains.flatMap(d => d.indicators).find(r => r.key === tile.key).status, tile.key);
  for (const d of model.domains) assert.equal(d.status, ev.domains.find(x => x.key === d.key).status, d.key);
});

test("Elena Day 147: knee and reaction flagged, headline names the systems, ladder says logged for review", () => {
  const model = dashboardModel({ records: ELENA_HISTORY, current: elenaDay147(), environment: env });
  const knee = model.tiles.find(t => t.key === "kneeExtension");
  assert.equal(knee.status, "changed");
  assert.equal(knee.text, "151");
  assert.equal(knee.sinceFirst.day, 1);
  assert.equal(knee.sinceFirst.delta, -14);
  assert.match(knee.usualText, /^usual 162 ± 6\.9°$/);
  assert.equal(knee.series.length, 5);
  assert.match(model.headline, /^3 of 5 body systems need a look: Bone & muscle, Cardiovascular, Behavioral health\.$/);
  assert.equal(model.plan.steps.find(s => s.active).key, "log");
  assert.equal(model.chartKey, "kneeExtension");
  assert.deepEqual(model.flagged.slice(0, 2).map(t => t.status), ["changed", "changed"]);
});

test("without a current check the newest record is today's", () => {
  const model = dashboardModel({ records: ELENA_HISTORY, environment: env });
  assert.equal(model.missionDay, 120);
  assert.equal(model.checks, ELENA_HISTORY.length);
});

test("no records gives an empty dashboard", () => {
  assert.equal(dashboardModel({ records: [] }).empty, true);
});

test("a blood pressure over the urgent limit shows URGENT on the first check, with the limit on the tile", () => {
  const check = { schema: SELF_CHECK_SCHEMA, id: "first", at: "2026-11-02T08:00:00Z", values: { systolicBp: 186, diastolicBp: 95 }, protocols: {}, quality: {} };
  const model = dashboardModel({ records: [], current: check, environment: environmentFor("station") });
  const sys = model.tiles.find(t => t.key === "systolicBp");
  assert.equal(model.overall, "urgent");
  assert.equal(sys.status, "urgent");
  assert.match(sys.limit, /above 180 mmHg/);
  assert.equal(model.plan.steps.find(s => s.active).key, "now");
  assert.equal(model.tiles.find(t => t.key === "glucose").status, "notChecked");
});

test("adherence strip marks Elena's four missed days and today", () => {
  const strip = adherenceStrip(ELENA_CHECK_DAYS, 147, { from: 1, to: 147 });
  assert.equal(strip.cells.length, 147);
  assert.equal(strip.missed, 4);
  assert.equal(strip.cells.at(-1).state, "today");
  assert.deepEqual(strip.cells.filter(c => c.state === "missed").map(c => c.day), [33, 34, 88, 131]);
});

test("crew view sorts the four synthetic crew most serious first, each judged against their own checks", async () => {
  const { CREW } = await import("./crewDemo.js");
  const { crewRoster, crewSummaryText } = await import("./healthDashboard.js");
  const roster = crewRoster(CREW, env);
  assert.deepEqual(roster.rows.map(r => [r.id, r.status]), [["daniel", "attention"], ["elena", "changed"], ["sofia", "recheck"], ["priya", "stable"]]);
  assert.deepEqual(roster.counts, { attention: 1, changed: 1, recheck: 1, stable: 1 });
  const daniel = roster.rows[0];
  assert.equal(daniel.lead.key, "systolicBp");
  assert.match(daniel.lead.limit, /at or above 140 mmHg/);
  // Elena in the crew view is exactly her own dashboard.
  const elena = roster.rows.find(r => r.id === "elena");
  assert.equal(elena.model.overall, dashboardModel({ records: ELENA_HISTORY, current: elenaDay147(), environment: env }).overall);
  assert.equal(elena.adherence.done, ELENA_CHECK_DAYS.length + 1);
  const text = crewSummaryText(roster, env);
  assert.ok(new TextEncoder().encode(text).length < 2048, "fits a slow link");
  assert.match(text.split("\n")[3], /^CONTACT TODAY Daniel Okoye/);
});

test("values keep their decimals: 37.0 °C stays 37.0", () => {
  const model = dashboardModel({ records: ELENA_HISTORY, current: elenaDay147(), environment: env });
  assert.equal(model.tiles.find(t => t.key === "pvtSpeed").text, "3.00");
  assert.equal(model.tiles.find(t => t.key === "bodyTemp").text, "37.3");
});
