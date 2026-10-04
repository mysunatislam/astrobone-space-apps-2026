# NASA Data Pipeline: From Raw Files to What the Astronaut Is Asked

AstroBone uses five NASA life-science datasets from the NASA Open Science Data Repository (OSDR), which serves the Ames Life Sciences Data Archive (ALSDA). The data decides **what the daily self-check asks for and when**. It never sets a personal threshold: mice and a four-person, three-day flight cannot calibrate one astronaut, so each comparison is against the astronaut's own baseline.

## 1. Raw NASA files

| Study | ALSDA file | What it is | Records |
| --- | --- | --- | --- |
| [OSD-804](https://osdr.nasa.gov/bio/repo/data/studies/OSD-804) | LSDS-130 | Bone micro-CT, female mice, 37 days in space vs ground control | 170 |
| [OSD-656](https://osdr.nasa.gov/bio/repo/data/studies/OSD-656) | LSDS-64 | Inspiration4 crew urine immune proteins, before and after flight | 22 |
| [OSD-569](https://osdr.nasa.gov/bio/repo/data/studies/OSD-569) | LSDS-7 | Inspiration4 crew complete blood count | 28 |
| [OSD-575](https://osdr.nasa.gov/bio/repo/data/studies/OSD-575) | LSDS-8 | Inspiration4 crew cardiovascular serum panel (CRP) | 28 |
| [OSD-435](https://osdr.nasa.gov/bio/repo/data/studies/OSD-435) | LSDS-22 | Mouse heart function after ground radiation, 0 to 9 months | 1,152 |

Only unrestricted, publicly visible files are used. Each script downloads its files from NASA's OSDR API and records each file's SHA-256 in the output, so anyone can check the app uses the same files.

## 2. Summaries (reproducible)

```bash
npm run data:osdr               # OSD-804 → public/data/osdr-804-summary.json
npm run data:mission            # OSD-575, OSD-435 (+ OSD-804 hash check) → public/data/mission-research.json
npm run data:mission:extended   # OSD-569, OSD-656 → public/data/mission-research-extended.json
```

- `scripts/build_osdr_summary.py`: spaceflight vs ground-control mean and percent difference for each skeletal site and measure (29 comparisons). The OSD-804 data file is kept in `data/` (CC0); rebuilding it reproduces the shipped summary byte for byte.
- `scripts/build_mission_research.py`: CRP medians per visit; ejection-fraction medians per radiation type, dose and month. Missing values are counted, never imputed.
- `scripts/build_extended_nasa_research.py`: medians, minimum and maximum per visit for blood counts and urine immune proteins.

## 3. Rules the data drives (`src/nasaWatch.js`)

Every number in these rules is computed from the summaries when the app loads, not typed in. Tests: `src/nasaWatch.test.js`.

| Rule | What the data shows | What AstroBone does |
| --- | --- | --- |
| **Knee test first, every day** | OSD-804: spaceflight mice lost 54.5 % bone volume in the distal femur (just above the knee) vs ground control, 27.4 % in the femoral head, 8.3 % in the spine. | The knee movement test comes first in every daily check. |
| **Immune checklist after landing** | OSD-656: crew VCAM1 rose from 0.33 before launch to 2.12 after return and stayed above pre-flight through day 45, back by day 82. OSD-569: white blood cells fell from 8.5 to 6.25 the day after return. | The immune symptom checklist runs every day for 45 days after any return to gravity (for Elena: from Mars arrival, day 240). The 45 days are read from the data. |
| **No radiation alarm** | OSD-435: 9 months after 0.1 to 3 Gy, mouse ejection fraction was 50.4 to 59.1 % vs 52.1 % without radiation, no consistent effect. OSD-575: crew CRP already ranged 1.9 to 19.9 mg/L before launch. | No dose-triggered heart alarm. Dose is logged beside resting heart rate for the medical reviewer. |

The self-check shows these rules on its first step ("Today's checks · set by NASA data") and the reason on each step.

## 4. Limits

- OSD-804 and OSD-435 are mice; Inspiration4 is four people on a three-day flight. They set priority and timing, never thresholds or diagnoses.
- Long-duration astronaut records in the ALSDA are restricted; access to them is listed as a next step.
- The OSD-804 data dictionary is no longer listed by NASA's file API; its previously recorded fingerprint is kept. No numbers come from it.
