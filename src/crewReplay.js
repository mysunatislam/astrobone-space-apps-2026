// Inspiration4 crew replay: run AstroBone's own personal-baseline rule (evaluateIndicator and its
// CUSUM drift check, unchanged) on the four real crew members' blood, each against their own three
// pre-flight draws. Data: public/data/i4-crew-blood.json, built by scripts/build_crew_blood.py
// from NASA OSDR OSD-569 / OSD-575. This is a retrospective test of the rule on real spaceflight,
// not a diagnosis: four people, three days in orbit, seven blood draws each.
import { evaluateIndicator } from "./selfCheck.js";

export const CREW_BLOOD_FILE = "data/i4-crew-blood.json";

export async function loadCrewBlood(base = "/") {
  const response = await fetch(`${base}${CREW_BLOOD_FILE}`);
  if (!response.ok) throw new Error(`${CREW_BLOOD_FILE}: HTTP ${response.status}`);
  return response.json();
}

const isPre = visit => visit.startsWith("L");
const mean = values => values.reduce((s, v) => s + v, 0) / values.length;

// The review floor for a blood value is its reference change value: the smallest change between
// two results of one person that within-person biology plus a desirable-quality assay rarely
// produce by chance (EFLM CVI, two-sided 95 %). It plays the part `floor` plays for the knee test.
export function analyteDefinition(analyte, preMean) {
  return { domain: "blood", label: analyte.label, unit: analyte.unit, direction: "both", floor: (analyte.rcvPct / 100) * Math.abs(preMean), source: analyte.source };
}

// Replays one person's series in visit order, exactly as the app would see daily checks arrive:
// every result is judged against what came before it, never against the future.
export function replaySeries(analyte, points) {
  const pre = points.filter(([visit, value]) => isPre(visit) && Number.isFinite(value));
  const preCount = points.filter(([visit]) => isPre(visit)).length;
  const def = pre.length ? analyteDefinition(analyte, mean(pre.map(p => p[1]))) : null;
  const history = [], results = [];
  for (const [visit, value, low, high] of points) {
    const usable = Number.isFinite(value);
    if (!isPre(visit)) {
      const outsideLabRange = usable && ((Number.isFinite(low) && value < low) || (Number.isFinite(high) && value > high));
      const result = !def || pre.length < 3
        ? { status: usable ? "baseline" : "notChecked" }
        : evaluateIndicator(analyte.key, usable ? value : null, history, { def, drift: { baselineCount: pre.length } });
      results.push({
        visit, value: usable ? value : null, status: result.status, reason: result.reason ?? null,
        preMean: def ? round(mean(pre.map(p => p[1])), 3) : null,
        percentFromBaseline: def && usable && result.drift?.ready ? round(100 * (value - result.drift.lockedMean) / result.drift.lockedMean, 1) : null,
        tolerance: result.tolerance !== undefined ? round(result.tolerance, 3) : null,
        cusum: result.drift?.cusum ?? null,
        labRange: Number.isFinite(low) || Number.isFinite(high) ? [low ?? null, high ?? null] : null,
        outsideLabRange: Boolean(outsideLabRange),
      });
    }
    if (usable) history.push({ values: { [analyte.key]: value } });
  }
  return { key: analyte.key, label: analyte.label, unit: analyte.unit, panel: analyte.panel, rcvPct: analyte.rcvPct, preCount, preUsable: pre.length, points: points.map(([visit, value]) => [visit, value]), results };
}

function round(value, digits) { return Number(value.toFixed(digits)); }

export const CLINICAL_PANELS = Object.freeze(["CBC", "CMP"]);

export function replayCrew(data, { permutations = 2000 } = {}) {
  const crew = data.crew.map(id => ({ id, analytes: data.analytes.map(a => replaySeries(a, data.series[id][a.key])) }));
  const clinical = summarizeReplay(crew, data, { panels: CLINICAL_PANELS });
  if (permutations) clinical.crewWideTest = crewWidePermutation(crew, data, { panels: CLINICAL_PANELS, iterations: permutations });
  // Multiplex serum assays are research panels with much wider variation; reported, never headlined.
  const exploratory = summarizeReplay(crew, data, { panels: [...new Set(data.analytes.map(a => a.panel))].filter(p => !CLINICAL_PANELS.includes(p)) });
  return { crew, summary: clinical, exploratory, labRangeChanges: labRangeChanges(data) };
}

