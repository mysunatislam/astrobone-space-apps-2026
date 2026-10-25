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

// Bone: which skeletal sites did spaceflight move toward bone loss (OSD-804)? Each microCT measure
// has a direction that means loss (lower bone volume fraction, wider trabecular spacing, ...). A
// site's loss score is the mean of its loss-signed Hedges g; scripts/build_osdr_summary.py tests it
// by permuting whole animals (so correlated measures from one bone count once) with Holm correction
// across sites. A noisy measure, or a percent of a value near zero, cannot rank a site on its own.
const SITE_NAMES_SHORT = { DistalFemur: "distal femur", FemoralHead: "femoral head", FemoralNeck: "femoral neck", Vertebrae: "spine", CorticalFemur: "femoral shaft" };
const SITE_PLACES = { DistalFemur: "distal femur above the knee", FemoralHead: "femoral head at the hip", FemoralNeck: "femoral neck", Vertebrae: "spine", CorticalFemur: "femoral shaft" };
const MEASURE_NAMES = { bone_volume_total_volume_millimeter_cubed: "bone volume fraction", connectivity_density_per_millimeter_cubed: "trabecular connectivity", trabecular_number_per_millimeter: "trabecular number", trabecular_separation_millimeter: "trabecular spacing", trabecular_thickness_millimeter: "trabecular thickness", trabecular_bone_pattern_factor: "trabecular pattern factor", cortical_thickness_millimeter: "cortical thickness", bone_area_total_area_millimeter_squared: "cortical bone area" };
const signedPct = v => `${v > 0 ? "+" : ""}${v.toFixed(0)} %`;
const ci = ([lo, hi]) => `95% CI ${signedPct(lo)} to ${signedPct(hi)}`;
const pText = p => (p < 0.001 ? "p < 0.001" : `p = ${p.toFixed(3)}`);

export function boneRule(bone) {
  const ranked = [...bone.siteTests].sort((a, b) => b.lossScore - a.lossScore);
  const supported = ranked.filter(t => t.significant), notSupported = ranked.filter(t => !t.significant);
  const legs = supported.length ? supported : ranked.slice(0, 1);
  // Headline: the largest interpretable percent loss among the supported sites' measures.
  const headline = bone.flightVsGroundControl.filter(r => legs.some(t => t.site === r.site) && r.worse && r.percentReliable && r.pValue < 0.05)
    .sort((a, b) => Math.abs(b.percentDifference) - Math.abs(a.percentDifference))[0];
  const spine = bone.flightVsGroundControl.find(r => r.site === "Vertebrae" && r.measure === "bone_volume_total_volume_millimeter_cubed");
  const spineTest = ranked.find(t => t.site === "Vertebrae");
  return {
    id: "bone", domain: "musculoskeletal", check: "Knee movement test", cadence: "Every day, first", status: "active",
    sources: [`${bone.source.accession} · ${bone.source.alsdaId}`],
    finding: `After ${bone.study.spaceflightDurationDays} days in space, mouse bone structure moved toward loss in the ${[...legs].sort((a, b) => a.pHolm - b.pHolm).map(t => `${SITE_PLACES[t.site] ?? t.site} (${pText(t.pHolm)})`).join(" and the ")}, corrected across ${ranked.length} sites.${headline ? ` ${(MEASURE_NAMES[headline.measure] ?? headline.measure).replace(/^./, c => c.toUpperCase())} in the ${SITE_NAMES_SHORT[headline.site] ?? headline.site} was ${signedPct(headline.percentDifference)} vs ground control (${ci(headline.percentCi95)}).` : ""}${spine && spineTest && !spineTest.significant ? ` The spine showed no clear change (${signedPct(spine.percentDifference)}, ${ci(spine.percentCi95)}).` : ""}`,
    rule: "The legs change most, so the knee movement test comes first in every daily check.",
    values: {
      topSite: ranked[0].site, supportedSites: supported.map(t => t.site), notSupportedSites: notSupported.map(t => t.site),
      ranked: ranked.map(t => [t.site, t.lossScore, t.pHolm]),
      headline: headline ? { site: headline.site, measure: headline.measure, percent: headline.percentDifference, ci95: headline.percentCi95 } : null,
    },
  };
}

// Immune: how long crew immune markers stayed above pre-flight after return to gravity (OSD-656),
// with the blood-count change the day after return (OSD-569). The window comes from the data.
export function immuneRule(extended, { missionDay = null, returnDay = null } = {}) {
  const urine = extended.studies.find(s => s.accession === "OSD-656"), blood = extended.studies.find(s => s.accession === "OSD-569");
  const vcam = urine.metrics.find(m => /vcam1/i.test(m.field)), wbc = blood.metrics.find(m => /white_blood/i.test(m.field));
  const pre = vcam.points.filter(p => p.visit.startsWith("L")), post = vcam.points.filter(p => p.visit.startsWith("R")).sort((a, b) => visitDay(a.visit) - visitDay(b.visit));
  // Four crew members: a post-flight value counts as raised only above every pre-flight visit
  // median, not above one chosen pre-flight visit. The same window results from the median of the
  // pre-flight visits (values.windowDaysVsMedian), so it does not hinge on that choice.
  const preMedians = pre.map(p => p.median), baseline = Math.max(...preMedians);
  const windowFor = level => { let days = 0, back = null; for (const p of post) { if (p.median > level) days = visitDay(p.visit); else { back = p; break; } } return [days, back]; };
  const [windowDays, recoveredVisit] = windowFor(baseline), [windowDaysVsMedian] = windowFor(median(preMedians));
  const raised = post.filter(p => visitDay(p.visit) <= windowDays), crew = Math.max(...vcam.points.map(p => p.n));
  const range = values => `${Math.min(...values).toFixed(2)}–${Math.max(...values).toFixed(2)}`;
  const wbcPre = wbc.points.filter(p => p.visit.startsWith("L")).map(p => p.median), wbcR1 = wbc.points.find(p => p.visit === "R+1");
  const wbcWithin = wbcR1.median >= Math.min(...wbcPre) && wbcR1.median <= Math.max(...wbcPre);
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
    finding: `In the ${crew} Inspiration4 crew members, urine ${vcam.label} after return (${range(raised.map(p => p.median))}) stayed above every pre-flight visit (${range(preMedians)}) through day ${windowDays}${recoveredVisit ? `, back by day ${visitDay(recoveredVisit.visit)}` : ""}. White blood cells the day after return (${wbcR1.median}) were ${wbcWithin ? "within" : "outside"} the pre-flight range (${Math.min(...wbcPre)}–${Math.max(...wbcPre)}). Group medians from ${crew} people, so this sets timing only.`,
    rule: `Immune signals stay raised for weeks after gravity returns, so the symptom checklist runs every day for ${windowDays} days after any landing.`,
    values: { windowDays, windowDaysVsMedian, baseline, crew, wbcWithinPreflight: wbcWithin, recoveredDay: recoveredVisit ? visitDay(recoveredVisit.visit) : null },
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
