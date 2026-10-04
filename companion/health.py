"""Source-preserving observations, not a clinical prediction or causal model."""
from datetime import datetime, timezone, timedelta
from typing import Literal
from pydantic import Field, model_validator
from .schema import StrictModel

RANGES = {'heart_rate_bpm': (30, 240), 'hrv_rmssd_ms': (0, 500), 'spo2_pct': (50, 100),
          'recovery_hr_60s_bpm': (30, 240), 'dose_rate_usv_h': (0, 1e7), 'cumulative_dose_msv': (0, 1e5)}


def summarize_health(rows):
    series = {}
    for row in sorted(rows, key=lambda r: datetime.fromisoformat(r['observed_at'].replace('Z', '+00:00'))):
        for metric, value in row['metrics'].items():
            key = (metric, row['source'], row['device_id'], row['protocol'])
            item = series.setdefault(key, {'metric': metric, 'source': row['source'], 'device': row['device_id'], 'protocol': row['protocol'], 'points': []})
            item['points'].append({'day': row['mission_day'], 'at': row['observed_at'], 'value': value, 'quality': row['quality']})
    for item in series.values():
        qualified = [p for p in item['points'] if p['quality'] >= .6]
        latest = item['points'][-1]
        last = latest if latest['quality'] >= .6 else None
        item.update(first=qualified[0] if qualified else None, last=last, withheld=last is None, latestDay=latest['day'],
                    count=len(qualified), delta=last['value'] - qualified[0]['value'] if last and len(qualified) > 1 else None)
    return {'series': list(series.values()), 'interpretation': 'Descriptive change from the first quality-qualified observation in the same device, source and protocol series. No clinical score or causal attribution. Manual instrument provenance is not authenticated.'}


class HealthObservation(StrictModel):
    mission_day: int = Field(ge=0, le=2000)
    observed_at: datetime
    source: Literal['instrument', 'camera_rppg', 'synthetic']
    device_id: str = Field(pattern=r'^[A-Za-z0-9][A-Za-z0-9_-]{1,39}$')
    protocol: str = Field(min_length=3, max_length=80)
    metrics: dict[str, float] = Field(min_length=1, max_length=6)
    quality: float = Field(ge=0, le=1)
    consent_to_store: bool = False

    @model_validator(mode='after')
    def validate_reading(self):
        if self.observed_at.tzinfo is None or self.observed_at > datetime.now(timezone.utc) + timedelta(minutes=5):
            raise ValueError('Observation time needs a timezone and cannot be in the future')
        if not self.protocol.strip():
            raise ValueError('A measurement protocol is required')
        for key, value in self.metrics.items():
            if key not in RANGES or not RANGES[key][0] <= value <= RANGES[key][1]:
                raise ValueError('Unsupported metric or value outside the input envelope')
        if self.source == 'camera_rppg' and (set(self.metrics) != {'heart_rate_bpm'} or self.quality < .6):
            raise ValueError('Camera rPPG permits only pulse estimates passing the engineering quality gate')
        return self
