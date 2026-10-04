from __future__ import annotations

from enum import Enum
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)


class Metric(str, Enum):
    knee_extension_deg = 'knee_extension_deg'
    knee_rom_left_deg = 'knee_rom_left_deg'
    knee_rom_right_deg = 'knee_rom_right_deg'
    hip_rom_left_deg = 'hip_rom_left_deg'
    hip_rom_right_deg = 'hip_rom_right_deg'
    ankle_rom_left_deg = 'ankle_rom_left_deg'
    ankle_rom_right_deg = 'ankle_rom_right_deg'
    shoulder_alignment_deg = 'shoulder_alignment_deg'
    knee_asymmetry_deg = 'knee_asymmetry_deg'
    knee_angular_speed_deg_s = 'knee_angular_speed_deg_s'
    cadence_cycles_min = 'cadence_cycles_min'
    gait_speed_m_s = 'gait_speed_m_s'
    step_length_m = 'step_length_m'
    sway_rms_normalized = 'sway_rms_normalized'


class ProfileCreate(StrictModel):
    astronaut_id: str = Field(pattern=r'^[A-Za-z0-9][A-Za-z0-9_-]{1,39}$')
    display_name: str = Field(min_length=1, max_length=60)
    mission_name: str = Field(default='Exploration analog', min_length=1, max_length=80)
    equipment: list[Literal['camera', 'imu', 'resistance_device', 'treadmill']] = Field(default_factory=lambda: ['camera'], max_length=4)


class Assessment(StrictModel):
    mission_day: int = Field(ge=0, le=2000)
    protocol: str = Field(min_length=3, max_length=80)
    gravity: Literal['earth', 'microgravity', 'moon', 'mars', 'unknown'] = 'earth'
    source: Literal['camera', 'video', 'instrument', 'synthetic'] = 'camera'
    pose_model: str = Field(default='MediaPipe Pose Landmarker lite', max_length=100)
    metrics: dict[Metric, float] = Field(min_length=1, max_length=16)
    tracking_quality: float = Field(ge=0, le=1)
    sample_count: int = Field(ge=1, le=100000)
    calibrated_distance: bool = False
    exercise_minutes_last_7_days: int | None = Field(default=None, ge=0, le=10080)
    is_baseline: bool = False
    consent_to_store: bool = False

    @model_validator(mode='after')
    def physical_ranges(self):
        for metric, value in self.metrics.items():
            upper = 180 if metric.value.endswith('_deg') else {
                'knee_angular_speed_deg_s': 1500, 'cadence_cycles_min': 300,
                'gait_speed_m_s': 15, 'step_length_m': 3, 'sway_rms_normalized': 2,
            }.get(metric.value, 180)
            if not 0 <= value <= upper:
                raise ValueError(f'{metric.value} outside the documented input envelope')
            if metric.value in {'gait_speed_m_s', 'step_length_m'} and not self.calibrated_distance:
                raise ValueError('Metric distance requires explicit distance calibration')
        return self


class RadiationObservation(StrictModel):
    mission_day: int = Field(ge=0, le=2000)
    cumulative_personal_absorbed_dose_mgy: float = Field(ge=0, le=100000)
    instrument_id: str = Field(pattern=r'^[A-Za-z0-9][A-Za-z0-9_-]{1,39}$')
    consent_to_store: bool = False


class ReviewRequest(StrictModel):
    astronaut_id: str
    as_of_day: int | None = Field(default=None, ge=0, le=2000)
    prompt: str = Field(default="Compare my latest assessment with my baseline.", min_length=1, max_length=1500)
    use_llm: bool = True
    red_flags: list[Literal['new_severe_pain', 'loss_of_function', 'new_numbness']] = Field(default_factory=list, max_length=3)


class Followup(StrictModel):
    assessment_id: str
    mission_day: int = Field(ge=0, le=2000)
    kind: Literal['repeat_requested', 'review_recorded']
    consent_to_store: bool = False


TOOLS = ['analyze_pose', 'calculate_biomechanics', 'compare_digital_twin', 'predict_risk', 'search_medical_database', 'generate_report']


class AgentPlan(StrictModel):
    tools: list[Literal['analyze_pose', 'calculate_biomechanics', 'compare_digital_twin', 'predict_risk', 'search_medical_database', 'generate_report']] = Field(min_length=1, max_length=6)
    evidence_query: str = Field(min_length=3, max_length=200)


class EvidenceSelection(StrictModel):
    finding_ids: list[str] = Field(max_length=20)
    evidence_ids: list[str] = Field(max_length=6)
    action_ids: list[str] = Field(max_length=4)
