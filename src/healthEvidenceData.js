import { NASA_RESPIRATORY_EVIDENCE } from './data/nasaRespiratoryEvidence.js';
import { HRP_HAZARDS } from './hazards.js';

export const HEALTH_CONTEXT_SOURCES = Object.freeze([
  { id: 'hrp-sleep', accession: 'NASA HRP', title: 'Sleep loss and irregular schedules', domain: 'Sleep & performance', population: 'Human spaceflight · research overview', kind: 'NASA risk reference', integrationStatus: 'Research context', url: 'https://www.nasa.gov/reference/risk-from-inadequate-sleep-and-irregular-schedules/', summary: 'Explains why sleep timing, workload and alertness belong in a daily health check.', limits: 'Research context only. This page supplies no personal alert threshold or downloaded participant dataset.', verifiedOn: '2026-11-02' },
  { id: 'hera-fatigue', accession: 'NASA Ames / HERA', title: 'Fatigue countermeasures and mission analogs', domain: 'Sleep & performance', population: 'Humans · laboratory and HERA ground analog studies', kind: 'NASA laboratory and publication reference', integrationStatus: 'Research context', url: 'https://www.nasa.gov/human-systems-integration-division/human-performance/fatigue-countermeasures-laboratory/', summary: 'Connects sleep and reaction checks to research on operational schedules and lighting during simulated missions.', limits: 'A linked research program, not an imported HERA participant dataset. Analog findings do not validate AstroBone reaction-test thresholds.', verifiedOn: '2026-11-02' },
  { id: 'hrp-nutrition', accession: 'NASA human research', title: 'Human adaptation: food and nutrition', domain: 'Nutrition & metabolism', population: 'Human spaceflight · research synthesis', kind: 'NASA nutrition publication reference', integrationStatus: 'Research context', url: 'https://www.nasa.gov/directorates/esdmd/hhp/human-adaptation-to-spaceflight-the-role-of-food-and-nutrition/', summary: 'Explains the role of food systems and nutrition in maintaining health during exploration missions.', limits: 'A research synthesis, not a glucose reference range or an individualized nutrition prescription.', verifiedOn: '2026-11-02' },
]);

