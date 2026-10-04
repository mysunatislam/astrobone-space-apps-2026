// NASA life-science data decides what the daily self-check asks for, and when. Every number below is
// computed from the NASA summaries shipped in public/data (NASA OSDR / Ames Life Sciences Data
// Archive), never typed in. The data sets priority and timing only; it never sets a personal
// threshold, because mice and a four-person short flight cannot calibrate one astronaut.
export const NASA_EVIDENCE_FILES = Object.freeze({
  bone: "data/osdr-804-summary.json", research: "data/mission-research.json", extended: "data/mission-research-extended.json",
});

export async function loadNasaEvidence(base = "/") {
  const get = async path => { const response = await fetch(`${base}${path}`); if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`); return response.json(); };
  const [bone, research, extended] = await Promise.all(Object.values(NASA_EVIDENCE_FILES).map(get));
  return { bone, research, extended };
}

const pct = value => `${Math.abs(value).toFixed(1)} %`;
const median = values => { const s = [...values].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
// Visit labels: L-3 = 3 days before launch (-3), R+45 = 45 days after return (+45).
const visitDay = visit => Number(String(visit).slice(1));
const SITE_NAMES = { DistalFemur: "distal femur (just above the knee)", FemoralHead: "femoral head (hip)", FemoralNeck: "femoral neck", Vertebrae: "vertebrae (spine)", CorticalFemur: "femoral shaft" };

// Bone: rank skeletal sites by their largest spaceflight change vs ground control (OSD-804).
export function boneRule(bone) {
  const worst = new Map();
  for (const row of bone.flightVsGroundControl) if (!worst.has(row.site) || row.percentDifference < worst.get(row.site).percentDifference) worst.set(row.site, row);
  const ranked = [...worst.values()].sort((a, b) => a.percentDifference - b.percentDifference);
  const [top, second] = ranked, spine = worst.get("Vertebrae");
  return {
    id: "bone", domain: "musculoskeletal", check: "Knee movement test", cadence: "Every day, first", status: "active",
    sources: [`${bone.source.accession} · ${bone.source.alsdaId}`],
    finding: `After ${bone.study.spaceflightDurationDays} days in space, mice lost ${pct(top.percentDifference)} in the ${SITE_NAMES[top.site] ?? top.site} vs ground control, ${pct(second.percentDifference)} in the ${SITE_NAMES[second.site] ?? second.site}${spine ? `, ${pct(spine.percentDifference)} in the spine` : ""}.`,
    rule: "The legs change most, so the knee movement test comes first in every daily check.",
    values: { topSite: top.site, topPercent: top.percentDifference, ranked: ranked.map(r => [r.site, r.percentDifference]) },
  };
}

// Immune: how long crew immune markers stayed above pre-flight after return to gravity (OSD-656),
// with the blood-count change the day after return (OSD-569). The window comes from the data.
export function immuneRule(extended, { missionDay = null, returnDay = null } = {}) {
  const urine = extended.studies.find(s => s.accession === "OSD-656"), blood = extended.studies.find(s => s.accession === "OSD-569");
  const vcam = urine.metrics.find(m => /vcam1/i.test(m.field)), wbc = blood.metrics.find(m => /white_blood/i.test(m.field));
  const pre = vcam.points.filter(p => p.visit.startsWith("L")), post = vcam.points.filter(p => p.visit.startsWith("R")).sort((a, b) => visitDay(a.visit) - visitDay(b.visit));
  const baseline = median(pre.map(p => p.median)), lastPre = pre.sort((a, b) => visitDay(a.visit) - visitDay(b.visit)).at(-1);
  let windowDays = 0, recoveredVisit = null;
  for (const p of post) { if (p.median > baseline) windowDays = visitDay(p.visit); else { recoveredVisit = p; break; } }
  const peak = post.reduce((a, b) => (b.median > a.median ? b : a));
  const wbcPre = wbc.points.filter(p => p.visit.startsWith("L")).sort((a, b) => visitDay(a.visit) - visitDay(b.visit)).at(-1), wbcR1 = wbc.points.find(p => p.visit === "R+1");
  // Status for this crew member: active inside the window after a return to gravity, scheduled before it.
  let status = "on-return", cadence = `Every day for ${windowDays} days after any return to gravity`, note = null;
  if (Number.isFinite(missionDay) && Number.isFinite(returnDay)) {
    const since = missionDay - returnDay;
    if (since >= 0 && since <= windowDays) { status = "active"; cadence = `Every day · day ${since} of ${windowDays} after return to gravity`; }
    else if (since < 0) { status = "scheduled"; note = `Starts on arrival, day ${returnDay} (${-since} days from now).`; }
    else { status = "routine"; cadence = "Routine · the post-return window has passed"; }
  }
  return {
    id: "immune", domain: "immune", check: "Immune symptom checklist", cadence, status, note,
    sources: ["OSD-656 · LSDS-64", "OSD-569 · LSDS-7"],
    finding: `In the Inspiration4 crew, ${vcam.label} rose from ${lastPre.median.toFixed(2)} before launch to ${peak.median.toFixed(2)} after return and stayed above pre-flight through day ${windowDays}${recoveredVisit ? `, back by day ${visitDay(recoveredVisit.visit)}` : ""}. White blood cells fell from ${wbcPre.median} to ${wbcR1.median} the day after return.`,
    rule: `Immune signals stay raised for weeks after gravity returns, so the symptom checklist runs every day for ${windowDays} days after any landing.`,
    values: { windowDays, baseline, peak: peak.median, recoveredDay: recoveredVisit ? visitDay(recoveredVisit.visit) : null },
  };
}

// Heart and radiation: the data shows no consistent effect, so no alarm is added (OSD-435, OSD-575).
export function heartRule(research) {
  const groups = research.radiation.groups, lastMonth = Math.max(...groups.map(g => g.month));
  const atEnd = groups.filter(g => g.month === lastMonth), sham = atEnd.find(g => g.doseGy === 0), dosed = atEnd.filter(g => g.doseGy > 0);
  const low = Math.min(...dosed.map(g => g.median)), high = Math.max(...dosed.map(g => g.median));
  const doses = dosed.map(g => g.doseGy), crp = research.cardiovascular.points.filter(p => p.visit.startsWith("L")).map(p => p.median);
  const consistent = dosed.every(g => g.median < sham.median) || dosed.every(g => g.median > sham.median);
  return {
    id: "heart", domain: "cardiovascular", check: "Resting heart rate", cadence: "With every check · against her own baseline", status: consistent ? "active" : "no-alarm",
    sources: [`${research.radiation.accession} · LSDS-22`, `${research.cardiovascular.accession} · LSDS-8`],
    finding: `${lastMonth} months after ${Math.min(...doses)}–${Math.max(...doses)} Gy, mouse ejection fraction was ${low.toFixed(1)}–${high.toFixed(1)} % vs ${sham.median.toFixed(1)} % without radiation: no consistent effect. Crew CRP already ranged ${Math.min(...crp).toFixed(1)}–${Math.max(...crp).toFixed(1)} mg/L before launch.`,
    rule: consistent ? "Radiation dose raises the heart-rate check." : "The data does not support a dose alarm, so none is added. Dose is logged beside heart rate for the medical reviewer.",
    values: { lastMonth, sham: sham.median, low, high, consistent },
  };
}

export function nasaWatchPlan(evidence, context = {}) {
  return [boneRule(evidence.bone), immuneRule(evidence.extended, context), heartRule(evidence.research)];
}
