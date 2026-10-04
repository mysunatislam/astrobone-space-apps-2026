// File consistency checks, not source authentication or clinical validation.
const requireValue = (condition, message) => { if (!condition) throw new Error(message); };
const finite = Number.isFinite;
const count = n => Number.isSafeInteger(n) && n >= 0;
const hash = v => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const text = v => typeof v === "string" && v.trim().length > 0;
const list = (v, name, max = 10000) => { requireValue(Array.isArray(v) && v.length > 0 && v.length <= max, `${name}: missing or invalid rows`); return v; };
const unique = (rows, key, name) => requireValue(new Set(rows.map(key)).size === rows.length, `${name}: duplicate rows`);
function nasaSource(s, accession) {
  requireValue(s?.accession === accession && s.url === `https://osdr.nasa.gov/bio/repo/data/studies/${accession}`, "Unexpected NASA study identity");
  requireValue(text(s.title) && text(s.population) && text(s.boundary) && count(s.records) && s.records > 0, "Incomplete research context");
  for (const f of list(s.sources, "Source files", 10)) {
    requireValue(text(f.file) && hash(f.sha256) && count(f.bytes) && f.bytes > 0 && f.restricted === false, "Incomplete source-file provenance");
    let url; try { url = new URL(f.url); } catch { throw new Error("Invalid NASA source URL"); }
    requireValue(url.protocol === "https:" && url.hostname === "osdr.nasa.gov" && !url.username && !url.password &&
      url.pathname === `/geode-py/ws/studies/${accession}/download` && url.searchParams.get("file") === f.file, "Unexpected NASA download provenance");
  }
}
function visitPoints(points, maxParticipants, detailed = false) {
  list(points, "Study visits", 100); unique(points, p => p.visit, "Study visits");
  for (const p of points) {
    requireValue(typeof p.visit === "string" && /^(L-\d+|R\+\d+)$/.test(p.visit), "Unknown study visit");
    requireValue(count(p.n) && p.n <= maxParticipants, "Invalid visit sample count");
    requireValue(p.n > 0 ? finite(p.median) : p.median === null, "Missing or invalid aggregate");
    if (detailed) {
      requireValue(count(p.missing) && p.n + p.missing <= maxParticipants && count(p.reportedZeros) && p.reportedZeros <= p.n, "Invalid missing/zero counts");
      requireValue(p.n ? finite(p.min) && finite(p.max) && p.min <= p.median && p.median <= p.max : p.min === null && p.max === null, "Inconsistent aggregate range");
    }
  }
}
export function validateMissionResearch(data) {
  requireValue(data?.schema === "astrobone-mission-research-v1", "Unsupported research schema");
  const c = data.cardiovascular, r = data.radiation;
  nasaSource(c, "OSD-575"); nasaSource(r, "OSD-435"); nasaSource(data.bone, "OSD-804");
  requireValue(c.unit === "mg/L" && c.metric === "CRP" && count(c.participants) && c.participants > 0, "Unexpected serum units or metric");
  visitPoints(c.points, c.participants);
  requireValue(c.points.reduce((n,p) => n+p.n, 0) === c.records, "Serum counts do not reconcile");
  requireValue(r.unit === "%" && r.metric === "Ejection fraction", "Unexpected radiation-study units");
  list(r.groups, "Radiation groups"); unique(r.groups, p => JSON.stringify([p.radiation,p.doseGy,p.month]), "Radiation groups");
  for (const p of r.groups) requireValue(text(p.radiation) && finite(p.doseGy) && p.doseGy >= 0 && finite(p.month) && p.month >= 0 && count(p.n) && p.n > 0 && finite(p.median) && p.median >= 0 && p.median <= 100, "Invalid radiation-study aggregate");
  requireValue(count(r.excludedMissing) && count(r.exclusions?.nonScalarDose) && count(r.exclusions?.invalidTimeOrMetric) &&
    r.exclusions.nonScalarDose+r.exclusions.invalidTimeOrMetric === r.excludedMissing &&
    r.groups.reduce((n,p) => n+p.n,0)+r.excludedMissing === r.records, "Radiation counts do not reconcile");
  return data;
}
const ASSAY_UNITS = {
  "OSD-569": { hematocrit_value_percent: "%", red_blood_cell_count_value_million_per_microliter: "million/uL", white_blood_cell_count_value_thousand_per_microliter: "thousand/uL", platelet_count_value_thousand_per_microliter: "thousand/uL" },
  "OSD-656": { vcam1_concentration_npq: "NPQ", il6_concentration_npq: "NPQ", spp1_concentration_npq: "NPQ" },
};
export function validateExtendedResearch(data) {
  requireValue(data?.schema === "astrobone-extended-research-v1", "Unsupported assay schema");
  list(data.studies, "Human studies", 2); requireValue(data.studies.length === 2, "Incomplete human-study collection"); unique(data.studies, s => s.accession, "Human studies");
  for (const s of data.studies) {
    const units = ASSAY_UNITS[s.accession]; requireValue(Boolean(units), "Unsupported human study"); nasaSource(s,s.accession);
    requireValue(count(s.participants) && s.participants > 0 && text(s.method) && text(s.exclusions), "Incomplete assay context");
    list(s.metrics, "Assay metrics", 10); unique(s.metrics,m => m.field,"Assay metrics");
    requireValue(s.metrics.length === Object.keys(units).length, "Incomplete assay metrics");
    for (const m of s.metrics) {
      requireValue(Object.hasOwn(units,m.field) && m.unit === units[m.field] && text(m.label), "Unknown assay field or unit");
      visitPoints(m.points,s.participants,true);
      requireValue(m.points.reduce((n,p) => n+p.n+p.missing,0) === s.records, "Assay counts do not reconcile");
    }
  }
  return data;
}
export function validateBoneResearch(data) {
  requireValue(data?.schemaVersion === "astrobone-osdr-summary-v1" && data.source?.accession === "OSD-804", "Unsupported bone-study schema");
  requireValue(data.source.studyUrl === "https://osdr.nasa.gov/bio/repo/data/studies/OSD-804" && hash(data.source.dataSha256), "Invalid bone-source provenance");
  requireValue(count(data.study?.sampleRecords) && data.study.sampleRecords > 0 && data.study.organism === "Mus musculus", "Invalid bone population");
  list(data.flightVsGroundControl,"Bone comparisons");
  const row = data.flightVsGroundControl.find(r => r.site === "CorticalFemur" && r.measure === "cortical_thickness_millimeter");
  requireValue(row && finite(row.flightMean) && row.flightMean >= 0 && finite(row.groundMean) && row.groundMean >= 0 &&
    count(row.flightN) && row.flightN > 0 && count(row.groundN) && row.groundN > 0 && row.flightN+row.groundN <= data.study.sampleRecords, "Invalid cortical-thickness comparison");
  return data;
}
export function validateCirculationReference(data) {
  requireValue(data?.schema === "astrobone-circulation-reference-v1", "Unsupported circulation schema");
  requireValue(data.source === "https://models.physiomeproject.org/e/43/MainWindKessel.cellml" && hash(data.sourceSha256) && text(data.boundary) && text(data.method), "Incomplete model provenance");
  requireValue(data.units?.pressure === "mmHg" && data.units.volume === "mL" && data.units.flow === "mL/s" && data.units.time === "s", "Unexpected model units");
  list(data.scenarios,"Model presets",3); unique(data.scenarios,s => s.bpm,"Model presets");
  requireValue(data.scenarios.length === 3, "Incomplete model presets");
  for (const s of data.scenarios) {
    requireValue([60,75,90].includes(s.bpm) && finite(s.periodSeconds) && Math.abs(s.periodSeconds-60/s.bpm)<1e-6, "Invalid model period");
    list(s.samples,"Cycle samples",2000); requireValue(s.samples.length >= 3,"Incomplete cycle");
    const v = s.verification;
    requireValue(v?.passed === true && [v.maxRefinementDifference,v.conservedVolumeErrorMl,v.maxCycleDifference].every(n => finite(n) && n>=0) &&
      v.maxRefinementDifference < .05 && v.conservedVolumeErrorMl < 1e-4 && v.maxCycleDifference < .05, "Numerical verification failed");
    for (const [i,p] of s.samples.entries()) {
      requireValue([p.t,p.arterialPressure,p.ventricularPressure,p.atrialPressure,p.ventricularVolume,p.aorticFlow,p.mitralFlow,p.systemicFlow].every(finite), "Nonfinite or missing model sample");
      requireValue(p.ventricularVolume > 0 && p.aorticFlow >= 0 && p.mitralFlow >= 0, "Invalid volume or ideal-valve flow");
      requireValue(Math.abs(p.t-i*s.periodSeconds/(s.samples.length-1)) < 1e-5, "Model cycle timing is inconsistent");
    }
    requireValue(s.samples.some(p => p.aorticFlow > 0) && s.samples.some(p => p.mitralFlow > 0), "Incomplete filling/ejection cycle");
  }
  return data;
}
