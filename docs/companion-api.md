# Companion API v1

Base: `http://127.0.0.1:8010/api/companion`

Interactive schema: `http://127.0.0.1:8010/docs`.
JSON only; foreign browser origins and unexpected Host headers are rejected.
This is a single-user loopback prototype, not an authenticated public API.

| Method | Route | Result |
| --- | --- | --- |
| GET | `/health` | Runtime/model availability and corpus identity |
| GET | `/profiles` | Local profile list |
| POST | `/profiles` | Create real-observation profile; 201 |
| GET | `/profiles/{id}` | Profile, ordered movement history and dosimeter context |
| DELETE | `/profiles/{id}` | Delete profile and related records |
| POST | `/profiles/{id}/assessments` | Validate and save consented aggregate observation; 201 |
| POST | `/profiles/{id}/radiation` | Validate and save a consented personal dosimeter reading; 201 |
| POST | `/demo` | New isolated synthetic Day 1/30/90/180 profile; 201 |
| GET | `/knowledge` | Versioned curated evidence manifest |
| POST | `/runs` | Queue one bounded review; 202 |
| GET | `/runs/{id}` | Status, trace and final report |
| GET | `/reports/{id}` | Persisted report |

Only one review runs at a time. A concurrent request returns 409. Job status is
in memory; reports are persisted. Restarting the service loses job IDs, not
completed stored reports. Validation returns 422. Unknown records return 404.

## Synthetic Smoke Test

```powershell
$base = 'http://127.0.0.1:8010/api/companion'
$crew = Invoke-RestMethod "$base/demo" -Method Post -ContentType application/json -Body '{}'
$body = @{ astronaut_id = $crew.astronaut_id; use_llm = $true } | ConvertTo-Json
$run = Invoke-RestMethod "$base/runs" -Method Post -ContentType application/json -Body $body
do {
  Start-Sleep -Seconds 2
  $state = Invoke-RestMethod "$base/runs/$($run.id)"
} while ($state.status -eq 'running')
$state.report | ConvertTo-Json -Depth 15
```

## Profile And Observation

```json
{
  "astronaut_id": "CREW-001",
  "display_name": "Crew A",
  "mission_name": "Earth analog",
  "equipment": ["camera"]
}
```

```json
{
  "mission_day": 1,
  "protocol": "controlled-extension-v1",
  "gravity": "earth",
  "source": "camera",
  "pose_model": "MediaPipe Pose Landmarker lite",
  "metrics": {"knee_extension_deg": 165, "knee_rom_left_deg": 80},
  "tracking_quality": 0.9,
  "sample_count": 120,
  "calibrated_distance": false,
  "is_baseline": true,
  "consent_to_store": true
}
```

These values are illustrative, not a recommended exercise or reference range.
Actual browser observations use their own protocol/model identifiers. Do not mix
this example with those observations. A baseline is locked and must precede its
follow-ups. Raw video, extra fields, nonfinite/out-of-envelope metrics, and
uncalibrated metric distances are rejected. The 70%/12-sample baseline gate is an
engineering filter, not validated clinical accuracy.

A local exercise video uses `source: "video"` and its own protocol identifier;
it cannot be numerically compared with a live-camera baseline. The service
receives only aggregate features, not the uploaded video or raw landmarks.

Personal dosimeter context can be posted separately:

```json
{
  "mission_day": 30,
  "cumulative_personal_absorbed_dose_mgy": 7.2,
  "instrument_id": "DOS-001",
  "consent_to_store": true
}
```

The value above is an API illustration, not a real mission measurement.
The reading is entered manually; the API does not authenticate the dosimeter.
Instrument IDs must be stable across a series, cumulative readings cannot
decrease, and synthetic profiles cannot receive instrument readings. The
report presents the reading with its day and provenance but never infers an
organ dose, bone dose, causal attribution, or combined risk score.

## Bounded Tools

`analyze_pose` reads saved pose-derived metadata; it does not independently
analyze a video or start the camera. `calculate_biomechanics` receives existing
validated aggregates. `compare_digital_twin` performs within-person comparison.
`predict_risk` currently provides rule-based review priority with clinical
predictions explicitly unavailable. `search_medical_database` retrieves from the
curated local corpus. `generate_report` builds the human-review report.

The LLM cannot invoke profile writes. `update_astronaut_profile` is deliberately
not a model tool; UI/API consent is required for profile/observation changes.
