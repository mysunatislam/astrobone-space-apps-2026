"""Rebuild public aggregate research evidence from unrestricted NASA OSDR files."""
import csv
import hashlib
import io
import json
import math
from collections import defaultdict
from pathlib import Path
from statistics import median
from urllib.request import urlopen
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / '.artifacts' / 'nasa-data'
API = 'https://visualization.osdr.nasa.gov/biodata/api/v2/dataset'


def download(study, filename):
    manifest_url = f'{API}/{study}/file/{filename}/'
    with urlopen(manifest_url, timeout=90) as response:
        record = json.load(response)[study]['files'][filename]
    if record['metadata']['restricted'] or not record['metadata']['visible']:
        raise ValueError('Only unrestricted public data may be bundled')
    url = record['URL']
    if not url.startswith('https://osdr.nasa.gov/'):
        raise ValueError('Unexpected NASA download host')
    path = CACHE / filename
    if not path.exists():
        with urlopen(url, timeout=120) as response:
            data = response.read()
        path.write_bytes(data)
    data = path.read_bytes()
    return data, {'file': filename, 'url': url, 'sha256': hashlib.sha256(data).hexdigest(),
                  'bytes': len(data), 'restricted': False}


def rows(data, delimiter=','):
    return list(csv.DictReader(io.StringIO(data.decode('utf-8-sig')), delimiter=delimiter))


def number(raw):
    try:
        value = float(raw)
        return value if math.isfinite(value) else None
    except (ValueError, TypeError):
        return None


def cardiovascular(data):
    records = rows(data)
    groups = defaultdict(list)
    subjects = set()
    for row in records:
        subject, _, visit = row['Sample Name'].split('_')
        value = number(row['crp_concentration_picogram_per_milliliter'])
        subjects.add(subject)
        if value is not None:
            groups[visit].append(value / 1_000_000)
    visits = ['L-92', 'L-44', 'L-3', 'R+1', 'R+45', 'R+82', 'R+194']
    return {'records': len(records), 'participants': len(subjects), 'metric': 'CRP', 'unit': 'mg/L',
            'points': [{'visit': visit, 'n': len(groups[visit]), 'median': round(median(groups[visit]), 4)}
                       for visit in visits if groups[visit]],
            'method': 'Median of available raw CRP concentrations at each visit; pg/mL divided by 1,000,000 to mg/L. No imputation or clinical thresholds. L = before launch; R = after return, not mission day.',
            'boundary': 'Four people on a three-day Inspiration4 flight. This serum assay is neither a wearable heart-rate measurement nor a cardiovascular-event predictor. No long-duration extrapolation.'}


