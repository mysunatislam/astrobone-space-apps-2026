/** Rebuild descriptive research snapshots from pinned, unrestricted NASA CSV files. */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const studies = [
  {
    accession: 'OSD-489', title: 'RR-1 lumbar vertebra microCT',
    file: 'LSDS-15_microCT_alwoodTRANSFORMED.csv',
    sha256: '5550c593ab27b1ab6371c43d1c8552ff3830fd9a246ecea5b0d654e61cccd9b0',
    population: 'Female Mus musculus; RR-1; lumbar vertebra L4; 37 days in space',
    sampleId: 'Sample Name', groupField: 'Factor Value',
    measures: [
      ['percent_bone_volume_bvtv_percent', 'Bone volume / tissue volume', '%'],
      ['trabecular_thickness_mm', 'Trabecular thickness', 'mm'],
      ['trabecular_separation_mm', 'Trabecular spacing', 'mm'],
    ],
    expectedRecords: 37,
    boundary: 'Same RR-1 mission as OSD-804; not an independent replication. Descriptive animal group summaries only. No clinical, human bone-strength, or respiratory thresholds.',
  },
  {
    accession: 'OSD-654', title: 'Spaceflight tibia microCT table profile',
    file: 'LSDS-66_microCT_uCT_TRANSFORMED.csv',
    sha256: '43254281c99ff290eefafb80043aef912233646e1df807981fdc82845f82e0fd',
    population: 'Mus musculus; tibia; RR-9 and hindlimb-unloading investigation',
    sampleId: 'Sample Name', groupField: null,
    measures: [
      ['cortical_thickness_millimeter', 'Cortical thickness', 'mm'],
      ['trabecular_separation_millimeter', 'Trabecular spacing', 'mm'],
      ['trabecular_number_1_per_millimeter', 'Trabecular number', '1/mm'],
    ],
    expectedRecords: 25,
    boundary: 'Coverage and ranges of the supplied table only. Treatment groups are not inferred from sample-name codes. No pooled treatment comparison or countermeasure efficacy claim. Missing values are not zero.',
  },
];

function csv(text) {
  const parsed = [], row = [];
  let value = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && (char === ',' || char === '\n' || char === '\r')) {
      row.push(value); value = '';
      if (char !== ',') {
        if (row.some(v => v !== '')) parsed.push([...row]);
        row.length = 0;
        if (char === '\r' && text[i + 1] === '\n') i++;
      }
    } else value += char;
  }
  if (quoted) throw new Error('Unclosed CSV quote');
  if (value || row.length) { row.push(value); parsed.push([...row]); }
  const headers = parsed.shift().map(h => h.replace(/^\uFEFF/, ''));
  if (new Set(headers).size !== headers.length) throw new Error('Duplicate CSV header');
  return parsed.map(columns => {
    if (columns.length !== headers.length) throw new Error('CSV row/header width differs');
    return Object.fromEntries(headers.map((header, i) => [header, columns[i]]));
  });
}

const round = value => Number(value.toFixed(8));
function summarize(values, records) {
  if (!values.length) return { n: 0, missing: records, mean: null, median: null, min: null, max: null };
  const sorted = [...values].sort((a, b) => a - b), middle = sorted.length >> 1;
  return {
    n: values.length, missing: records - values.length,
    mean: round(values.reduce((a, b) => a + b, 0) / values.length),
    median: round(sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2),
    min: sorted[0], max: sorted.at(-1),
  };
}

function build(spec) {
  const bytes = readFileSync(resolve(root, 'data', spec.file));
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== spec.sha256) throw new Error(`${spec.accession}: source checksum differs; review NASA update before rebuilding`);
  const records = csv(bytes.toString('utf8'));
  if (records.length !== spec.expectedRecords) throw new Error(`${spec.accession}: unexpected record count`);
  const ids = records.map(row => row[spec.sampleId]);
  if (ids.some(id => !id) || new Set(ids).size !== ids.length) throw new Error(`${spec.accession}: blank/duplicate samples`);
  const groups = new Map();
  for (const row of records) {
    const key = spec.groupField ? row[spec.groupField] : 'All table records · mixed study groups';
    if (!key) throw new Error(`${spec.accession}: missing group label`);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const metrics = spec.measures.map(([field, label, unit]) => ({
    field, label, unit,
    groups: [...groups].map(([label, rows]) => {
      const values = [];
      for (const row of rows) {
        if (!(field in row)) throw new Error(`${spec.accession}: expected measure missing`);
        if (row[field].trim() === '') continue;
        const number = Number(row[field]);
        if (!Number.isFinite(number)) throw new Error(`${spec.accession}: non-finite measure`);
        values.push(number);
      }
      const stats = summarize(values, rows.length);
      return spec.groupField ? { label, ...stats } : { label, ...stats, mean: undefined, median: undefined };
    }),
  }));
  return {
    accession: spec.accession, title: spec.title, population: spec.population,
    url: `https://osdr.nasa.gov/bio/repo/data/studies/${spec.accession}`,
    records: records.length,
    method: spec.groupField
      ? 'Mean, median, minimum and maximum of finite source values by explicit source group. No imputation, significance tests or clinical extrapolation. n is available sample rows.'
      : 'Finite-value coverage, minimum and maximum only; source group codes are not mapped or pooled into a treatment comparison. No imputation.',
    boundary: spec.boundary,
    source: {
      file: spec.file, sha256: digest, bytes: bytes.length,
      url: `https://osdr.nasa.gov/geode-py/ws/studies/${spec.accession}/download?source=datamanager&file=${spec.file}`,
      manifestUrl: `https://visualization.osdr.nasa.gov/biodata/api/v2/dataset/${spec.accession}/file/${spec.file}/`,
      restricted: false, visible: true, accessVerifiedOn: '2026-11-01',
    },
    metrics,
  };
}

const result = {
  schema: 'astrobone-nasa-research-expansion-v1', built: '2026-11-01',
  scope: 'External NASA research; not personal crew measurements or respiratory validation data',
  studies: studies.map(build),
};
writeFileSync(resolve(root, 'public/data/nasa-research-expansion.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result.studies.map(({ accession, records, source }) => ({ accession, records, sha256: source.sha256 }))));
