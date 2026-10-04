# Cardiovascular Reference And NASA Research

## What Is Implemented

The mission demo's symbolic heart and invented vessel paths have been replaced
by the pinned Z-Anatomy cardiovascular atlas: 676 source structures, optimized
to a roughly 2.3 MB GLB. It shares the original musculoskeletal coordinate frame.
Heart, systemic, pulmonary and renal vessel groups remain reference anatomy.
There is no patient-specific blood-flow field or measurement of organ motion.

The **Inspect circulation model** control opens a separate, published Physiome
left-heart/Windkessel model. Its original generated equations are unchanged.
SciPy LSODA integrates 12 cycles; the last cycle is shown at 60, 75 or 90 bpm.
Only the source cycle-period parameter changes between presets. Pressure,
ventricular volume, ideal-valve flows and a pressure-volume loop are available.
Playback and phase scrubbing operate locally; playback stops when closed/hidden.

Source UnitP is 133 Pa. Export uses 133.322387415 Pa per mmHg; volume is mL and
flow is mL/s. Source constants and SHA-256 are retained with the outputs.
The maximum conserved-volume discrepancy across presets is below 3e-12 mL;
the maximum tighter-tolerance state discrepancy is below 0.0014 source units.
These are numerical checks, **not clinical or physiological validation**.
The model excludes the right heart, pulmonary circulation and environmental
adaptation. It is not fitted to Elena, the atlas, NASA studies or a pulse signal.

## Five NASA Datasets

The **NASA measurements** control exposes computed research aggregates:

| Accession | Observations used | Role |
| --- | --- | --- |
| OSD-575 | Inspiration4 serum CRP | External cardiovascular/inflammatory research |
| OSD-435 | Mouse echocardiography by radiation and time | Ground-radiation research, not a human dose limit |
| OSD-804 | Mouse femoral cortical thickness | Bone research, not personal bone density |
| OSD-569 | 28 CBC records from 4 participants | Hematocrit, RBC, WBC and platelet descriptive medians |
| OSD-656 | 22 urine records from 4 participants | VCAM1, IL6 and SPP1 in reported NPQ units |

New files were obtained through the NASA OSDR API after confirming visible,
unrestricted metadata. Canonical file URLs, source hashes, field names, units,
missing counts and methods are bundled. Raw participant records stay in the
ignored local preparation cache; only aggregates are public.
Visit labels L-/R+ mean before launch/after return, never mission day.
Whiskers are observed min-max ranges, not confidence intervals.

Hemoglobin is excluded because its source header gives an ambiguous percent
unit. NPQ values are not converted into mass concentration. Missing/nonfinite
values are counted and never imputed; reported zeroes are retained without
inferring assay detection limits. Repeated records are not independent subjects.

All five datasets appear in the evidence graph, provenance and handoff packet.
Three existing core sources still define the source-availability gate; additional
assays cannot make an incomplete core review pass. None changes the synthetic
crew readings, establishes radiation causality, or yields a disease probability.

## Reproduction

```powershell
python -m pip install -r requirements-research.txt
python scripts/build_extended_nasa_research.py
python scripts/build_circulation_reference.py
node scripts/build-cardiovascular-atlas.mjs
python -m unittest discover -s scripts -p 'test_extended_nasa_research.py'
node --test src/circulationReference.test.js src/missionResearchExplorer.test.js
node scripts/qa-cardiovascular-research.mjs
```

NASA and Physiome summaries are prepared before the demo and loaded from the
local app. This is not a live NASA crew-health API connection. See source links
and licenses in the interface and THIRD_PARTY_NOTICES.md.

## Verified In This Update

### Runtime Hardening, 2026-10-04

`missionEvidenceValidation.js` now validates artifacts before they enter the
research state. It checks expected units/fields, finite values, sample-count
reconciliation, missing-data conventions, unique visits/groups, source identity
and unrestricted-file metadata. Model checks also require complete presets,
ordered uniformly spaced cycle samples, finite pressures/volumes/flows and
acceptable recorded numerical errors; a bare `passed` flag is insufficient.

Invalid files are withheld rather than coerced or replaced by demonstration
values. Loading is bounded to 15 seconds per file. Data Origin's **Loaded-file
checks** records acceptance/refusal and the reason; this record accompanies the
handoff export. These are consistency checks, not cryptographic authentication,
an independent re-run of the solver, or clinical validation.

Cycle playback now uses the artifact's sample count and caps chart redraws at
30 Hz. The flow labels describe resolved forward flow rather than claiming that
a simplified valve's anatomical opening was measured.

The browser regression injects wrong serum/assay units and empty model presets,
in addition to missing files. It checks that the NASA gate fails, the model
controls are withheld, and the source-level reasons remain visible.

Verification: 247 JavaScript tests passed (28 new consistency tests), desktop
and phone research/circulation checks passed, and missing/corrupted-artifact
browser scenarios passed. Production build passed with the existing large-chunk
advisory. Clinical accuracy remains unestablished.

### Initial Integration

- JavaScript suite: 219 passed; NASA transformation checks: 6 passed.
- Production build passed; large-chunk advisory remains.
- Main mission flow and new research/circulation controls passed at 1440x1100
  and 390x844, including nonblank anatomy pixels, playback, scrubbing, source
  selection, handoff, refusal states and no horizontal overflow.
- Blocked cardiovascular GLB, model traces and extra NASA summaries produce
  explicit unavailable states. Existing core evidence remains available without
  fabricated anatomy, waveforms or assay results.
- Numerical model checks passed for all three reference presets. This does
  not establish clinical accuracy or whole-cardiovascular-system validity.
