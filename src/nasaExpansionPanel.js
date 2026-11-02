import './nasaExpansionPanel.css';
import { loadNasaResearchExpansion, validateNasaResearchExpansion } from './data/nasaRespiratoryEvidence.js';

const element = (tag, text, className = '') => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};
const number = value => value === null ? 'Unavailable' : Number(value.toFixed(3)).toLocaleString('en-US');
function link(text, url) {
  const node = element('a', text); node.href = url;
  node.target = '_blank'; node.rel = 'noopener noreferrer';
  return node;
}
function provenance(study) {
  const details = element('details', undefined, 'ab-expansion-provenance');
  const links = element('div', undefined, 'ab-expansion-links');
  links.append(link('NASA study ↗', study.url), link('Original NASA CSV ↗', study.source.url), link('Public-file record ↗', study.source.manifestUrl));
  const digest = element('code', study.source.sha256);
  details.append(element('summary', 'Source, method & checksum'), links,
    element('p', study.source.file), element('p', `${study.source.bytes.toLocaleString('en-US')} bytes · public access verified ${study.source.accessVerifiedOn}`),
    element('p', study.method), element('span', 'SHA-256', 'ab-expansion-hash-label'), digest);
  return details;
}
function table(headers, rows, caption) {
  const wrapper = element('div', undefined, 'ab-expansion-table-wrap');
  const result = element('table'); result.append(element('caption', caption));
  const thead = element('thead'), top = element('tr');
  for (const header of headers) { const cell = element('th', header); cell.scope = 'col'; top.append(cell); }
  thead.append(top); result.append(thead);
  const tbody = element('tbody');
  for (const row of rows) {
    const tr = element('tr');
    row.forEach((value, index) => {
      const td = element(index === 0 ? 'th' : 'td', value);
      if (index === 0) td.scope = 'row';
      tr.append(td);
    });
    tbody.append(tr);
  }
  result.append(tbody); wrapper.append(result); return wrapper;
}
function studyHeader(study) {
  const article = element('article', undefined, 'ab-expansion-study');
  article.append(element('span', `${study.accession} / ${study.records} SOURCE ROWS`, 'ab-expansion-kicker'),
    element('h4', study.title), element('p', study.population, 'ab-expansion-population'));
  return article;
}
function renderData(container, snapshot) {
  const shell = element('section', undefined, 'ab-nasa-expansion');
  const heading = element('div', undefined, 'ab-expansion-heading');
  heading.append(element('div'));
  heading.firstChild.append(element('span', 'NEW / COMPUTED NASA DATA', 'ab-expansion-kicker'), element('h3', 'From source file to visible evidence.'));
  heading.append(element('span', `${snapshot.studies.reduce((sum, study) => sum + study.records, 0)} source rows`, 'ab-expansion-count'));
  shell.append(heading, element('p', 'Two public animal-research tables, summarized locally. These results are separate from your camera observations.', 'ab-expansion-intro'));
  const grid = element('div', undefined, 'ab-expansion-grid');
  const lumbar = snapshot.studies.find(study => study.accession === 'OSD-489');
  const bv = lumbar.metrics.find(metric => metric.field === 'percent_bone_volume_bvtv_percent');
  const first = studyHeader(lumbar);
  first.append(element('p', 'Bone volume / tissue volume · descriptive group mean (%)', 'ab-expansion-chart-title'));
  const chart = element('div', undefined, 'ab-expansion-bars'); chart.setAttribute('aria-hidden', 'true');
  const scale = Math.ceil(Math.max(...bv.groups.map(group => group.max)) / 5) * 5;
  for (const group of bv.groups) {
    const row = element('div', undefined, `ab-expansion-bar${group.label === 'Flight' ? ' is-flight' : ''}`);
    row.append(element('span', group.label));
    const track = element('div', undefined, 'ab-expansion-track'), bar = element('i');
    bar.style.width = `${100 * group.mean / scale}%`; track.append(bar);
    row.append(track, element('b', `${number(group.mean)}%`)); chart.append(row);
  }
  first.append(chart, table(['Group', 'n', 'Mean (%)', 'Range (%)'], bv.groups.map(group => [group.label, String(group.n), number(group.mean), `${number(group.min)}–${number(group.max)}`]), 'Lumbar L4 microCT: bone volume / tissue volume'));
  first.append(element('p', lumbar.boundary, 'ab-expansion-boundary'), provenance(lumbar)); grid.append(first);
  const tibia = snapshot.studies.find(study => study.accession === 'OSD-654');
  const second = studyHeader(tibia);
  second.append(element('p', 'Measurement availability · no treatment comparison', 'ab-expansion-chart-title'));
  const coverage = element('div', undefined, 'ab-expansion-coverage');
  const group = tibia.metrics[0].groups[0];
  coverage.append(element('strong', `${group.n}/${tibia.records}`), element('span', 'rows with a cortical-thickness value'), element('small', `${group.missing} missing row retained`));
  second.append(coverage, table(['Measure', 'Available', 'Range'], tibia.metrics.map(metric => {
    const stats = metric.groups[0];
    return [metric.label, `${stats.n}/${tibia.records}`, `${number(stats.min)}–${number(stats.max)} ${metric.unit}`];
  }), 'Tibia microCT: finite measurements in mixed study groups'));
  second.append(element('p', tibia.boundary, 'ab-expansion-boundary'), provenance(tibia)); grid.append(second);
  shell.append(grid, element('p', `Snapshot ${snapshot.built} · No human respiratory validation or bone-loss measurement is implied.`, 'ab-expansion-footnote'));
  container.replaceChildren(shell);
}

/** Mount into an existing dialog/container. The optional loader supports isolated QA. */
export async function initNasaExpansionPanel(container, { baseUrl = import.meta.env?.BASE_URL || '/', load = loadNasaResearchExpansion } = {}) {
  if (!container || typeof container.replaceChildren !== 'function') throw new TypeError('NASA expansion panel requires a DOM container');
  const loading = element('p', 'Loading verified NASA data summaries…', 'ab-expansion-status');
  loading.setAttribute('role', 'status'); container.replaceChildren(loading);
  try {
    const snapshot = validateNasaResearchExpansion(await load(baseUrl));
    renderData(container, snapshot);
    return { status: 'ready', snapshot };
  } catch {
    const message = element('div', undefined, 'ab-expansion-status is-error');
    message.setAttribute('role', 'status');
    message.append(element('p', 'The NASA summary could not be loaded or verified. No research values are displayed.'));
    const retry = element('button', 'Retry NASA data'); retry.type = 'button';
    retry.addEventListener('click', () => { void initNasaExpansionPanel(container, { baseUrl, load }); });
    message.append(retry); container.replaceChildren(message);
    return { status: 'error' };
  }
}
