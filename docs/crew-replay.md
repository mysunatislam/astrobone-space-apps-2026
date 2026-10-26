# The self-check rule, replayed on real Inspiration4 crew blood

AstroBone judges every check against the person's own earlier checks: a day rule (outside two
personal SDs or a review floor) and a CUSUM drift rule against a locked starting baseline
(`src/selfCheck.js`). Until now that rule had only been tested on synthetic data. This page
reports what it does on the one public spaceflight data set with repeated measurements of the
same people: the four Inspiration4 crew members, three blood draws before launch (L-92, L-44,
L-3) and four after return (R+1, R+45, R+82, R+194).

## Data

| Source | What | Used as |
| --- | --- | --- |
| NASA OSDR [OSD-569](https://osdr.nasa.gov/bio/repo/data/studies/OSD-569) · LSDS-7, raw `SUBMITTED` file | Complete blood count per crew member per draw (Quest Diagnostics) | 14 measures: white cells and five absolute subtypes, red cells, hemoglobin, hematocrit, MCV, MCH, MCHC, platelets, MPV |
| NASA OSDR [OSD-575](https://osdr.nasa.gov/bio/repo/data/studies/OSD-575) · LSDS-8, raw `SUBMITTED` files | Comprehensive metabolic panel; serum multiplex (Eve Technologies) | 13 metabolic measures; CRP, fibrinogen, haptoglobin, IL-6, TNF-α as an exploratory set |
| [EFLM Biological Variation Database](https://biologicalvariation.eu/), meta-analysed CVI | Within-person biological variation for each measure | The review floor (reference change value) |

`scripts/build_crew_blood.py` (`npm run data:crew`) downloads the files from the live OSDR and
EFLM APIs, refuses restricted files, records each file's SHA-256 and writes
`public/data/i4-crew-blood.json` (30 KB). Crew codes stay as NASA published them; sex, which only
the lab's printed reference ranges depend on, is not copied.

## Method

`src/crewReplay.js` feeds each person's draws to the app's unchanged `evaluateIndicator`, in
order, so every result is judged only against what came before it (a test checks that changing a
later draw never changes an earlier verdict).

- **Review floor = reference change value (RCV).** For a knee the floor is a fixed number of
  degrees. For blood it is the smallest change between two results of one person that biology and
  a desirable-quality assay rarely produce by chance: RCV = 1.96 × √2 × √(CVI² + (CVI/2)²), with
  CVI from the EFLM meta-analysis and analytical CV at the EFLM desirable limit of half the CVI
  (Fraser, Ann Clin Biochem 2011). Example: white cells CVI 11.1 % → RCV 34.4 %; sodium CVI
  0.54 % → RCV 1.7 %.
- **Day rule:** tolerance = max(2 SD of the last five draws, RCV × pre-flight mean), both directions.
- **Drift rule:** CUSUM with k = 1, h = 6 (as in the app) against a baseline locked to the
  three pre-flight draws (`baselineCount`, a new option; the app default is unchanged).
- A measure with fewer than three usable pre-flight draws is never judged.
- **Crew-wide check (new):** a change in at least three quarters of the judged crew, in the same
  direction, at the same draw. A crew-wide change that is gone by the next draw points at that
  draw's handling before biology.
- **Shuffle test:** each person's post-flight flags are shuffled across their own four visits
  (keeping how often each person and measure flags) 2,000 times, seeded, and crew-wide events
  counted.
- **Population comparison:** each result is also compared with the lab's printed reference range.

## Results (27 clinical measures × 4 crew × 4 return visits = 418 judged results)

| Visit | Judged | Flagged by the personal rule |
| --- | --- | --- |
| R+1 | 105 | 10 (10 %) |
| R+45 | 104 | 11 (11 %) |
| R+82 | 105 | 4 (4 %) |
| R+194 | 104 | 6 (6 %) |

1. **Flight signal, crew-wide:** mean cell volume fell in **all four** crew the day after landing,
   by 3.4 to 5.2 % (each beyond that person's RCV of 2.5 %), and every value stayed inside the
   lab range of 80–100 fL. The population range would have shown nothing.
2. **One-draw artifact caught:** glucose fell 40–50 % in three of four crew at R+45 (36–44 mg/dL,
   below the lab range) and was back at R+82. Low glucose in several people at one draw is the
   pattern delayed serum separation produces. The app now labels such a change "check that draw's
   handling first" instead of treating it as one person's news.
3. **Shuffle test:** 2 crew-wide events observed; p = 0.06 that each person's flags falling on
   random visits would produce as many. Suggestive, not conclusive, with four people.
4. **Personal vs population:** of 31 personal flags, **23 sat inside the lab's population range**
   (the range would have missed them); 8 results **outside** the range were usual for that person
   and were not flagged (for example C004's urea 26–27 mg/dL against a pre-flight mean of 20 and a
   limit of 25).
5. **Background rate:** half a year after return the rule flagged 6 % of results, close to the 5 %
   a two-sided 95 % change limit is designed for. The R+1 and R+45 rates are about double that.
6. **Lab range switch:** the lab printed different reference ranges for C003 before and after
   flight on 8 measures (for example hemoglobin 13.2–17.1 before, 11.7–15.5 after). Any
   population-range alarm would change meaning with the paperwork; a personal baseline does not.
7. **Drift:** with three to four return draws, the CUSUM fired once on the clinical set (C003's
   MCV at R+194, −5.3 %). It is built for daily checks; sparse draws mostly exercise the day rule.
8. **Exploratory multiplex panel** (CRP, fibrinogen, haptoglobin, IL-6, TNF-α): 13 of 80 results
   flagged, several by hundreds of percent, rising at R+82 and R+194 rather than R+1. These
   research assays vary far more than clinical analysers and EFLM's clinical CVI is only an
   approximation for them, so they are reported, never headlined.

## What this does and does not show

- It shows that AstroBone's personal-baseline rule, run unchanged on real spaceflight data, finds
  a crew-wide change that population ranges hide, stays near its designed false-flag rate long
  after return, ignores values that are unusual for the population but usual for the person, and
  that the new crew-wide check separates a flight-day signal from a one-draw artifact.
- It does not show any diagnosis, any health effect, or a threshold for anyone else: four people,
  three days in orbit, seven draws each. MCV can also shift with sample age and analyser
  calibration, which the public files cannot rule out.
- Mapping to the self-check: blood is not measured daily on a mission. The point is that the same
  evaluation code generalises from camera and test indicators to any repeated measure with a known
  within-person variation.

## Reproduce

```
npm run data:crew          # refetch OSDR + EFLM and rebuild public/data/i4-crew-blood.json
node --test src/crewReplay.test.js
```
