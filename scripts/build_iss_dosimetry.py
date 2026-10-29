"""Collect measured ISS absorbed radiation dose from NASA OSDR study metadata.

Every GeneLab ISS study that ran a "radiation dosimetry" protocol records, for the time the
specimens were on orbit, the absorbed dose (mGy), the dose rate (mGy/day), the exposure
duration and the ISS module where the dose was measured. This script reads those values
straight from the OSDR study metadata API and groups them by mission, so the app can show
where a crew dosimeter reading sits against doses NASA actually measured aboard the ISS.

Sources, fetched live and hashed:
- OSDR search API: ISS flight studies that list a radiation dosimetry protocol.
- OSDR study metadata API (osdr.nasa.gov/osdr/data/osd/meta/<n>) for each of those studies.

Nothing is estimated or filled in. A study whose dosimetry values are missing or use other
units is reported under "skipped" with the reason. Absorbed dose (gray) is not effective
dose (sievert), so no comparison with sievert-based career limits is made here.
"""
import hashlib
import json
import math
import re
from collections import defaultdict
from datetime import date
from pathlib import Path
from statistics import median
from urllib.parse import urlencode
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / '.artifacts' / 'nasa-data' / 'osdr-meta'
OUT = ROOT / 'public' / 'data' / 'iss-dosimetry.json'
OSDR = 'https://osdr.nasa.gov'
SEARCH = OSDR + '/osdr/data/search?' + urlencode({
    'type': 'cgene', 'size': 500, 'ffield': 'Flight Program',
    'fvalue': 'International Space Station (ISS)'})
PARAMETERS = {
    'absorbed radiation dose': ('dose_mGy', 'milligray'),
    'absorbed radiation dose rate': ('rate_mGy_per_day', 'milligray per day'),
    'exposure duration': ('days', 'day'),
    'vehicle': ('location', None),
}
LOCATIONS = {'ISS-US Lab': 'ISS-US Laboratory'}


def fetch(url, cache_name=None):
    path = CACHE / cache_name if cache_name else None
    if path and path.exists():
        return path.read_bytes()
    with urlopen(url, timeout=180) as response:
        data = response.read()
    if path:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    return data


def number(raw):
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return None
    return value if math.isfinite(value) and value >= 0 else None


def annotation(value):
    return value.get('annotationValue') if isinstance(value, dict) else value


def dosimetry_rows(accession, meta):
    study = meta['study'][accession]
    units = {}
    for part in study['studies']:
        for unit in part.get('unitCategories', []):
            units[unit['@id']] = unit.get('annotationValue')
    rows = []
    for part in study['studies']:
        protocols = {p['@id']: p for p in part['protocols']}
        names = {}
        for protocol in part['protocols']:
            if protocol['name'].strip().lower() == 'radiation dosimetry':
                for parameter in protocol.get('parameters', []):
                    names[parameter['@id']] = parameter['parameterName']['annotationValue'].strip().lower()
        for process in part.get('processSequence', []):
            protocol = protocols.get(process.get('executesProtocol', {}).get('@id'))
            if not protocol or protocol['name'].strip().lower() != 'radiation dosimetry':
                continue
            row, problems = {}, []
            for value in process.get('parameterValues', []):
                name = names.get(value['category']['@id'])
                if name not in PARAMETERS:
                    continue
                key, unit = PARAMETERS[name]
                if unit is None:
                    row[key] = annotation(value['value'])
                    continue
                found = units.get((value.get('unit') or {}).get('@id'))
                if found != unit:
                    problems.append(f'{name} unit is {found!r}, expected {unit!r}')
                    continue
                row[key] = number(value['value'])
            rows.append((row, problems))
    return rows


def mission_dates(source):
    mission = source.get('Mission') or {}
    return {'flight': mission.get('Name', '').strip(), 'start': mission.get('Start Date', '').strip(),
            'end': mission.get('End Date', '').strip()}