def radiation(data, metadata):
    records = rows(data)
    with ZipFile(io.BytesIO(metadata)) as archive:
        raw_samples = archive.read('s_OSD-435.txt')
        samples = rows(raw_samples, '\t')
    raw_rows = list(csv.reader(io.StringIO(raw_samples.decode('utf-8-sig')), delimiter='\t'))
    for field, unit in [('Factor Value[Absorbed Radiation Dose]', 'gray'), ('Factor Value[Time Post-Irradiation]', 'month')]:
        unit_index = raw_rows[0].index(field) + 1
        if raw_rows[0][unit_index] != 'Unit' or any(row[unit_index] != unit for row in raw_rows[1:]):
            raise ValueError('Research units differ; do not silently convert')
    by_name = {r['Sample Name']: r for r in samples}
    if len(by_name) != len(samples):
        raise ValueError('Duplicate sample provenance requires review')
    groups = defaultdict(list)
    subjects = set()
    missing = 0
    exclusions = {'nonScalarDose': 0, 'invalidTimeOrMetric': 0}
    for row in records:
        sample = by_name.get(row['sample_name'])
        if sample is None:
            raise ValueError('Every cardiac row must join to sample provenance')
        species = sample['Characteristics[Organism]']
        if species != 'Mus musculus':
            raise ValueError('Unexpected species')
        dose = number(sample['Factor Value[Absorbed Radiation Dose]'])
        month = number(sample['Factor Value[Time Post-Irradiation]'])
        fraction = number(row['ejection_fraction_percent'])
        if dose is None or month is None or fraction is None:
            missing += 1
            exclusions['nonScalarDose' if dose is None else 'invalidTimeOrMetric'] += 1
            continue
        if dose < 0 or month < 0 or not 0 <= fraction <= 100:
            raise ValueError('Research value outside the expected physical envelope')
        subjects.add(sample['Source Name'])
        groups[(sample['Factor Value[Ionizing Radiation]'], dose, month)].append(fraction)
    return {'records': len(records), 'subjects': len(subjects), 'excludedMissing': missing,
            'exclusions': exclusions,
            'exclusionReason': 'Non-scalar dose metadata is not pooled with single-dose groups. Missing or nonfinite values are counted, never imputed.',
            'metric': 'Ejection fraction', 'unit': '%',
            'groups': [{'radiation': key[0], 'doseGy': key[1], 'month': key[2], 'n': len(values),
                        'median': round(median(values), 3)} for key, values in sorted(groups.items())],
            'method': 'Join echocardiography sample_name to ISA Sample Name. Median of finite ejection_fraction_percent grouped by recorded radiation, dose in gray and months post-irradiation. Non-scalar dose records excluded and counted. Repeated observations are not independent animals. Duplicate unused diameter columns are not analyzed.',
            'boundary': 'Ground-based irradiation in male mice, not crew dosimetry or human clinical limits. Group differences cannot set an astronaut alert threshold or establish the cause of a personal change.'}


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    cardio, c_source = download('OSD-575', 'LSDS-8_Multiplex_serum_cardiovascular_EvePanel_TRANSFORMED.csv')
    heart, h_source = download('OSD-435', 'LSDS-22_Echocardiography_heart_TRANSFORMED.csv')
    meta, m_source = download('OSD-435', 'OSD-435_metadata_OSD-435-ISA.zip')
    bone = json.loads((ROOT/'public/data/osdr-804-summary.json').read_text())
    bone_data, b_source = download('OSD-804', bone['source']['dataFile'])
    if b_source['sha256'] != bone['source']['dataSha256']:
        raise ValueError('Existing bone summary hash differs from downloaded NASA source; review before publishing')
    result = {'schema': 'astrobone-mission-research-v1', 'scope': 'External research cohorts, never personal astronaut measurements',
              'cardiovascular': {'accession': 'OSD-575', 'url': 'https://osdr.nasa.gov/bio/repo/data/studies/OSD-575',
                'title': 'Inspiration4 cardiovascular serum panel', 'population': 'Human / short-duration flight', 'license': 'CC0-1.0',
                'sources': [c_source], **cardiovascular(cardio)},
              'radiation': {'accession': 'OSD-435', 'url': 'https://osdr.nasa.gov/bio/repo/data/studies/OSD-435',
                'title': 'Radiation and cardiac function', 'population': 'Mouse / ground irradiation',
                'sources': [h_source, m_source], **radiation(heart, meta)},
              'bone': {'accession': 'OSD-804', 'url': bone['source']['studyUrl'], 'title': 'Spaceflight bone microCT',
                'population': 'Mouse / spaceflight', 'records': bone['study']['sampleRecords'], 'sources': [b_source],
                'boundary': bone['useBoundary'], 'dataHashVerified': True}}
    out = ROOT/'public/data/mission-research.json'
    out.write_text(json.dumps(result, indent=2, allow_nan=False)+'\n', encoding='utf-8')
    print(json.dumps({'output': str(out), 'cardiovascularRecords': result['cardiovascular']['records'],
                      'radiationRecords': result['radiation']['records'], 'radiationGroups': len(result['radiation']['groups']),
                      'boneSourceHashVerified': True}))


if __name__ == '__main__':
    main()