const judgedRows = (crew, panels) => crew.flatMap(c => c.analytes.filter(a => panels.includes(a.panel))
  .flatMap(a => a.results.map(r => ({ crew: c.id, key: a.key, label: a.label, panel: a.panel, ...r }))))
  .filter(r => r.status === "changed" || r.status === "stable");
const direction = r => (r.status !== "changed" ? 0 : Math.sign(r.percentFromBaseline ?? 0));

// A change seen in most of the crew at the same blood draw. It may be the flight, or it may be the
// draw itself (a different lab, a delayed tube): either way the app should say "crew-wide, check the
// sample handling" rather than treat it as one person's news.
export function crewWideChanges(rows, { share = 0.75, minJudged = 3 } = {}) {
  const groups = new Map();
  for (const r of rows) { const id = `${r.key}|${r.visit}`; if (!groups.has(id)) groups.set(id, []); groups.get(id).push(r); }
  return [...groups.values()].flatMap(group => {
    const up = group.filter(r => direction(r) > 0), down = group.filter(r => direction(r) < 0);
    const hits = up.length >= down.length ? up : down;
    if (group.length < minJudged || hits.length < Math.ceil(share * group.length)) return [];
    return [{ key: group[0].key, label: group[0].label, visit: group[0].visit, judged: group.length, changed: hits.length, direction: hits === up ? "up" : "down",
      percentRange: [Math.min(...hits.map(r => r.percentFromBaseline)), Math.max(...hits.map(r => r.percentFromBaseline))],
      outsideLabRange: hits.filter(r => r.outsideLabRange).length }];
  });
}

