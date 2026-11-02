import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { healthEvidenceFor, humanContextTable } from './healthEvidenceData.js';
const read = file => JSON.parse(readFileSync(new URL('../public/data/' + file, import.meta.url)));
test('Every supported indicator explains a NASA hazard and identifies population and integration status', () => {
  for (const key of ['kneeExtension','kneeRom','restingHr','systolicBp','diastolicBp','spo2','sleepHours','mood','fatigue','stress','pvtSpeed','pvtLapses','bodyTemp','glucose','respiratory']) {
    const info = healthEvidenceFor(key); assert.ok(info.hazards.length); assert.ok(info.limits);
    for (const source of info.sources) { assert.ok(source); assert.ok(source.population); assert.ok(source.integrationStatus); assert.match(source.url, /^https:\/\//); }
  }
  assert.equal(healthEvidenceFor('made-up-indicator'), null);
});
test('Human evidence preserves source values, participant counts, assay units and temporal labels', () => {
  const cardio = humanContextTable(read('mission-research.json'), 'cardiovascular');
  assert.equal(cardio.participants, 4); assert.equal(cardio.unit, 'mg/L');
  assert.deepEqual(cardio.points[0], { visit:'L-92', n:4, median:19.8815 });
  const immune = humanContextTable(read('mission-research-extended.json'), 'immune');
  assert.equal(immune.unit,'thousand/uL'); assert.equal(immune.points.find(p=>p.visit==='R+1').median,6.25);
  assert.equal(Object.hasOwn(immune,'threshold'),false);
});
test('Human context refuses altered cohort identity, units, missingness and duplicate visits', () => {
  for (const mutate of [d=>d.cardiovascular.participants=40, d=>d.cardiovascular.unit='bpm', d=>d.cardiovascular.points[0].median=Infinity, d=>d.cardiovascular.points[0].missing=1, d=>d.cardiovascular.points.push({...d.cardiovascular.points[0]}), d=>d.cardiovascular.sources[0].restricted=true]) {
    const data=read('mission-research.json'); mutate(data); assert.throws(()=>humanContextTable(data,'cardiovascular'));
  }
});
