# Experimental respiratory motion estimation

AstroBone adds a 45-second seated breathing check to Live Capture. The module uses the existing MediaPipe pose stream to locate shoulders and hips, then measures relative motion in 24 image patches across chest and abdomen. Camera frames remain on the device. This module does not use an external AI service.

## What works

- Live webcam torso tracking, subpixel Lucas–Kanade optical flow, background translation subtraction, and body-position/scale rejection.
- Timestamp checks, native-cadence reconstruction, low-pass anti-alias filtering before downsampling, linear detrending, frequency analysis, periodicity and split-window consistency checks; band-pass waveform display.
- A rate is withheld until at least 30 seconds of usable motion. The supported engineering range is 6–40 cycles/min; a completed capture lasts 45 seconds. This is an implementation range, not a definition of healthy breathing.
- Relative chest/abdomen optical-flow map, capture diagnostics, waveform and a signal-quality score. The score describes periodic motion, not a calibrated probability that the rate is correct.
- Explicitly saved aggregate readings and descriptive personal baselines after three usable readings, isolated by local crew code, source and protocol. A saved-reading trend chart shows descriptive change against prior readings. Depth recordings receive a local SHA-256 fingerprint so re-importing the same recording cannot inflate a baseline. History is local and unencrypted. No clinical trend rule is applied.
- Synthetic preview and synthetic depth imports cannot be saved as personal measurements. Exports retain the synthetic flag and experimental status.
- Imported measured RGB-D region distances in millimeters. A camera adapter must perform its own motion compensation and declare that fact. This release does not connect directly to depth-camera hardware and does not display dense depth heatmaps.

The original [depth visualization project](https://github.com/NoceAnto/breath_visual_depthcamera) is credited as research inspiration. Its prerecorded-array pipeline and Python code are not bundled or presented as a live monitor.

## Depth import contract

```json
{
  "schema": "astrobone-depth-respiratory-v1",
  "units": "mm",
  "motionCompensated": true,
  "synthetic": false,
  "samples": [
    { "t": 0, "chest": 901.4, "abdomen": 915.1, "motion": 0.001, "visibility": 0.99 },
    { "t": 100, "chest": 901.5, "abdomen": 915.2, "motion": 0.001, "visibility": 0.99 }
  ]
}
```

This short example documents the structure and cannot produce a rate. Timestamps are milliseconds and strictly increase. Recordings must be at most three minutes with 2–18,000 samples and under 2 MB. Region distances must be positive and at most 10,000 mm. `motion` and `visibility` are normalized 0–1 metadata. The adapter declaration is not independently verified. Normal webcams cannot supply measured depth.

## Reference validation: not yet completed

Before claiming measurement accuracy, collect simultaneous camera and respiratory-belt (or another suitable respiratory reference) recordings from multiple consented participants. Use pseudonymous IDs. Keep the estimator and gates frozen for the evaluation; do not tune and report performance on the same participants.

1. Synchronize clocks and record the offset. Match the same 30–180-second windows, with start and end times within 500 ms after alignment.
2. Include a range of clothing textures, lighting, camera distances, body shapes and natural breathing patterns. Separately test normal movement, camera movement, loss of torso visibility and pauses. Do not induce unsafe breathing behavior.
3. Define the reference-rate extraction procedure and unusable-reference exclusions before analysis. Inspect the reference waveform independently of the camera estimate.
4. Retain every camera refusal and its reason. Report usable coverage together with MAE, signed bias, RMSE and exploratory Bland–Altman limits; report webcam/depth separately and inspect per-participant results.
5. Use participant-level held-out evaluation and participant-level uncertainty estimates for formal validation. Repeated windows from one person are correlated. The built-in descriptive comparison does not account for that correlation and cannot certify clinical accuracy.
6. Predefine engineering acceptance criteria for the intended use. Run a separate usability/analog-crew study before claiming operational usefulness. No astronaut evaluation has been performed.

The built-in **Compare with a respiratory belt** panel reads this schema in memory:

```json
{
  "schema": "astrobone-respiratory-validation-v1",
  "synthetic": true,
  "reference": { "instrument": "Synthetic example only", "clockOffsetMs": 1000 },
  "pairs": [
    {
      "subjectId": "P01", "captureId": "P01-window01", "source": "webcam",
      "startMs": 1000, "endMs": 46000,
      "referenceStartMs": 0, "referenceEndMs": 45000,
      "referenceRate": 15, "accepted": true, "estimatedRate": 15.8
    },
    {
      "subjectId": "P01", "captureId": "P01-window02", "source": "webcam",
      "startMs": 61000, "endMs": 106000,
      "referenceStartMs": 60000, "referenceEndMs": 105000,
      "referenceRate": 15, "accepted": false, "estimatedRate": null
    }
  ]
}
```

`reference time + clockOffsetMs = camera time`. Refused windows use `null`, never zero. Duplicate capture IDs and misaligned windows are refused. No paired reference records are bundled; this example is synthetic.

## Scientific boundaries

Periodic shirt/body motion can resemble respiration. Monocular motion cannot measure tidal volume, oxygen saturation, ventilation or bone density. Added NASA mouse microCT tables support external research context; they do not validate this camera estimator. All new NASA sources and integration statuses appear in the evidence browser and [NASA expansion notes](RESPIRATORY_NASA_EVIDENCE.md).

Engineering tests cover synthetic wave recovery, cadence and motion refusals, noise, malformed imports, clock alignment and reference coverage. Passing these tests is not validation on people.
