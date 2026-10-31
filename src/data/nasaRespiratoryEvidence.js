// External research informs the evidence view, never a personal respiratory threshold.
// "Computed" means an aggregate is bundled; "catalogued" means metadata/context only.
export const SPACE_APPS_2026 = Object.freeze({
  registrationStatus: 'Open · NASA announcement',
  eventDates: 'November 14–15, 2026',
  startDate: '2026-11-14',
  endDate: '2026-11-15',
  verifiedOn: '2026-11-01',
  sourceUrl: 'https://science.nasa.gov/universe/nasa-welcomes-all-ages-experience-levels-for-space-apps-challenge/',
  challengeCatalogUrl: 'https://www.spaceappschallenge.org/2026/challenges/',
  challengeTitle: 'Create Health Monitoring Software for Astronauts on Space Missions',
  challengeUrl: 'https://www.spaceappschallenge.org/2026/challenges/health-monitoring-software/',
  scope: 'Gather health indicators and help astronauts evaluate their health during long-duration missions.',
  statusNote: 'Announcement verified on the date shown. Challenge title and description verified from the official indexed page; direct challenge retrieval returned HTTP 502.',
});

export const NASA_RESPIRATORY_EVIDENCE = Object.freeze([
  {
    id: 'osd804', accession: 'OSD-804', title: 'RR-1 bone microstructure', domain: 'Bone & muscle',
    population: 'Female mice · ISS · 37 days', kind: 'MicroCT / histology dataset',
    integrationStatus: 'Computed from NASA data',
    summary: 'Existing AstroBone analysis compares flight and control bone measurements across skeletal sites.',
    url: 'https://osdr.nasa.gov/bio/repo/data/studies/OSD-804', dataUrl: 'data/osdr-804-summary.json',
    limits: 'Animal research supports biological context. It cannot calibrate human bone strength or respiratory rate.',
  },
  {
    id: 'osd489', accession: 'OSD-489', title: 'RR-1 lumbar vertebra microCT', domain: 'Bone & muscle',
    population: 'Female mice · lumbar L4 · RR-1', kind: 'MicroCT dataset · 37 sample rows',
    integrationStatus: 'Computed from NASA data',
    summary: 'New reproducible descriptive group summaries of bone volume fraction, trabecular thickness and spacing from the public NASA CSV.',
    url: 'https://osdr.nasa.gov/bio/repo/data/studies/OSD-489', dataUrl: 'data/nasa-research-expansion.json',
    limits: 'Same RR-1 mission as OSD-804: not an independent mission replication. Descriptive animal summaries, with no human thresholds or respiratory inference.',
  },
  {
    id: 'osd654', accession: 'OSD-654', title: 'Spaceflight tibia microCT', domain: 'Bone & muscle',
    population: 'Mice · tibia · RR-9 / unloading research', kind: 'MicroCT dataset · 25 sample rows',
    integrationStatus: 'Computed from NASA data',
    summary: 'New local table profile reports finite-value coverage and ranges for cortical thickness, trabecular spacing and trabecular number.',
    url: 'https://osdr.nasa.gov/bio/repo/data/studies/OSD-654', dataUrl: 'data/nasa-research-expansion.json',
    limits: 'One sample has missing measurements. Group codes are not inferred from names; no pooled treatment effect or GSK3 countermeasure efficacy is claimed.',
  },
  {
    id: 'osd569', accession: 'OSD-569', title: 'Inspiration4 complete blood count', domain: 'Human physiology',
    population: '4 people · short-duration Inspiration4 flight', kind: 'Blood assay dataset',
    integrationStatus: 'Computed from NASA data',
    summary: 'Existing visit summaries show hematocrit, red cells, white cells and platelets before and after flight.',
    url: 'https://osdr.nasa.gov/bio/repo/data/studies/OSD-569', dataUrl: 'data/mission-research-extended.json',
    limits: 'Blood counts are not SpO₂, ventilation, camera pulse or respiratory reference signals. No long-duration calibration.',
  },
  {
    id: 'osd575', accession: 'OSD-575', title: 'Inspiration4 cardiovascular serum panel', domain: 'Human physiology',
    population: '4 people · short-duration Inspiration4 flight', kind: 'Serum assay dataset',
    integrationStatus: 'Computed from NASA data',
    summary: 'Existing CRP visit summaries provide external research context for the mission health workspace.',
    url: 'https://osdr.nasa.gov/bio/repo/data/studies/OSD-575', dataUrl: 'data/mission-research.json',
    limits: 'Serum proteins do not validate camera pulse, breathing estimates or clinical cardiovascular predictions.',
  },
  {
    id: 'osd656', accession: 'OSD-656', title: 'Inspiration4 urine immune proteins', domain: 'Human physiology',
    population: '4 people · short-duration Inspiration4 flight', kind: 'Urine assay dataset',
    integrationStatus: 'Computed from NASA data',
    summary: 'Existing descriptive visit summaries cover VCAM1, IL6 and SPP1 in the source assay units.',
    url: 'https://osdr.nasa.gov/bio/repo/data/studies/OSD-656', dataUrl: 'data/mission-research-extended.json',
    limits: 'Exploratory assay context; not an immune score, respiratory signal or personal diagnostic limit.',
  },
  {
    id: 'osd435', accession: 'OSD-435', title: 'Radiation and cardiac function', domain: 'Environment',
    population: 'Mice · ground radiation experiment', kind: 'Echocardiography dataset',
    integrationStatus: 'Computed from NASA data',
    summary: 'Existing summaries preserve radiation-dose and time groups alongside cardiac measures.',
    url: 'https://osdr.nasa.gov/bio/repo/data/studies/OSD-435', dataUrl: 'data/mission-research.json',
    limits: 'Animal irradiation is not an astronaut exposure-response model and does not establish respiratory-rate alerts.',
  },
  {
    id: 'iss-dosimetry', accession: 'OSDR environment', title: 'ISS payload radiation dosimetry', domain: 'Environment',
    population: 'ISS area dosimeters · multiple payloads', kind: 'Environmental measurement metadata',
    integrationStatus: 'Computed from NASA data',
    summary: 'Existing bundled measurements retain payload mission, duration and dose provenance.',
    url: 'https://www.nasa.gov/reference/osdr-environmental-data/', dataUrl: 'data/iss-dosimetry.json',
    limits: 'Area dosimeters and payload locations are not a crew member’s absorbed dose. No respiratory causation is inferred.',
  },
  {
    id: 'donki', accession: 'NASA DONKI', title: 'Solar energetic-particle event archive', domain: 'Environment',
    population: 'Space-weather observations · historical snapshot', kind: 'Space-weather event dataset',
    integrationStatus: 'Computed from NASA data',
    summary: 'Existing event archive supports mission-context exploration with an explicit snapshot window.',
    url: 'https://ccmc.gsfc.nasa.gov/tools/DONKI/', dataUrl: 'data/donki-sep.json',
    limits: 'Historical events are not live alerts, personal radiation dosimetry or a health diagnosis.',
  },
  {
    id: 'osd133', accession: 'OSD-133', title: 'Microgravity bone-cell response', domain: 'Bone & muscle',
    population: 'Medaka fish · osteoblast / osteoclast research', kind: 'Transcriptomic dataset',
    integrationStatus: 'Catalogued · not analyzed',
    summary: 'Verified NASA study metadata describes acute bone-cell transcription responses to microgravity.',
    url: 'https://osdr.nasa.gov/bio/repo/data/studies/OSD-133',
    limits: 'Metadata and a source link only. No gene-expression analysis, trained model or human calibration is included.',
  },
  {
    id: 'pulmonary-function', accession: 'NASA NLSP', title: 'Pulmonary Function System', domain: 'Respiratory',
    population: 'Human spaceflight · research instrumentation', kind: 'Hardware / measurement reference',
    integrationStatus: 'Research context',
    summary: 'NASA’s instrument record explains established respiratory and cardiovascular measurement capabilities in space.',
    url: 'https://nlsp.nasa.gov/view/lsdapub/lsda_hardware/IDP-LSDA_HARDWARE-0000000000000211',
    limits: 'A hardware record, not an open paired webcam-and-belt validation dataset. Chest motion does not measure gas exchange or lung volume.',
  },
  {
    id: 'pulmonary-microgravity', accession: 'NTRS 20040112154', title: 'Pulmonary function in microgravity', domain: 'Respiratory',
    population: 'Human physiology · Spacelab research', kind: 'NASA technical publication',
    integrationStatus: 'Research context',
    summary: 'Research context for gravity-dependent gas distribution and pulmonary physiology.',
    url: 'https://ntrs.nasa.gov/citations/20040112154',
    limits: 'A publication reference, not a breathing-rate training cohort. No respiratory camera validation is claimed.',
  },
  {
    id: 'nasa-bone', accession: 'NASA human research', title: 'Bone and mineral evaluation', domain: 'Bone & muscle',
    population: 'Human spaceflight · clinical monitoring context', kind: 'NASA program reference',
    integrationStatus: 'Research context',
    summary: 'Explains why direct skeletal measurements remain essential alongside movement and physiological observations.',
    url: 'https://www.nasa.gov/directorates/esdmd/hhp/bone-and-mineral-evaluation-and-analysis/',
    limits: 'Program context, not open individual astronaut records. Breathing motion does not measure bone loss.',
  },
]);