def main():
    search_bytes = fetch(SEARCH)
    hits = json.loads(search_bytes)['hits']['hits']
    studies = sorted((h['_source'] for h in hits
                      if 'radiation dosimetry' in json.dumps(h['_source'].get('Study Protocol Name', '')).lower()),
                     key=lambda s: int(s['Accession'].split('-')[1]))
    measurements, skipped, sources = [], [], []
    for source in studies:
        accession = source['Accession']
        number_part = accession.split('-')[1]
        url = f'{OSDR}/osdr/data/osd/meta/{number_part}'
        raw = fetch(url, f'{accession}.json')
        sources.append({'accession': accession, 'url': url, 'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw)})
        meta = json.loads(raw)
        found = dosimetry_rows(accession, meta)
        reasons = []
        for row, problems in found:
            if problems:
                reasons.extend(problems)
                continue
            if row.get('dose_mGy') is None or row.get('rate_mGy_per_day') is None or not row.get('days'):
                reasons.append('dose, dose rate or duration missing')
                continue
            measurements.append({
                'accession': accession,
                'project': (source.get('Project Identifier') or '').strip() or None,
                **mission_dates(source),
                'location': row.get('location'),
                'days': row['days'],
                'dose_mGy': row['dose_mGy'],
                'rate_mGy_per_day': row['rate_mGy_per_day'],
                'title': meta['study'][accession]['studies'][0]['title'].strip(),
            })
        # A study often repeats its dosimetry row without units; only report studies with no usable row.
        if not any(m['accession'] == accession for m in measurements):
            reason = '; '.join(sorted(set(reasons))) or 'dosimetry protocol listed but no values recorded'
            skipped.append({'accession': accession, 'reason': reason})

    # Many studies reuse the same mission dosimetry: keep one row per distinct measurement.
    distinct = defaultdict(list)
    for m in measurements:
        location = LOCATIONS.get(m['location'], m['location'])
        distinct[(location, m['days'], m['dose_mGy'], m['rate_mGy_per_day'])].append(m)
    missions, flagged = [], []
    for (location, days, dose, rate), group in distinct.items():
        single = sorted((m for m in group if len(m['flight'].split()) == 1), key=lambda m: m['flight']) or group
        row = {'flight': single[0]['flight'], 'projects': sorted({m['project'] for m in single if m['project']}),
               'start': single[0]['start'], 'end': single[0]['end'], 'location': location, 'days': days,
               'dose_mGy': dose, 'rate_mGy_per_day': rate,
               'studies': sorted({m['accession'] for m in group}, key=lambda a: int(a.split('-')[1]))}
        # dose / rate should give the exposure duration; OSDR durations are whole days.
        implied = dose / rate if rate else math.inf
        if abs(implied - days) > 1:
            flagged.append({**row, 'reason': f'dose / rate = {implied:.1f} days but duration says {days:g}; left out of the summary'})
        else:
            missions.append(row)
    missions.sort(key=lambda m: (m['rate_mGy_per_day'], m['flight'], m['days']))
    rates = [m['rate_mGy_per_day'] for m in missions]
    flights = sorted({f for m in missions for f in m['flight'].split()}, key=lambda f: int(f.split('-')[1]))
    years = sorted(int(m['start'].replace('-', '/').split('/')[-1][-2:]) for m in missions)
    output = {
        'schema': 'astrobone-iss-dosimetry-v1',
        'built': date.today().isoformat(),
        'measure': 'Absorbed dose measured by ISS area dosimeters during each payload\'s time on orbit, as recorded in NASA OSDR study metadata.',
        'summary': {'measurements': len(missions), 'flights': flights,
                    'years': [2000 + years[0], 2000 + years[-1]],
                    'studies': len({a for m in missions for a in m['studies']}),
                    'rate_mGy_per_day': {'min': min(rates), 'median': round(median(rates), 4), 'max': max(rates)}},
        'missions': missions,
        'flagged': flagged,
        'skipped': skipped,
        'sources': {'search': SEARCH, 'search_sha256': hashlib.sha256(search_bytes).hexdigest(), 'studies': sources,
                    'reference': 'https://www.nasa.gov/reference/osdr-environmental-data/'},
        'boundary': ('Area dosimeter readings for the ISS module that held each payload, not a personal crew dose. '
                     'Absorbed dose in milligray, not effective dose in millisievert, so no career-limit or cancer-risk '
                     'figure is derived. Shielding of the payload habitat is not taken into account.'),
    }
    OUT.write_text(json.dumps(output, indent=1) + '\n')
    print(json.dumps({'output': str(OUT), **output['summary'], 'flagged': len(flagged), 'skipped': len(skipped)}))


if __name__ == '__main__':
    main()