// Could crew-wide changes this large arise from each person's own flags falling on random draws?
// Shuffle every person's post-flight flags across their own visits (keeping how often each person
// and measure flags) and count crew-wide events. Seeded, so the docs and tests reproduce.
export function crewWidePermutation(crew, data, { panels = CLINICAL_PANELS, iterations = 2000, seed = 20210915 } = {}) {
  const rows = judgedRows(crew, panels), observed = crewWideChanges(rows).length;
  let state = seed >>> 0;
  const random = () => { state = (state + 0x6d2b79f5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const series = new Map();
  for (const r of rows) { const id = `${r.crew}|${r.key}`; if (!series.has(id)) series.set(id, []); series.get(id).push(r); }
  let atLeast = 0;
  for (let i = 0; i < iterations; i++) {
    const shuffled = [];
    for (const group of series.values()) {
      const visits = group.map(r => r.visit);
      for (let j = visits.length - 1; j > 0; j--) { const k = Math.floor(random() * (j + 1)); [visits[j], visits[k]] = [visits[k], visits[j]]; }
      group.forEach((r, j) => shuffled.push({ ...r, visit: visits[j] }));
    }
    if (crewWideChanges(shuffled).length >= observed) atLeast++;
  }
  return { observed, iterations, seed, p: round((atLeast + 1) / (iterations + 1), 4) };
}

// Where the lab changed a person's printed reference range between pre- and post-flight draws.
export function labRangeChanges(data) {
  return data.crew.flatMap(id => data.analytes.flatMap(a => {
    const points = data.series[id][a.key].filter(p => p.length > 2), range = p => `${p[2]}-${p[3]}`;
    const pre = [...new Set(points.filter(p => isPre(p[0])).map(range))], post = [...new Set(points.filter(p => !isPre(p[0])).map(range))];
    return pre.length && post.length && pre.join() !== post.join() ? [{ crew: id, key: a.key, label: a.label, pre, post }] : [];
  }));
}

// What the replay shows, as counts a judge can check against the JSON.
export function summarizeReplay(crew, data, { panels = CLINICAL_PANELS } = {}) {
  const visits = data.visits.filter(v => !isPre(v));
  const judged = judgedRows(crew, panels);
  const changed = judged.filter(r => r.status === "changed");
  const withRange = judged.filter(r => r.labRange);
  const byVisit = Object.fromEntries(visits.map(v => {
    const at = judged.filter(r => r.visit === v);
    return [v, { judged: at.length, changed: at.filter(r => r.status === "changed").length }];
  }));
  return {
    panels, crew: crew.length, analytes: data.analytes.filter(a => panels.includes(a.panel)).length, judged: judged.length, changed: changed.length, byVisit,
    driftAlarms: judged.filter(r => r.reason === "drift").length,
    // Personal baseline vs the one-size population range the lab printed beside each value.
    withLabRange: withRange.length,
    changedWithLabRange: withRange.filter(r => r.status === "changed").length,
    personalOnly: withRange.filter(r => r.status === "changed" && !r.outsideLabRange).length,
    labOnly: withRange.filter(r => r.status === "stable" && r.outsideLabRange).length,
    both: withRange.filter(r => r.status === "changed" && r.outsideLabRange).length,
    // A crew-wide change gone by the next draw points at that one draw (its handling) before biology.
    crewWide: crewWideChanges(judged).map(w => {
      const next = visits[visits.indexOf(w.visit) + 1];
      const after = next ? judged.filter(r => r.key === w.key && r.visit === next) : [];
      return { ...w, nextVisit: next ?? null, goneByNextVisit: after.length > 0 && after.every(r => direction(r) !== (w.direction === "up" ? 1 : -1)) };
    }),
  };
}

// Plain-language card for the app: what happened when the rule met real crew blood.
export function crewReplayCard(replay) {
  const s = replay.summary, first = s.byVisit["R+1"], late = s.byVisit["R+194"] ?? Object.values(s.byVisit).at(-1);
  const pct = (a, b) => `${Math.round((100 * a) / b)} %`;
  const wide = s.crewWide.map(w => `${w.label.toLowerCase()} ${w.direction} in ${w.changed} of ${w.judged} crew at ${w.visit} (${w.percentRange.map(v => `${v > 0 ? "+" : ""}${v}`).join(" to ")} %${w.outsideLabRange ? `, ${w.outsideLabRange} outside the lab range` : ", all inside the lab range"}${w.goneByNextVisit ? `, gone by ${w.nextVisit}: check that draw's handling first` : ""})`);
  const ranges = [...new Set(replay.labRangeChanges.map(c => c.crew))];
  return {
    id: "crew", check: "Your own baseline, tested on real crew", status: "tested",
    sources: ["OSD-569 · LSDS-7", "OSD-575 · LSDS-8", "EFLM biological variation"],
    rule: `The same rule that judges your checks was run on ${s.crew} Inspiration4 crew members' blood, ${s.analytes} clinical measures each, against their own three pre-flight draws.`,
    finding: `The day after landing it flagged ${first.changed} of ${first.judged} results (${pct(first.changed, first.judged)}); at the last visit, half a year later, ${late.changed} of ${late.judged} (${pct(late.changed, late.judged)}), near the 1 in 20 its 95 % change limit allows. ${s.personalOnly} of its ${s.changedWithLabRange} flags sat inside the lab's population range, which would have missed them; ${s.labOnly} results outside that range were usual for that person and were not flagged. Crew-wide: ${wide.join("; ")}${s.crewWideTest ? ` (shuffle test p = ${s.crewWideTest.p})` : ""}.${ranges.length ? ` The lab switched ${ranges.join(", ")}'s printed ranges between pre- and post-flight draws; a personal baseline is not affected.` : ""} Four people, three days in orbit: this tests the rule, it does not diagnose anyone.`,
    values: { judged: s.judged, changed: s.changed, firstDay: first, late, personalOnly: s.personalOnly, labOnly: s.labOnly, crewWide: s.crewWide, p: s.crewWideTest?.p ?? null },
  };
}