export const NASA_RESEARCH_EXPANSION_SCHEMA = 'astrobone-nasa-research-expansion-v1';
const EXPANSION_STUDIES = Object.freeze({
  'OSD-489': {
    file: 'LSDS-15_microCT_alwoodTRANSFORMED.csv', records: 37, bytes: 6061,
    sha256: '5550c593ab27b1ab6371c43d1c8552ff3830fd9a246ecea5b0d654e61cccd9b0',
    metrics: ['percent_bone_volume_bvtv_percent', 'trabecular_thickness_mm', 'trabecular_separation_mm'],
    units: ['%', 'mm', 'mm'], groups: ['Baseline', 'Vivarium', 'Flight', 'Ground Control'], counts: [10, 10, 8, 9],
  },
  'OSD-654': {
    file: 'LSDS-66_microCT_uCT_TRANSFORMED.csv', records: 25, bytes: 1930,
    sha256: '43254281c99ff290eefafb80043aef912233646e1df807981fdc82845f82e0fd',
    metrics: ['cortical_thickness_millimeter', 'trabecular_separation_millimeter', 'trabecular_number_1_per_millimeter'],
    units: ['mm', 'mm', '1/mm'], groups: ['All table records · mixed study groups'], counts: [25],
  },
});

/** Fail closed before rendering an unrecognized or inconsistent research snapshot. */
export function validateNasaResearchExpansion(value) {
  const require = (condition, message) => { if (!condition) throw new Error(`Invalid NASA research snapshot: ${message}`); };
  const record = input => input !== null && typeof input === 'object' && !Array.isArray(input);
  const text = input => typeof input === 'string' && input.trim().length > 0;
  const integer = input => Number.isSafeInteger(input) && input >= 0;
  const date = input => typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input) && !Number.isNaN(Date.parse(`${input}T00:00:00Z`)) && new Date(`${input}T00:00:00Z`).toISOString().slice(0, 10) === input;
  require(record(value) && value.schema === NASA_RESEARCH_EXPANSION_SCHEMA, 'unsupported schema');
  require(date(value.built) && text(value.scope), 'missing build date or scope');
  require(Array.isArray(value.studies) && value.studies.length === 2, 'expected two supported studies');
  const seenStudies = new Set();
  for (const study of value.studies) {
    require(record(study) && Object.hasOwn(EXPANSION_STUDIES, study.accession), 'unrecognized study');
    require(!seenStudies.has(study.accession), 'duplicate study'); seenStudies.add(study.accession);
    const expected = EXPANSION_STUDIES[study.accession];
    require(['title', 'population', 'method', 'boundary'].every(key => text(study[key])), 'missing study population, method or boundary');
    require(study.records === expected.records, 'unexpected source record count');
    require(study.url === `https://osdr.nasa.gov/bio/repo/data/studies/${study.accession}`, 'unexpected study URL');
    const source = study.source;
    require(record(source) && source.file === expected.file && source.sha256 === expected.sha256, 'source file or checksum differs');
    require(source.bytes === expected.bytes && source.restricted === false && source.visible === true && date(source.accessVerifiedOn), 'incomplete public-source provenance');
    require(source.url === `https://osdr.nasa.gov/geode-py/ws/studies/${study.accession}/download?source=datamanager&file=${expected.file}`, 'unexpected NASA download URL');
    require(source.manifestUrl === `https://visualization.osdr.nasa.gov/biodata/api/v2/dataset/${study.accession}/file/${expected.file}/`, 'unexpected NASA manifest URL');
    require(Array.isArray(study.metrics) && study.metrics.length === expected.metrics.length, 'missing metrics');
    const seenMetrics = new Set(), groupCounts = new Map();
    for (const metric of study.metrics) {
      require(record(metric) && expected.metrics.includes(metric.field) && !seenMetrics.has(metric.field), 'unrecognized or duplicate metric');
      seenMetrics.add(metric.field);
      require(text(metric.label) && metric.unit === expected.units[expected.metrics.indexOf(metric.field)], 'metric label or unit differs');
      require(Array.isArray(metric.groups) && metric.groups.length === expected.groups.length, 'missing groups');
      const seenGroups = new Set(); let total = 0;
      for (const group of metric.groups) {
        require(record(group) && expected.groups.includes(group.label) && !seenGroups.has(group.label), 'unrecognized or duplicate group');
        seenGroups.add(group.label);
        require(integer(group.n) && integer(group.missing) && group.n + group.missing > 0, 'invalid group count');
        const count = group.n + group.missing; total += count;
        require(count === expected.counts[expected.groups.indexOf(group.label)], 'source group count differs');
        if (groupCounts.has(group.label)) require(groupCounts.get(group.label) === count, 'group counts differ across metrics');
        else groupCounts.set(group.label, count);
        if (group.n === 0) {
          require(group.min === null && group.max === null, 'empty group has measurements');
        } else {
          require(Number.isFinite(group.min) && Number.isFinite(group.max) && group.min <= group.max, 'invalid finite range');
        }
        if (study.accession === 'OSD-654') {
          require(!Object.hasOwn(group, 'mean') && !Object.hasOwn(group, 'median'), 'mixed treatment groups must not have pooled means');
        } else {
          for (const aggregate of ['mean', 'median']) {
            require(group.n ? Number.isFinite(group[aggregate]) && group[aggregate] >= group.min && group[aggregate] <= group.max : group[aggregate] === null, 'aggregate outside available source range');
          }
        }
      }
      require(total === study.records, 'group counts do not sum to source records');
    }
  }
  return value;
}

export async function loadNasaResearchExpansion(base = '/') {
  const normalized = base.endsWith('/') ? base : `${base}/`;
  const response = await fetch(`${normalized}data/nasa-research-expansion.json`);
  if (!response.ok) throw new Error(`NASA research snapshot: HTTP ${response.status}`);
  return validateNasaResearchExpansion(await response.json());
}