const DOMAINS = Object.freeze({
  musculoskeletal: { title: 'Movement, bone and muscle', hazards: ['gravity'], why: 'Repeated movement checks help document function while gravity changes affect the musculoskeletal system.', use: 'Compare usable movement readings with your own matching protocol. NASA bone tables provide biological context.', limits: 'Camera joint motion does not measure bone density or fracture risk. Mouse microCT values never become your personal thresholds.', sources: ['osd804', 'osd489', 'nasa-bone'] },
  cardiovascular: { title: 'Heart rate and circulation', hazards: ['gravity', 'environment'], why: 'Gravity and cabin conditions are relevant context for circulation and oxygen-related observations.', use: 'Record the instrument or camera method, then compare like-for-like usable readings. Research assays remain separate from your record.', limits: 'The four-person Inspiration4 serum study below is external context. CRP is not heart rate, blood pressure or a camera-validation reference.', sources: ['osd575', 'osd569'], human: 'cardiovascular' },
  behavioral: { title: 'Sleep, mood and attention', hazards: ['isolation'], why: 'Isolation, demanding schedules and disrupted sleep can affect how a crew member feels and performs.', use: 'Keep sleep and mood reports alongside reaction checks to help explain changes over time.', limits: 'Self-reports and a short reaction test do not diagnose a behavioral health condition. HERA is a ground analog, not an astronaut calibration cohort.', sources: ['hrp-sleep', 'hera-fatigue'] },
  immune: { title: 'Symptoms and immune context', hazards: ['environment'], why: 'Shared cabin conditions make symptom reporting relevant to crew health.', use: 'Record symptoms and temperature with their source. NASA blood and urine assays explain the wider research context.', limits: 'An external blood-count trend cannot diagnose infection or calibrate your symptom score. The same four people contribute repeated visits.', sources: ['osd569', 'osd656'], human: 'immune' },
  metabolic: { title: 'Nutrition and blood sugar', hazards: ['environment'], why: 'A fixed food system makes nutrition and measurement timing useful context for metabolic observations.', use: 'Record glucose from a suitable instrument with its units and measurement conditions.', limits: 'A webcam does not measure glucose. NASA nutrition research does not provide a personalized diet or medication plan.', sources: ['hrp-nutrition'] },
  renal: { title: 'Kidney-related research', hazards: ['gravity', 'environment'], why: 'Renal observations need their measurement method and mission context.', use: 'Explore urine research separately from your personal health observations.', limits: 'The exploratory urine proteins are not kidney-function scores or personal clinical limits.', sources: ['osd656'] },
  respiratory: { title: 'Experimental respiratory motion', hazards: ['gravity', 'environment'], why: 'Breathing-related torso motion can add physiological context when the capture is usable.', use: 'Keep the source, timestamp and quality alongside the waveform. Compare rates only within the same protocol.', limits: 'Motion quality is not clinical accuracy. Reference-device validation remains pending; breathing motion does not measure oxygen saturation, lung volume or bone loss.', sources: ['pulmonary-function', 'pulmonary-microgravity'] },
});
const ALIASES = { kneeExtension: 'musculoskeletal', kneeRom: 'musculoskeletal', restingHr: 'cardiovascular', systolicBp: 'cardiovascular', diastolicBp: 'cardiovascular', spo2: 'cardiovascular', sleepHours: 'behavioral', mood: 'behavioral', fatigue: 'behavioral', stress: 'behavioral', pvtSpeed: 'behavioral', pvtLapses: 'behavioral', bodyTemp: 'immune', glucose: 'metabolic' };
export function healthEvidenceFor(key) {
  const domain = ALIASES[key] || key, item = DOMAINS[domain];
  if (!item) return null;
  const sources = [...NASA_RESPIRATORY_EVIDENCE, ...HEALTH_CONTEXT_SOURCES];
  return { ...item, domain, sources: item.sources.map(id => sources.find(s => s.id === id)), hazards: HRP_HAZARDS.filter(h => item.hazards.includes(h.key)) };
}

// Only published aggregate rows are exposed here; never calculate a personal threshold.
export function humanContextTable(data, domain) {
  let study, metric;
  if (domain === 'cardiovascular') {
    if (data?.schema !== 'astrobone-mission-research-v1') throw new Error('Unrecognized research snapshot.');
    study = data.cardiovascular;
    if (study?.accession !== 'OSD-575' || study.metric !== 'CRP' || study.unit !== 'mg/L') throw new Error('Unexpected serum study or units.');
    metric = { label: study.metric, unit: study.unit, points: study.points };
  } else if (domain === 'immune') {
    if (data?.schema !== 'astrobone-extended-research-v1') throw new Error('Unrecognized research snapshot.');
    study = data.studies?.find(s => s.accession === 'OSD-569');
    metric = study?.metrics?.find(m => m.field === 'white_blood_cell_count_value_thousand_per_microliter');
    if (metric?.unit !== 'thousand/uL') throw new Error('Unexpected blood-count units.');
  } else return null;
  if (study?.participants !== 4 || !Array.isArray(metric.points) || !metric.points.length || !study.sources?.length || study.sources.some(s => s.restricted !== false || !/^[a-f0-9]{64}$/.test(s.sha256))) throw new Error('Missing study provenance.');
  const visits = new Set();
  for (const p of metric.points) {
    if (!/^(L-\d+|R\+\d+)$/.test(p.visit) || visits.has(p.visit) || !Number.isInteger(p.n) || p.n < 0 || p.n > 4 || (p.n === 0 ? p.median !== null : !Number.isFinite(p.median))) throw new Error('Invalid research visit.');
    if (p.missing !== undefined && (!Number.isInteger(p.missing) || p.missing < 0 || p.n + p.missing > 4)) throw new Error('Invalid missing-value count.');
    visits.add(p.visit);
  }
  return { accession: study.accession, population: study.population, participants: study.participants, label: metric.label, unit: metric.unit, points: metric.points, sources: study.sources, method: study.method, boundary: study.boundary };
}
