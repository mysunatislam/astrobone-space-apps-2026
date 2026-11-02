import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { validateNasaResearchExpansion, loadNasaResearchExpansion } from './data/nasaRespiratoryEvidence.js';

const snapshot = JSON.parse(await readFile(new URL('../public/data/nasa-research-expansion.json', import.meta.url), 'utf8'));
const copy = () => structuredClone(snapshot);
const close = (a, b) => assert.ok(Math.abs(a - b) <= 5.1e-9, `${a} != ${b}`);

// An independent reader is deliberately limited to these quote-free NASA source tables.
async function sourceRows(study) {
  const bytes = await readFile(new URL(`../data/${study.source.file}`, import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), study.source.sha256, 'aggregate provenance must identify the exact original bytes');
  assert.equal(bytes.length, study.source.bytes);
  const lines = bytes.toString('utf8').trim().split(/\r?\n/);
  assert.ok(!lines.some(line => line.includes('"')), 'review CSV reader if NASA introduces quoted fields');
  const headers = lines.shift().split(',');
  return lines.map(line => Object.fromEntries(line.split(',').map((value, index) => [headers[index], value])));
}

test('NASA expansion snapshot uses the supported schema and exact public files', async () => {
  assert.equal(validateNasaResearchExpansion(snapshot), snapshot);
  assert.deepEqual(snapshot.studies.map(study => study.accession), ['OSD-489', 'OSD-654']);
  let records = 0;
  for (const study of snapshot.studies) {
    const rows = await sourceRows(study);
    assert.equal(rows.length, study.records);
    assert.equal(new Set(rows.map(row => row['Sample Name'])).size, rows.length);
    assert.equal(study.source.restricted, false);
    assert.equal(study.source.visible, true);
    records += rows.length;
  }
  assert.equal(records, 62);
});

test('OSD-489 summaries agree with actual source groups without pooling animals', async () => {
  const study = snapshot.studies.find(item => item.accession === 'OSD-489'), rows = await sourceRows(study);
  for (const metric of study.metrics) {
    for (const group of metric.groups) {
      const sourceGroup = rows.filter(row => row['Factor Value'] === group.label);
      const values = sourceGroup.filter(row => row[metric.field].trim() !== '').map(row => Number(row[metric.field])).sort((a, b) => a - b);
      assert.equal(group.n, values.length);
      assert.equal(group.missing, sourceGroup.length - values.length);
      assert.equal(group.min, values[0]);
      assert.equal(group.max, values.at(-1));
      close(group.mean, values.reduce((sum, value) => sum + value, 0) / values.length);
      const mid = values.length >> 1;
      close(group.median, values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2);
    }
  }
  const bv = study.metrics.find(metric => metric.field === 'percent_bone_volume_bvtv_percent');
  assert.equal(bv.unit, '%');
  assert.equal(bv.groups.find(group => group.label === 'Flight').n, 8);
  assert.equal(bv.groups.find(group => group.label === 'Ground Control').n, 9);
  assert.match(study.boundary, /not an independent replication/);
});

test('OSD-654 preserves a missing row and exposes coverage instead of a pooled effect', async () => {
  const study = snapshot.studies.find(item => item.accession === 'OSD-654'), rows = await sourceRows(study);
  for (const metric of study.metrics) {
    const values = rows.filter(row => row[metric.field].trim() !== '').map(row => Number(row[metric.field]));
    const group = metric.groups[0];
    assert.equal(group.n, 24);
    assert.equal(group.missing, 1);
    assert.equal(group.n, values.length);
    assert.equal(group.min, Math.min(...values));
    assert.equal(group.max, Math.max(...values));
    assert.ok(!Object.hasOwn(group, 'mean'));
    assert.ok(!Object.hasOwn(group, 'median'));
  }
  assert.equal(rows.find(row => row['Sample Name'] === 'F18').cortical_thickness_millimeter, '');
  assert.equal(study.metrics[0].groups[0].min, 0.18, 'blank value must not become a zero measurement');
});

test('NASA validator rejects malformed, inconsistent, or misleading snapshots', () => {
  const mutations = [
    value => { value.schema = 'unknown'; },
    value => { value.built = '2026-02-30'; },
    value => { value.studies.pop(); },
    value => { value.studies[1] = structuredClone(value.studies[0]); },
    value => { value.studies[0].source.restricted = true; },
    value => { value.studies[0].source.visible = false; },
    value => { value.studies[0].source.sha256 = '0'.repeat(64); },
    value => { value.studies[0].source.url = 'https://example.com/forged.csv'; },
    value => { value.studies[0].population = ''; },
    value => { value.studies[0].metrics[0].unit = 'g/cm²'; },
    value => { value.studies[0].metrics[1] = structuredClone(value.studies[0].metrics[0]); },
    value => { value.studies[0].metrics[0].groups[0].n = -1; },
    value => { value.studies[0].metrics[0].groups[0].missing = 1; },
    value => { value.studies[0].metrics[0].groups[0].mean = Infinity; },
    value => { value.studies[0].metrics[0].groups[0].mean = 1000; },
    value => { value.studies[1].metrics[0].groups[0].mean = 0.2; },
    value => { value.studies[1].metrics[0].groups[0].median = 0.2; },
    value => { value.studies[1].metrics[0].groups[0].min = 5; },
  ];
  for (const mutate of mutations) {
    const value = copy(); mutate(value);
    assert.throws(() => validateNasaResearchExpansion(value), /Invalid NASA research snapshot/);
  }
  for (const value of [null, [], 3, 'NASA']) assert.throws(() => validateNasaResearchExpansion(value), /Invalid NASA research snapshot/);
});

test('NASA snapshot loader respects a deployment subpath and validates before returning data', async () => {
  const original = globalThis.fetch;
  try {
    let requested;
    globalThis.fetch = async url => { requested = url; return { ok: true, json: async () => copy() }; };
    const result = await loadNasaResearchExpansion('/astrobone');
    assert.equal(requested, '/astrobone/data/nasa-research-expansion.json');
    assert.equal(result.studies.length, 2);
    globalThis.fetch = async () => ({ ok: false, status: 503 });
    await assert.rejects(loadNasaResearchExpansion('/'), /HTTP 503/);
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ schema: 'forged' }) });
    await assert.rejects(loadNasaResearchExpansion('/'), /unsupported schema/);
  } finally { globalThis.fetch = original; }
});
