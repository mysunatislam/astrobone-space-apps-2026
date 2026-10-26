"""Bundle Inspiration4 per-crew blood values with published within-person variation.

AstroBone's self-check compares a person with their own earlier checks. This script prepares
the one public human data set where that can be tried on real spaceflight: the four
Inspiration4 crew (de-identified C001-C004 by NASA OSDR), each measured three times before
launch and four times after return. src/crewReplay.js then runs the app's own rule on it.

Sources, fetched live and hashed:
- NASA OSDR OSD-569 (LSDS-7) complete blood count and OSD-575 (LSDS-8) metabolic panel and
  serum multiplex panels, the raw per-sample SUBMITTED files.
- EFLM Biological Variation Database meta-analysed within-subject variation (CVI) per analyte,
  which sets the smallest change worth a review (reference change value, RCV).

Crew codes stay as NASA published them. No attempt is made to link a code to a person, and
sex (used only by the lab's own reference ranges) is not copied into the output.
"""
import csv
import hashlib
import io
import json
import math
from datetime import date
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / '.artifacts' / 'nasa-data'
OUT = ROOT / 'public' / 'data' / 'i4-crew-blood.json'
OSDR = 'https://osdr.nasa.gov'
EFLM = 'https://biologicalvariation.eu/api/meta_calculations'
VISITS = ['L-92', 'L-44', 'L-3', 'R+1', 'R+45', 'R+82', 'R+194']

# key, label, panel, source file, source analyte name, EFLM analyte id
ANALYTES = [
    ('wbc', 'White blood cells', 'CBC', 'cbc', 'WHITE BLOOD CELL COUNT', 1532),
    ('neutrophils', 'Neutrophils', 'CBC', 'cbc', 'ABSOLUTE NEUTROPHILS', 1533),
    ('lymphocytes', 'Lymphocytes', 'CBC', 'cbc', 'ABSOLUTE LYMPHOCYTES', 1534),
    ('monocytes', 'Monocytes', 'CBC', 'cbc', 'ABSOLUTE MONOCYTES', 1535),
    ('eosinophils', 'Eosinophils', 'CBC', 'cbc', 'ABSOLUTE EOSINOPHILS', 1536),
    ('basophils', 'Basophils', 'CBC', 'cbc', 'ABSOLUTE BASOPHILS', 1537),
    ('rbc', 'Red blood cells', 'CBC', 'cbc', 'RED BLOOD CELL COUNT', 1523),
    ('hemoglobin', 'Hemoglobin', 'CBC', 'cbc', 'HEMOGLOBIN', 1522),
    ('hematocrit', 'Hematocrit', 'CBC', 'cbc', 'HEMATOCRIT', 1524),
    ('mcv', 'Mean cell volume', 'CBC', 'cbc', 'MCV', 1527),
    ('mch', 'Mean cell hemoglobin', 'CBC', 'cbc', 'MCH', 1525),
    ('mchc', 'Mean cell hemoglobin concentration', 'CBC', 'cbc', 'MCHC', 1526),
    ('platelets', 'Platelets', 'CBC', 'cbc', 'PLATELET COUNT', 1538),
    ('mpv', 'Mean platelet volume', 'CBC', 'cbc', 'MPV', 1540),
    ('glucose', 'Glucose', 'CMP', 'cmp', 'GLUCOSE', 1518),
    ('urea', 'Urea nitrogen', 'CMP', 'cmp', 'UREA NITROGEN (BUN)', 1514),
    ('creatinine', 'Creatinine', 'CMP', 'cmp', 'CREATININE', 1501),
    ('sodium', 'Sodium', 'CMP', 'cmp', 'SODIUM', 1500),
    ('potassium', 'Potassium', 'CMP', 'cmp', 'POTASSIUM', 1499),
    ('chloride', 'Chloride', 'CMP', 'cmp', 'CHLORIDE', 1512),
    ('calcium', 'Calcium', 'CMP', 'cmp', 'CALCIUM', 1087),
    ('protein', 'Total protein', 'CMP', 'cmp', 'PROTEIN; TOTAL', 1554),
    ('albumin', 'Albumin', 'CMP', 'cmp', 'ALBUMIN', 1515),
    ('bilirubin', 'Bilirubin', 'CMP', 'cmp', 'BILIRUBIN; TOTAL', 540),
    ('alp', 'Alkaline phosphatase', 'CMP', 'cmp', 'ALKALINE PHOSPHATASE', 1690),
    ('ast', 'AST', 'CMP', 'cmp', 'AST', 1496),
    ('alt', 'ALT', 'CMP', 'cmp', 'ALT', 1495),
    ('crp', 'C-reactive protein', 'Serum multiplex', 'cardio', 'CRP', 1635),
    ('fibrinogen', 'Fibrinogen', 'Serum multiplex', 'cardio', 'Fibrinogen', 1655),
    ('haptoglobin', 'Haptoglobin', 'Serum multiplex', 'cardio', 'Haptoglobin', 259),
    ('il6', 'Interleukin-6', 'Serum multiplex', 'immune', 'IL-6', 1677),
    ('tnf', 'TNF-alpha', 'Serum multiplex', 'immune', 'TNFα', 1678),
]

