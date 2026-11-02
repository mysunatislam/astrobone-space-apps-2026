import { healthEvidenceFor, humanContextTable } from './healthEvidenceData.js';
import './healthEvidence.css';
const e = (tag, text, className) => { const n = document.createElement(tag); if (text != null) n.textContent = text; if (className) n.className = className; return n; };
const link = (text, href) => { const a = e('a', text); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a; };
const requests = new Map();
function getSnapshot(domain) {
  const file = domain === 'immune' ? 'mission-research-extended.json' : 'mission-research.json';
  if (!requests.has(file)) requests.set(file, fetch(import.meta.env.BASE_URL + 'data/' + file).then(r => { if (!r.ok) throw new Error('Research snapshot is unavailable.'); return r.json(); }).catch(error => { requests.delete(file); throw error; }));
  return requests.get(file);
}
export function createHealthEvidenceDetails(key) {
  const info = healthEvidenceFor(key); if (!info) return null;
  const details = e('details', null, 'health-evidence'); details.dataset.evidenceDomain = info.domain;
  details.append(e('summary', 'Why are we monitoring this?'));
  const body = e('div', null, 'health-evidence-body');
  body.append(e('h4', info.title), e('p', info.why));
  const hazards = e('p', null, 'health-evidence-hazards'); hazards.append(e('b', 'NASA hazards: '), link(info.hazards.map(h => h.name).join(' · '), 'https://www.nasa.gov/hrp/hazards/')); body.append(hazards);
  body.append(e('p', info.use), e('p', info.limits, 'health-evidence-boundary'));
  const list = e('ul');
  for (const source of info.sources) {
    const li = e('li'); li.append(link(source.accession + ' · ' + source.title, source.url), e('small', source.population + ' · ' + source.integrationStatus), e('p', source.limits)); list.append(li);
  }
  body.append(list); details.append(body);
  if (info.human) {
    const section = e('section', null, 'health-human-context'); section.setAttribute('aria-label', 'External human research, separate from your health'); body.append(section);
    let started = false;
    async function load() {
      started = true; section.replaceChildren(e('p', 'Loading external human-study summary…')); section.setAttribute('aria-busy', 'true');
      try {
        const data = humanContextTable(await getSnapshot(info.human), info.human);
        const table = e('table'); const caption = e('caption', data.accession + ' · ' + data.label + ' · 4 participants'); table.append(caption);
        const head = e('thead'), tr = e('tr'); for (const text of ['Visit', 'Median (' + data.unit + ')', 'Available n']) { const th = e('th', text); th.scope = 'col'; tr.append(th); } head.append(tr); table.append(head);
        const rows = e('tbody');
        for (const p of data.points) { const row = e('tr'), title = e('th', p.visit); title.scope = 'row'; row.append(title, e('td', p.median === null ? 'No data' : Number(p.median.toFixed(3)).toString()), e('td', String(p.n))); rows.append(row); }
        table.append(rows); const wrap = e('div', null, 'health-research-table'); wrap.tabIndex = 0; wrap.setAttribute('role', 'region'); wrap.setAttribute('aria-label', 'Research visit table'); wrap.append(table);
        section.replaceChildren(e('h4', 'External human research'), e('p', data.population + '. L = days before launch; R = days after return. Repeated visits are not independent participants.'), wrap, e('p', data.method), e('p', data.boundary, 'health-evidence-boundary'));
        for (const source of data.sources) { const provenance = e('details'); provenance.append(e('summary', 'Original file and checksum'), link(source.file, source.url), e('code', 'SHA-256 ' + source.sha256)); section.append(provenance); }
      } catch (error) { const retry = e('button', 'Retry research summary'); retry.type = 'button'; retry.onclick = load; section.replaceChildren(e('p', 'Research summary unavailable. The source links above remain available; your health evaluation is unchanged.'), retry); }
      finally { section.removeAttribute('aria-busy'); }
    }
    details.addEventListener('toggle', () => { if (details.open && !started) void load(); });
  }
  return details;
}
