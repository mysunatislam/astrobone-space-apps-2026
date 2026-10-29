"""Bundle recent solar energetic particle (SEP) events from NASA DONKI.

A solar particle event is the space-weather case that can raise a crew's radiation dose within
hours, so the radiation panel lists the real ones NASA's Space Weather Database Of Notifications,
Knowledge, Information (DONKI, run by the Community Coordinated Modeling Center at NASA Goddard)
recorded. Each event keeps its DONKI activity ID and link; nothing is estimated.

Source, fetched live and hashed: DONKI SEP web service, first from ccmc.gsfc.nasa.gov (DONKI's
current home, no key), then the older kauai.ccmc.gsfc.nasa.gov address, else api.nasa.gov/DONKI
with NASA_API_KEY (DEMO_KEY when unset).
"""
import hashlib
import json
import os
import sys
from datetime import date, timedelta
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public' / 'data' / 'donki-sep.json'
YEARS = 3
WINDOW_DAYS = 60


def fetch(start, end):
    query = {'startDate': start, 'endDate': end}
    urls = [f'https://ccmc.gsfc.nasa.gov/DONKI/WS/get/SEP?{urlencode(query)}',
            f'https://kauai.ccmc.gsfc.nasa.gov/DONKI/WS/get/SEP?{urlencode(query)}',
            f'https://api.nasa.gov/DONKI/SEP?{urlencode({**query, "api_key": os.environ.get("NASA_API_KEY", "DEMO_KEY")})}']
    errors = []
    for url in urls:
        try:
            with urlopen(url, timeout=120) as response:
                return url.split('?')[0], response.read()
        except Exception as error:  # try the next DONKI host
            errors.append(f'{url.split("?")[0]}: {error}')
    sys.exit(f'DONKI unreachable for {start}..{end}, nothing written:\n' + '\n'.join(errors))


def fetch_all(start, end):
    """DONKI answers at most WINDOW_DAYS per request, so walk the range in windows."""
    hosts, raws, events = set(), [], []
    cursor = start
    while cursor <= end:
        stop = min(cursor + timedelta(days=WINDOW_DAYS - 1), end)
        url, raw = fetch(cursor.isoformat(), stop.isoformat())
        hosts.add(url)
        raws.append(raw)
        events += json.loads(raw or b'[]') or []
        cursor = stop + timedelta(days=1)
    return sorted(hosts), raws, events


def main():
    end = date.today()
    start = end - timedelta(days=365 * YEARS)
    hosts, raws, events = fetch_all(start, end)
    rows, seen = [], set()
    for e in events:
        if e.get('sepID') in seen:
            continue
        seen.add(e.get('sepID'))
        if not e.get('sepID') or not e.get('eventTime'):
            continue
        rows.append({
            'id': e['sepID'], 'time': e['eventTime'],
            'instruments': sorted({i.get('displayName', '').strip() for i in e.get('instruments') or [] if i.get('displayName')}),
            'linked': sorted({l['activityID'] for l in e.get('linkedEvents') or [] if l.get('activityID')}),
            'link': e.get('link'),
        })
    rows.sort(key=lambda r: r['time'])
    by_year = {}
    for r in rows:
        by_year[r['time'][:4]] = by_year.get(r['time'][:4], 0) + 1
    output = {
        'schema': 'astrobone-donki-sep-v1',
        'built': end.isoformat(),
        'window': {'start': start.isoformat(), 'end': end.isoformat()},
        'summary': {'events': len(rows), 'byYear': by_year, 'latest': rows[-1]['time'] if rows else None},
        'events': rows,
        'source': {'url': hosts[0] if len(hosts) == 1 else hosts, 'requests': len(raws),
                   'sha256': hashlib.sha256(b''.join(raws)).hexdigest(), 'bytes': sum(map(len, raws)),
                   'about': 'https://ccmc.gsfc.nasa.gov/DONKI/'},
        'boundary': ('Event times as NASA DONKI recorded them, mostly from particle detectors near Earth (e.g. GOES) or '
                     'other spacecraft. A listed event does not give any crew member\'s dose; how much it adds depends on '
                     'location, shielding and the event itself.'),
    }
    OUT.write_text(json.dumps(output, indent=1) + '\n')
    print(json.dumps({'output': str(OUT), 'source': output['source']['url'], **output['summary']}))


if __name__ == '__main__':
    main()
