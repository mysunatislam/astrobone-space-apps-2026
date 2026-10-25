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
npm run data:crew               # OSD-569, OSD-575 raw per-crew files + EFLM CVI → public/data/i4-crew-blood.json (see crew-replay.md)
```

- `scripts/build_osdr_summary.py`: spaceflight vs ground-control mean and percent difference for each skeletal site and measure (29 comparisons), with SDs, a 95% bootstrap interval for the percent change, Hedges g with a 95% interval, a Welch t-test and Benjamini–Hochberg q-values. Each measure is marked with the direction that means bone loss (Bouxsein et al., J Bone Miner Res 2010). Per site, a loss score (mean loss-signed Hedges g) is tested by 20,000 seeded permutations of whole animals, which keeps the correlation between measures from the same bone, with Holm correction across the 5 sites. A percent change is marked unreliable when control values straddle zero (femoral head pattern factor, shown before as +756 %). The CSV fingerprint is computed on NASA's CRLF form, so a git checkout with LF line endings still matches. The OSD-804 data file is kept in `data/` (CC0); rebuilding it reproduces the shipped summary byte for byte.
- `scripts/build_mission_research.py`: CRP medians per visit; ejection-fraction medians per radiation type, dose and month. Missing values are counted, never imputed.
- `scripts/build_extended_nasa_research.py`: medians, minimum and maximum per visit for blood counts and urine immune proteins.

## 3. Rules the data drives (`src/nasaWatch.js`)

Every number in these rules is computed from the summaries when the app loads, not typed in. Tests: `src/nasaWatch.test.js`.

| Rule | What the data shows | What AstroBone does |
| --- | --- | --- |
| **Knee test first, every day** | OSD-804: bone structure moved toward loss in the distal femur above the knee (p = 0.004) and the femoral head at the hip (p = 0.007), corrected across 5 sites; bone volume fraction above the knee −55 % (95% CI −68 to −30 %). The spine showed no clear change (−7 %, 95% CI −19 to +8 %). No single measure survives correction for all 29 tests on its own (4–10 mice per group), so the site-level test is the claim. | The knee movement test comes first in every daily check. |
| **Immune checklist after landing** | OSD-656: crew VCAM1 after return (2.04–2.12) stayed above every pre-flight visit median (0.33–1.60) through day 45, back by day 82; the same window results from the median of the pre-flight visits. OSD-569: white blood cells the day after return (6.25) were within the pre-flight range (5.95–8.5), so they are not cited as a change. Group medians of 4 people. | The immune symptom checklist runs every day for 45 days after any return to gravity (for Elena: from Mars arrival, day 240). The 45 days are read from the data. |
| **No radiation alarm** | OSD-435: 9 months after 0.1 to 3 Gy, mouse ejection fraction was 50.4 to 59.1 % vs 52.1 % without radiation, no consistent effect. OSD-575: crew CRP already ranged 1.9 to 19.9 mg/L before launch. | No dose-triggered heart alarm. Dose is logged beside resting heart rate for the medical reviewer. |

The self-check shows these rules on its first step ("Today's checks · set by NASA data") and the reason on each step.

## 4. Limits

- OSD-804 and OSD-435 are mice; Inspiration4 is four people on a three-day flight. They set priority and timing, never thresholds or diagnoses.
- Long-duration astronaut records in the ALSDA are restricted; access to them is listed as a next step.
- The OSD-804 data dictionary is no longer listed by NASA's file API; its previously recorded fingerprint is kept. No numbers come from it.
