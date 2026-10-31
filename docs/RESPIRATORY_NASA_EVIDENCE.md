# Respiratory module and NASA evidence expansion

Verified on 2026-11-01. NASA research datasets and camera observations have separate roles in AstroBone. The new respiratory module estimates visible torso motion. It does not measure bone loss, tidal volume, gas exchange, oxygen saturation or a clinical pulmonary condition.

## What was added from NASA

Two additional public NASA OSDR result tables are bundled with SHA-256 provenance and a deterministic, dependency-free build script. These are actual data files, not just links to dataset landing pages.

| NASA study | Bundled raw file | Available rows | New analysis |
| --- | --- | ---: | --- |
| [OSD-489](https://osdr.nasa.gov/bio/repo/data/studies/OSD-489) | `data/LSDS-15_microCT_alwoodTRANSFORMED.csv` | 37 | Explicit source-group summaries of lumbar L4 bone volume fraction, trabecular thickness and spacing |
| [OSD-654](https://osdr.nasa.gov/bio/repo/data/studies/OSD-654) | `data/LSDS-66_microCT_uCT_TRANSFORMED.csv` | 25 | Table coverage and ranges for cortical thickness, trabecular spacing and trabecular number |

NASA's file records were checked before downloading: `restricted: false` and `visible: true`. The manifest URL, original download URL, byte count, access-check date and SHA-256 are retained in `public/data/nasa-research-expansion.json`. The script refuses an unreviewed source checksum change, duplicate sample identifiers, unexpected columns, malformed rows or non-finite numeric measurements. Empty fields remain missing.

Rebuild using:

```sh
node scripts/build_nasa_research_expansion.mjs
```

The evidence dialog displays these values through `src/nasaExpansionPanel.js`: OSD-489 has group means, ranges and sample counts for bone volume / tissue volume, while OSD-654 has coverage and ranges without pooled treatment means. Each study includes population, method, source CSV, public-file manifest and the complete checksum. The client validates the snapshot schema, supported source identities, public access flags, source record counts, units, group counts and finite aggregate ranges before displaying research values. A load or validation failure shows an unavailable state and retry action.

Run the targeted provenance and missingness checks using:

```sh
node --test src/nasaResearchExpansion.test.js
```

OSD-489 contains eight flight and nine ground-control sample rows, as well as ten baseline and ten vivarium rows. These are descriptive sample summaries, with no clinical extrapolation or added significance claim. OSD-489 and the already included OSD-804 share the RR-1 mission; they are not independent mission replications. They can address different skeletal sites, but they must not be counted as two independent validations of an astronaut model.

OSD-654 contains one sample row with blank measurements. Its sample-name prefixes are deliberately not interpreted as treatment labels. Without a reviewed sample-metadata join, the app exposes only finite-value coverage and ranges. It does not calculate a pooled intervention effect, infer GSK3 efficacy or use a mixed-group mean as a reference threshold.

## Evidence catalogue

`src/data/nasaRespiratoryEvidence.js` gives the interface a curated catalogue with a source URL, population, domain, integration status and limits for every entry:

- Computed NASA result data already in the app: OSD-804, OSD-569, OSD-575, OSD-656 and OSD-435.
- New computed data/table profiles: OSD-489 and OSD-654.
- Existing environmental snapshots: NASA OSDR ISS payload dosimetry and NASA DONKI energetic-particle events.
- Metadata only: [OSD-133 medaka bone-cell transcription](https://osdr.nasa.gov/bio/repo/data/studies/OSD-133). No omics analysis or trained model is added.
- Research context: NASA's [Pulmonary Function System record](https://nlsp.nasa.gov/view/lsdapub/lsda_hardware/IDP-LSDA_HARDWARE-0000000000000211), [microgravity pulmonary-function publication](https://ntrs.nasa.gov/citations/20040112154), and [bone and mineral program](https://www.nasa.gov/directorates/esdmd/hhp/bone-and-mineral-evaluation-and-analysis/). These are not downloadable paired webcam-and-belt validation cohorts.

The count of catalogue entries is not a count of independent datasets, validation cohorts or trained models. Literature, metadata, environmental observations, human assays and animal experiments remain distinguishable in the UI. The original NASA source attribution remains attached to all computed summaries. NASA data use does not imply agency endorsement.

The linked [OSDR API documentation](https://visualization.osdr.nasa.gov/biodata/api/) explains the structured study, assay, sample and file interfaces used for provenance. NASA's [OSDR overview](https://science.nasa.gov/biological-physical/data/osdr/) explains the archive's biological and environmental data scope.

## Respiratory validation boundary

No NASA dataset above validates a webcam breathing estimate. In particular:

- Blood counts and serum proteins do not supply respiratory rate or SpO₂ labels.
- Mouse bone microCT does not establish a human respiratory baseline.
- Environmental dosimetry is not personal dose, and solar events do not establish respiratory causation.
- A depth camera requires measured depth input from compatible hardware. A normal RGB webcam cannot provide measured depth.
- A synthetic waveform can test signal-processing implementation, but it is not a human validation result.

Before reporting clinical accuracy, collect synchronized reference-belt (or appropriate respiratory reference) and camera recordings under a consented protocol. Include posture, clothing, lighting, skin tones, partial occlusion, talking, gross body motion, camera movement, irregular breathing and signal dropout. Predefine usable/rejected captures, align clocks, keep participants disjoint across tuning and evaluation, and report acceptance rate alongside error and agreement. Until that study exists, the app must retain the label **experimental respiratory motion estimation**, reject unreliable captures and keep usable history relative to the same person's baseline.

## Verified 2026 Space Apps context

NASA's [official announcement](https://science.nasa.gov/universe/nasa-welcomes-all-ages-experience-levels-for-space-apps-challenge/) says registration is open and gives the event dates as **November 14–15, 2026**. The article was published October 15, 2026 and updated October 29, 2026. Those are event dates, not a claimed registration deadline.

The official indexed challenge page identifies [Create Health Monitoring Software for Astronauts on Space Missions](https://www.spaceappschallenge.org/2026/challenges/health-monitoring-software/). Its scope is gathering health indicators so astronauts can evaluate and act on their health during long-duration missions. AstroBone's local observations, explicit quality gates, personal history and source-based evidence browsing support that scope. Direct retrieval of the challenge page returned HTTP 502 during this session; the title and summary were verified through the indexed official page. Eligibility, submission rules and final requirements must be checked on the official site before entry.

A strong demonstration should show a successful capture, an intentionally rejected capture, the source evidence and its limits, and a human review/export flow. Visual polish and additional data improve communication; they do not substitute for measurement validation or guarantee an award.
