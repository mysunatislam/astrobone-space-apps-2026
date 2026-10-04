"""Prepare descriptive human-assay summaries; never join them to a crew profile."""
import csv
import io
import json
import re
from collections import defaultdict
from statistics import median

from build_mission_research import CACHE, ROOT, download, number


STUDIES = [
    dict(accession='OSD-569', title='Inspiration4 complete blood count',
         file='LSDS-7_Complete_Blood_Count_CBC_TRANSFORMED.csv', tissue='whole-blood',
         metrics=[('hematocrit_value_percent', 'Hematocrit', '%'),
                  ('red_blood_cell_count_value_million_per_microliter', 'Red blood cells', 'million/uL'),
                  ('white_blood_cell_count_value_thousand_per_microliter', 'White blood cells', 'thousand/uL'),
                  ('platelet_count_value_thousand_per_microliter', 'Platelets', 'thousand/uL')],
         boundary='Short-duration Inspiration4 cohort, not a long-duration astronaut baseline. Blood counts do not measure cardiac output, oxygen saturation or diagnose disease.',
         exclusions='Hemoglobin is excluded because its source column names the unit as percent. We do not silently relabel that field or apply clinical reference ranges.'),
    dict(accession='OSD-656', title='Inspiration4 urine immune-protein panel',
         file='LSDS-64_Multiplex_urine.immune.AlamarPanel_TRANSFORMED.csv', tissue='urine',
         metrics=[('vcam1_concentration_npq', 'VCAM1', 'NPQ'),
                  ('il6_concentration_npq', 'IL6', 'NPQ'),
                  ('spp1_concentration_npq', 'SPP1', 'NPQ')],
         boundary='Exploratory urine assay context. NPQ is the reported normalized assay unit, not a mass concentration. No conversion to ng/mL, immune-health score, radiation effect or personal risk.',
         exclusions='Only explicitly named NPQ columns are used. Blank/unnamed columns and percent-normalized fields are excluded. Reported zeroes are retained, not interpreted as absence of protein; detection limits are not inferred.'),
]


def summarize(data, specification):
    reader = csv.DictReader(io.StringIO(data.decode('utf-8-sig')))
    headers = reader.fieldnames or []
    required = ['Sample Name', *(m[0] for m in specification['metrics'])]
    if any(headers.count(name) != 1 for name in required):
        raise ValueError('Required assay columns must exist exactly once')
    records = list(reader)
    seen, subjects, visits = set(), set(), set()
    groups, missing, zeros = defaultdict(list), defaultdict(int), defaultdict(int)
    pattern = rf'^(C\d+)_{re.escape(specification["tissue"])}_(L-\d+|R\+\d+)(?:_cbc)?$'
    for row in records:
        name = row['Sample Name']
        if name in seen:
            raise ValueError('Duplicate sample would bias a visit median')
        seen.add(name)
        match = re.fullmatch(pattern, name)
        if not match:
            raise ValueError(f'Unrecognized sample/visit: {name}')
        subject, visit = match.groups()
        subjects.add(subject)
        visits.add(visit)
        for field, _, _ in specification['metrics']:
            value = number(row[field])
            if value is None:
                missing[(field, visit)] += 1
            else:
                groups[(field, visit)].append(value)
                zeros[(field, visit)] += int(value == 0)
    order = sorted(visits, key=lambda v: -int(v[2:]) if v.startswith('L-') else int(v[2:]))
    metrics = []
    for field, label, unit in specification['metrics']:
        points = []
        for visit in order:
            values = groups[(field, visit)]
            points.append(dict(visit=visit, n=len(values), missing=missing[(field, visit)],
                               reportedZeros=zeros[(field, visit)],
                               median=round(median(values), 5) if values else None,
                               min=min(values) if values else None, max=max(values) if values else None))
        metrics.append(dict(field=field, label=label, unit=unit, points=points))
    return dict(records=len(records), participants=len(subjects), metrics=metrics,
                blankColumnsIgnored=headers.count(''),
                method='Median, minimum and maximum of finite source values by visit. No imputation, outlier trimming, clinical thresholds or hypothesis tests. n is available records, not independent longitudinal subjects. L = days before launch; R = days after return, not mission day.')


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    studies = []
    for spec in STUDIES:
        data, source = download(spec['accession'], spec['file'])
        studies.append(dict(accession=spec['accession'], title=spec['title'],
                            url=f'https://osdr.nasa.gov/bio/repo/data/studies/{spec["accession"]}',
                            population='Human / Inspiration4 three-day flight',
                            boundary=spec['boundary'], exclusions=spec['exclusions'],
                            sources=[source], **summarize(data, spec)))
    result = dict(schema='astrobone-extended-research-v1',
                  scope='NASA external research, not personal crew observations or a calibration cohort', studies=studies)
    path = ROOT/'public/data/mission-research-extended.json'
    path.write_text(json.dumps(result, indent=2, allow_nan=False)+'\n', encoding='utf-8')
    print(json.dumps([{k: s[k] for k in ['accession', 'records', 'participants']} for s in studies]))


if __name__ == '__main__':
    main()
