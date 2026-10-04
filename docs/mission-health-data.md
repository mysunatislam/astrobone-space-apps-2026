# Mission Health Data: Provenance and Limits

Updated October 3, 2026. These sources are used in the local implementation, not just listed as prospective datasets. NASA source links do not imply endorsement. None validates AstroBone's clinical effectiveness.

## Three Separate Evidence Classes

1. **Personal demo record:** `src/demoMission.json` is a deliberately fictional onboard mission. Six movement, resting heart-rate and absorbed-dose observations follow Commander Alex Morgan. Day 182 contains deliberately poor movement and pulse quality. Dates are fictional archival timestamps. No NASA participant is represented by this profile.
2. **External NASA research:** real public data, reduced to research-group summaries. These are not joined to the astronaut profile, used as wearable data, or converted into personal risk predictions.
3. **External X-ray example:** a real FracAtlas radiograph and existing precomputed classifier/segmenter output. It is not astronaut imaging, not newly run inference, and not a clinical diagnosis.

## NASA Data Actually Processed

| Source | Input and transformation | Limits |
| --- | --- | --- |
| [OSD-575](https://osdr.nasa.gov/bio/repo/data/studies/OSD-575) | Inspiration4 cardiovascular serum panel: 28 observations from four people. Median raw CRP concentration at each of seven visits. pg/mL divided by 1,000,000 to mg/L. | Three-day flight. L means days before launch; R means days after return, not mission day. CRP is an inflammatory marker, not heart rate or a cardiovascular-event prediction. No clinical thresholds or long-mission extrapolation. |
| [OSD-435](https://osdr.nasa.gov/bio/repo/data/studies/OSD-435) | 1,152 cardiac echocardiography records joined by sample name to ISA metadata. Median ejection fraction grouped by recorded radiation type, absorbed dose in Gy, and time in months. 896 records retained; 256 non-scalar mixed-exposure dose records excluded and counted. | Male mice in a ground irradiation study, not human flight observations. Repeated records are not independent animals. Group medians are descriptive, not paired effects or human alert limits. Metadata units are checked. |
| [OSD-804](https://osdr.nasa.gov/bio/repo/data/studies/OSD-804) | Existing 170-record mouse bone microCT summary retained. Raw CSV re-downloaded and its SHA-256 checked against the summary. Cortical thickness group means shown with denominators. | Female mice, 37-day spaceflight. Records are not participant counts. Does not calibrate an astronaut's bone density, fracture risk, or the FracAtlas classifier. |

The builder only downloads manifest entries marked visible and unrestricted from `https://osdr.nasa.gov/`. Canonical URLs, filenames, bytes and SHA-256 checksums are bundled in `public/data/mission-research.json`. Raw files are cached under `.artifacts/nasa-data`, not redistributed in the website. No individual Inspiration4 sample names are displayed.

## Reproduce

From the project directory:

```powershell
.\.venv-companion\Scripts\python.exe scripts\build_mission_research.py
.\.venv-companion\Scripts\python.exe scripts\test_mission_research.py
node --test src/missionHealth.test.js src/missionExplanation.test.js
```

The builder requires network access to validate NASA manifests, even if files are cached. Bundled summary files require no NASA request during the presentation. Changing upstream data must trigger a source review; never silently relabel cached summaries as new data.

## Current X-Ray Evidence

`public/inference/demo/IMG0001739_prediction.json` and `IMG0001739_overlay.png` are the current saved evidence. DenseNet121 score: 0.9988876, **uncalibrated**. U-Net++ predicted mask covers approximately 0.40% of the image; this is not injury severity. The saved metadata describes a held-out test image, but the training/test split and performance have not been independently re-audited in this update. Attribution: [FracAtlas dataset paper](https://doi.org/10.1038/s41597-023-02432-4), CC BY 4.0. The overlay is an adapted image.

## Software Guardrails

- Never combine mGy absorbed dose with mSv dose equivalent without the required physical basis.
- Never turn missing data into a normal or zero reading.
- Withhold the newest low-quality pulse reading instead of silently reusing the previous reading.
- Restrict every personal comparison and export to the selected mission day.
- Compare cardiovascular readings only within the same source, device and protocol.
- Preserve severe-symptom escalation regardless of imaging availability.
- The optional tabletop event is a separate synthetic +10 mGy assumption. It does not modify stored dosimeter data or generate biological effects. It resets when the selected person or day changes.
- No fake LLM trace: the demo identifies its actual deterministic review steps. Optional local AI remains under Advanced analysis.

Clinical validation, independent motion-angle accuracy, astronaut trials and real-sensor authentication remain unfinished research work.
