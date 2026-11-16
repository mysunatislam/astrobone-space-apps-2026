// Claim audit: recomputes the headline numbers that the README and the Space Apps submission text state,
// from the shipped code and data, and checks that the README still says them. Nothing is typed in twice:
// every "found" value below is computed here. Run: node scripts/audit-claims.mjs [--quick] [--json] [--tests]
// --quick skips the two 60-day false-alarm simulations (about 45 s each); --tests also runs `npm test` and
// checks the README's test count.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { spaceWeatherContext, validateSpaceWeather } from "../src/spaceWeather.js";
import { validateIssDosimetry } from "../src/issDosimetry.js";
import { replayCrew } from "../src/crewReplay.js";
import { boneRule, immuneRule } from "../src/nasaWatch.js";
import { surgeonReport, byteSize } from "../src/surgeonReport.js";
import { evaluateSelfCheck } from "../src/selfCheck.js";
import { ELENA_HISTORY, elenaDay147 } from "../src/elenaSelfCheck.js";
import { environmentFor, ENVIRONMENTS } from "../src/missionEnvironment.js";

const root = new URL("../", import.meta.url);
const read = p => readFileSync(new URL(p, root), "utf8");
const json = p => JSON.parse(read(p));
const csv = p => { const [head, ...rows] = read(p).trim().split(/\r?\n/).map(l => l.match(/("[^"]*"|[^,]*)(,|$)/g).map(c => c.replace(/,$/, "").replace(/^"|"$/g, ""))); return rows.map(r => Object.fromEntries(head.map((h, i) => [h, r[i]]))); };
const README = read("README.md");
const args = new Set(process.argv.slice(2));
const results = [];
// claim: what is claimed; found: recomputed value (string); text: the phrase the README must contain.
function check(id, claim, found, ok, text = null) {
  const inReadme = text == null ? null : README.includes(text);
  results.push({ id, claim, found: String(found), pass: Boolean(ok) && inReadme !== false, inReadme });
}
const round = (v, d = 1) => Number(v.toFixed(d));

// NASA DONKI solar particle events.
const donki = json("public/data/donki-sep.json");
validateSpaceWeather(donki);
const ctx = spaceWeatherContext(donki, 3);
check("donki-events", "40 measured solar particle events, 31 near Earth, 9 with >100 MeV at GOES", `${ctx.episodes.length} events, ${ctx.near.length} near Earth, ${ctx.high.length} >100 MeV`,
  ctx.episodes.length === 40 && ctx.near.length === 31 && ctx.high.length === 9, "40 measured solar particle events");
check("donki-rows", "218 DONKI rows, 87 model-forecast rows left out", `${donki.events.length} rows, ${ctx.forecastRows} forecast-only`,
  donki.events.length === 218 && ctx.forecastRows === 87, "218 DONKI rows");

// ISS area dosimeters (OSDR study metadata).
const iss = validateIssDosimetry(json("public/data/iss-dosimetry.json")).summary;
const rate = iss.rate_mGy_per_day;
check("iss-dose", "32 ISS dose rates, 0.204-0.355 mGy/day, median 0.294", `${iss.measurements} rates, ${rate.min}-${rate.max}, median ${rate.median}`,
  iss.measurements === 32 && rate.min === 0.204 && rate.max === 0.355 && rate.median === 0.294, "0.204–0.355 mGy/day (median 0.294)");
const cruise = Number(read("src/elenaMissionScenario.js").match(/TRANSIT_DOSE_RATE = ([\d.]+)/)?.[1]);
check("mars-cruise-dose", "Demo dosimeter accrues 0.458 mGy/day (MSL/RAD cruise)", cruise, cruise === 0.458, "0.458 mGy/day");

// OSD-804 bone and OSD-656 immune rules, computed from the shipped summaries.
const bone = boneRule(json("public/data/osdr-804-summary.json"));
check("osd804", "Distal femur p = 0.004, femoral head p = 0.007; bone volume fraction above the knee -55 % (95% CI -68 to -30 %)", bone.finding.replace(/\s+/g, " ").slice(0, 400),
  /distal femur above the knee \(p = 0\.004\)/.test(bone.finding) && /femoral head at the hip \(p = 0\.007\)/.test(bone.finding) && /-55 % vs ground control \(95% CI -68 % to -30 %\)/.test(bone.finding), "distal femur, p = 0.004");
const immune = immuneRule(json("public/data/mission-research-extended.json"));
check("osd656", "VCAM1 above every pre-flight visit for 45 days, back by day 82", immune.finding?.slice(0, 300) ?? JSON.stringify(immune.values), /45/.test(JSON.stringify(immune)) && /82/.test(JSON.stringify(immune)), "for 45 days after return, back by day 82");

// Inspiration4 crew replay.
const replay = replayCrew(json("public/data/i4-crew-blood.json")).summary;
const mcv = replay.crewWide.find(w => w.key === "mcv");
check("i4-mcv", "Mean cell volume down in all four crew the day after landing, -3.4 to -5.2 %", `${mcv.changed}/${mcv.judged} at ${mcv.visit}, ${mcv.percentRange.join(" to ")} %`,
  mcv.changed === 4 && mcv.visit === "R+1" && mcv.percentRange[0] === -5.2 && mcv.percentRange[1] === -3.4, "−3.4 to −5.2 %");
check("i4-flags", "27 clinical measures; 23 of 31 flags missed by the population range", `${replay.analytes} measures, ${replay.personalOnly} of ${replay.changed} personal-only`,
  replay.analytes === 27 && replay.personalOnly === 23 && replay.changed === 31, "23 of its 31 flags");
const draws = json("public/data/i4-crew-blood.json");
let pre = 0, below70 = 0;
for (const person of Object.values(draws.series)) for (const [visit, value] of person.glucose ?? []) if (visit.startsWith("L") && Number.isFinite(value)) { pre++; if (value < 70) below70++; }
if (pre) check("i4-glucose", "ADA 70 mg/dL level fired on 4 of 12 healthy pre-flight draws", `${below70} of ${pre}`, below70 === 4 && pre === 12, "4 of 12 healthy pre-flight draws");

// Flight surgeon report size (Elena, Day 147, Mars transit).
const mars = environmentFor("marsTransit"), day = elenaDay147(), ev = evaluateSelfCheck(day, ELENA_HISTORY, { environment: mars });
const text = surgeonReport(ev, day, { environment: mars }), full = JSON.stringify({ check: day, evaluation: ev }, null, 2);
check("report-size", "Report for flight surgeon: 1.6 kB, 13x smaller than the full JSON record", `${(byteSize(text) / 1000).toFixed(2)} kB, ${(byteSize(full) / byteSize(text)).toFixed(1)}x`,
  Math.abs(byteSize(text) / 1000 - 1.6) < 0.05 && Math.round(byteSize(full) / byteSize(text)) === 13, "1.6 kB plain-text message (13× smaller");
check("escalation-places", "Escalation ladder for space station, Orion, lunar base, rover, Mars transit and Mars base", ENVIRONMENTS.map(e => e.label).join(", "), ENVIRONMENTS.length >= 6, null);
check("mars-delay", "A message to Earth can take up to 22 minutes one way", `${mars.delaySec.map(v => (v / 60).toFixed(1)).join("-")} min`, Math.round(mars.delaySec[1] / 60) === 22, "up to 22 minutes one way");

// Real-video validation tables (derived files committed in data/validation).
const perPerson = csv("data/validation/rehab24-knee-per-person.csv");
const better = perPerson.filter(r => Number(r["Learned trees + fallback (shipped)"]) < Number(r["Pretrained, 3D angle (app before)"])).length;
check("knee-people", "Hybrid knee model better for 9 of 9 people it never saw", `${better} of ${perPerson.length}`, better === 9 && perPerson.length === 9, "better for 9 of 9 people");
const pulse = csv("data/validation/mcd-pulse-methods.csv").find(r => r.method === "AstroBone hybrid");
check("pulse-mae", "Camera pulse within 2.1 bpm on average, 90 % of windows within 5 bpm, 96 % answered", `${pulse.mae_bpm} bpm, ${pulse.within_5_bpm_pct} % within 5, ${pulse.windows_answered_pct} % answered`,
  round(Number(pulse.mae_bpm)) === 2.1 && Math.round(Number(pulse.within_5_bpm_pct)) === 90 && Math.round(Number(pulse.windows_answered_pct)) === 96, "within 2.1 bpm on average");
const rvs = csv("data/validation/mcd-pulse-rest-vs-squats.csv").filter(r => r.camera_rest_bpm !== "" && r.camera_after_squats_bpm !== "");
const riseErr = rvs.reduce((s, r) => s + Math.abs((r.camera_after_squats_bpm - r.camera_rest_bpm) - (r.finger_after_squats_bpm - r.finger_rest_bpm)), 0) / rvs.length;
check("pulse-rise", "Tracked each person's rise from rest within 4.2 bpm", `${riseErr.toFixed(2)} bpm over ${rvs.length} people`, round(riseErr) === 4.2, "within 4.2 bpm");

// False-alarm simulation (the app's own evaluateSelfCheck on 1,000 simulated astronauts x 60 days).
if (!args.has("--quick")) {
  const sim = flags => JSON.parse(execFileSync(process.execPath, [new URL("simulate-false-alarms.mjs", import.meta.url).pathname, "--json", ...flags], { maxBuffer: 1 << 26 }));
  const multi = sim([]), single = sim(["--single"]);
  const knee10 = multi.detection.find(d => d.key === "kneeExtension");
  check("false-alarms", "Days flagged for review: 44.8 % (one-value rule) -> 11.4 % (multirule)", `${single.stable.reviewOrWorsePct} % -> ${multi.stable.reviewOrWorsePct} %`,
    single.stable.reviewOrWorsePct === 44.8 && multi.stable.reviewOrWorsePct === 11.4, "from 44.8 % (one-value rule) to 11.4 %");
  check("knee-detection", "A 10° knee loss is caught within 14 checks in 98 % of runs", `${knee10.withinTwoWeeksPct} %`, knee10.withinTwoWeeksPct === 98, null);
}

if (args.has("--tests")) {
  const out = execFileSync("npm", ["test", "--silent"], { cwd: new URL(".", root).pathname, encoding: "utf8", maxBuffer: 1 << 28 });
  const n = Number(out.match(/^# tests (\d+)/m)?.[1]), failed = Number(out.match(/^# fail (\d+)/m)?.[1]);
  const stated = [...README.matchAll(/(\d+) automated tests/g)].map(m => Number(m[1]));
  check("tests", "README test count matches `npm test`, all passing", `${n} tests, ${failed} failing; README says ${[...new Set(stated)].join(", ")}`, failed === 0 && stated.every(s => s === n), null);
}

if (args.has("--json")) console.log(JSON.stringify(results, null, 2));
else {
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.id.padEnd(18)} ${r.claim}\n      found: ${r.found}${r.inReadme === false ? "\n      README no longer states it in these words" : ""}`);
  console.log(`\n${results.filter(r => r.pass).length} of ${results.length} claims reproduced`);
}
process.exitCode = results.every(r => r.pass) ? 0 : 1;