FILES = {
    'cbc': ('OSD-569', 'LSDS-7_Complete_Blood_Count_CBC.upload_SUBMITTED.csv'),
    'cmp': ('OSD-575', 'LSDS-8_Comprehensive_Metabolic_Panel_CMP.upload_SUBMITTED.csv'),
    'cardio': ('OSD-575', 'LSDS-8_Multiplex_serum.cardiovascular.EvePanel_SUBMITTED.csv'),
    'immune': ('OSD-575', 'LSDS-8_Multiplex_serum.immune.EvePanel_SUBMITTED.csv'),
}


def fetch_json(url):
    with urlopen(Request(url, headers={'Accept': 'application/json'}), timeout=90) as response:
        return json.load(response)


def osdr_file(study, filename):
    listing = fetch_json(f'{OSDR}/osdr/data/osd/files/{study.split("-")[1]}')
    record = next(f for f in listing['studies'][study]['study_files'] if f['file_name'] == filename)
    if record['restricted'] or not record['visible']:
        raise ValueError('Only unrestricted public data may be bundled')
    url = OSDR + record['remote_url']
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / filename
    if not path.exists():
        with urlopen(url, timeout=120) as response:
            path.write_bytes(response.read())
    data = path.read_bytes()
    return data, {'study': study, 'file': filename, 'url': url, 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)}


def number(raw):
    try:
        value = float(raw)
        return value if math.isfinite(value) else None
    except (ValueError, TypeError):
        return None


def tidy(kind, data):
    """Yield (subject, visit, analyte, value, unit, low, high) from either file layout."""
    for row in csv.DictReader(io.StringIO(data.decode('utf-8-sig'))):
        if kind in ('cbc', 'cmp'):
            visit = row.get('TEST_DATE') or row.get('timepoint')
            # One C003 visit labels three red-cell analytes "... (FEMALE)"; it is the same test.
            name = row['ANALYTE'].removesuffix(' (FEMALE)').removesuffix(' (MALE)')
            yield (row['SUBJECT_ID'], visit, name, number(row['VALUE']), row['UNITS'],
                   number(row['RANGE_MIN']), number(row['RANGE_MAX']))
        else:
            yield row['ID'], row['Timepoint'], row['Analyte'], number(row['Concentration']), row['Unit'], None, None


def main():
    sources, values = [], {}
    for kind, (study, filename) in FILES.items():
        data, meta = osdr_file(study, filename)
        sources.append(meta)
        for subject, visit, analyte, value, unit, low, high in tidy(kind, data):
            if visit not in VISITS:
                raise ValueError(f'Unexpected visit {visit}')
            key = (kind, analyte, subject, visit)
            if key in values:
                raise ValueError(f'Duplicate sample {key}')
            values[key] = (value, unit, low, high)

    eflm = {row['analyte']['id']: row for row in fetch_json(EFLM)['data']}
    crew = sorted({k[2] for k in values})
    analytes, series = [], {c: {} for c in crew}
    for key, label, panel, kind, source_name, eflm_id in ANALYTES:
        cvi = next(m for m in eflm[eflm_id]['metas'] if m['var_type'] == ':cvi')
        units = {values[k][1] for k in values if k[0] == kind and k[1] == source_name}
        if len(units) != 1:
            raise ValueError(f'{source_name}: expected one unit, got {units}')
        cvi_pct = round(float(cvi['median']), 2)
        # RCV for one later result against a baseline (Fraser, Ann Clin Biochem 2011), two-sided
        # 95 %, with analytical CV at the EFLM "desirable" limit of half the CVI.
        rcv_pct = round(math.sqrt(2) * 1.96 * math.sqrt(cvi_pct ** 2 + (cvi_pct / 2) ** 2), 1)
        analytes.append({'key': key, 'label': label, 'panel': panel, 'unit': units.pop(), 'source': FILES[kind][0],
                         'eflm': {'id': eflm_id, 'name': eflm[eflm_id]['analyte']['display_name'].strip(),
                                  'matrix': cvi['matrix']['matrix_expansion'], 'cviPct': cvi_pct, 'studies': cvi['number_used']},
                         'rcvPct': rcv_pct})
        for subject in crew:
            points = []
            for visit in VISITS:
                value, _, low, high = values.get((kind, source_name, subject, visit), (None, None, None, None))
                points.append([visit, value, low, high] if low is not None or high is not None else [visit, value])
            series[subject][key] = points

    OUT.write_text(json.dumps({
        'schema': 'astrobone-i4-crew-blood-v1',
        'built': date.today().isoformat(),
        'visits': VISITS,
        'crew': crew,
        'analytes': analytes,
        'series': series,
        'sources': sources,
        'variation': {'url': EFLM, 'name': 'EFLM Biological Variation Database, meta-analysed CVI',
                      'rcv': 'RCV % = sqrt(2) x 1.96 x sqrt(CVI^2 + (CVI/2)^2)'},
        'boundary': 'Four people on a three-day flight. Each value is compared only with the same person; '
                    'nothing here diagnoses disease or calibrates a threshold for anyone else. Multiplex '
                    'serum assays differ from clinical analysers, so their EFLM variation is an approximation.',
        'pointFormat': '[visit, value, labRangeLow, labRangeHigh] (range only where the lab reported one)',
    }, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    print(f'Wrote {OUT.relative_to(ROOT)}: {len(crew)} crew x {len(analytes)} analytes x {len(VISITS)} visits')


if __name__ == '__main__':
    main()
