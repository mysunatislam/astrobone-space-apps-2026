from __future__ import annotations

import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone, timedelta
from pathlib import Path

from .schema import Assessment, ProfileCreate, RadiationObservation
from .health import HealthObservation


def now():
    return datetime.now(timezone.utc).isoformat()


class Store:
    def __init__(self, path: Path):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.executescript(Path(__file__).with_name('schema.sql').read_text())

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        try:
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    def create_profile(self, profile: ProfileCreate, *, demo=False):
        with self.connect() as db:
            db.execute('INSERT INTO profiles VALUES (?,?,?,?,?,?)', (
                profile.astronaut_id, profile.display_name, profile.mission_name,
                json.dumps(profile.equipment), int(demo), now(),
            ))
        return self.profile(profile.astronaut_id)

    def profiles(self):
        with self.connect() as db:
            rows = db.execute('SELECT * FROM profiles ORDER BY created_at').fetchall()
        return [self._profile(row) for row in rows]

    def profile(self, astronaut_id):
        with self.connect() as db:
            row = db.execute('SELECT * FROM profiles WHERE astronaut_id=?', (astronaut_id,)).fetchone()
        if not row:
            raise KeyError('Crew profile not found')
        return self._profile(row)

    @staticmethod
    def _profile(row):
        value = dict(row)
        value['equipment'] = json.loads(value.pop('equipment_json'))
        value['is_demo'] = bool(value['is_demo'])
        return value

    def add_assessment(self, astronaut_id, assessment: Assessment):
        profile = self.profile(astronaut_id)
        if not assessment.consent_to_store:
            raise ValueError('Explicit consent is required to store aggregate health observations')
        if profile['is_demo'] != (assessment.source == 'synthetic'):
            raise ValueError('Synthetic and real observations must use separate crew profiles')
        if assessment.is_baseline and (assessment.tracking_quality < .7 or assessment.sample_count < 12):
            raise ValueError('Baseline requires at least 12 samples and 70% quality (engineering gate, not clinical validation)')
        payload = assessment.model_dump(mode='json', exclude={'consent_to_store'})
        record = {'id': str(uuid.uuid4()), **payload, 'created_at': now()}
        with self.connect() as db:
            baseline = db.execute('SELECT mission_day FROM assessments WHERE astronaut_id=? AND is_baseline=1', (astronaut_id,)).fetchone()
            if assessment.is_baseline and baseline:
                raise ValueError('Baseline is locked; create a new protocol/profile rather than silently replacing it')
            if assessment.is_baseline:
                earliest = db.execute('SELECT MIN(mission_day) AS day FROM assessments WHERE astronaut_id=?', (astronaut_id,)).fetchone()['day']
                if earliest is not None and assessment.mission_day > earliest:
                    raise ValueError('Baseline cannot be later than existing observations')
            if baseline and assessment.mission_day < baseline['mission_day']:
                raise ValueError('Follow-up cannot precede the locked baseline mission day')
            db.execute('INSERT INTO assessments VALUES (?,?,?,?,?,?)', (
                record['id'], astronaut_id, assessment.mission_day, int(assessment.is_baseline), json.dumps(record), record['created_at']))
            db.execute('INSERT INTO audit_events(astronaut_id,event_type,record_id,created_at) VALUES (?,?,?,?)',
                       (astronaut_id, 'baseline_saved' if assessment.is_baseline else 'assessment_saved', record['id'], now()))
        return record

    def history(self, astronaut_id):
        self.profile(astronaut_id)
        with self.connect() as db:
            rows = db.execute('SELECT payload_json FROM assessments WHERE astronaut_id=? ORDER BY mission_day,created_at,id', (astronaut_id,)).fetchall()
        return [json.loads(row['payload_json']) for row in rows]

    def add_radiation(self, astronaut_id, observation: RadiationObservation):
        profile = self.profile(astronaut_id)
        if profile['is_demo']:
            raise ValueError('Synthetic profiles cannot receive an instrument reading')
        if not observation.consent_to_store:
            raise ValueError('Explicit consent is required to store a personal dosimeter reading')
        record = {'id':str(uuid.uuid4()), 'mission_day':observation.mission_day,
                  'cumulative_personal_absorbed_dose_mgy':observation.cumulative_personal_absorbed_dose_mgy,
                  'instrument_id':observation.instrument_id,
                  'reading_type':'personal_dosimeter_cumulative_absorbed_dose', 'created_at':now()}
        with self.connect() as db:
            rows = db.execute('SELECT payload_json FROM radiation_observations WHERE astronaut_id=?', (astronaut_id,)).fetchall()
            for row in rows:
                previous = json.loads(row['payload_json'])
                if previous['instrument_id'] != record['instrument_id']:
                    raise ValueError('A new instrument requires a separately reviewed series')
                if ((previous['mission_day'] <= record['mission_day'] and previous['cumulative_personal_absorbed_dose_mgy'] > record['cumulative_personal_absorbed_dose_mgy'])
                        or (previous['mission_day'] > record['mission_day'] and previous['cumulative_personal_absorbed_dose_mgy'] < record['cumulative_personal_absorbed_dose_mgy'])):
                    raise ValueError('A cumulative reading cannot decrease across mission days')
            db.execute('INSERT INTO radiation_observations VALUES (?,?,?,?,?)',
                       (record['id'], astronaut_id, record['mission_day'], json.dumps(record), record['created_at']))
            db.execute('INSERT INTO audit_events(astronaut_id,event_type,record_id,created_at) VALUES (?,?,?,?)',
                       (astronaut_id, 'radiation_context_saved', record['id'], now()))
        return record

    def radiation_history(self, astronaut_id):
        self.profile(astronaut_id)
        with self.connect() as db:
            rows = db.execute('SELECT payload_json FROM radiation_observations WHERE astronaut_id=? ORDER BY mission_day,created_at,id', (astronaut_id,)).fetchall()
        return [json.loads(row['payload_json']) for row in rows]

    def health_history(self, astronaut_id):
        self.profile(astronaut_id)
        with self.connect() as db:
            rows = db.execute('SELECT payload_json FROM health_observations WHERE astronaut_id=? ORDER BY mission_day,created_at,id', (astronaut_id,)).fetchall()
        return [json.loads(row['payload_json']) for row in rows]

    def add_health(self, astronaut_id, observation: HealthObservation):
        profile = self.profile(astronaut_id)
        if not observation.consent_to_store:
            raise ValueError('Explicit consent is required to store observations')
        if profile['is_demo'] != (observation.source == 'synthetic'):
            raise ValueError('Synthetic and real observations require separate profiles')
        payload = observation.model_dump(mode='json', exclude={'consent_to_store'})
        record = {'id': str(uuid.uuid4()), **payload, 'created_at': now()}
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            previous = db.execute('SELECT payload_json FROM health_observations WHERE astronaut_id=?', (astronaut_id,)).fetchall()
            for row in previous:
                old = json.loads(row['payload_json'])
                if any(old[key] != record[key] for key in ('device_id', 'source', 'protocol')):
                    continue
                old_dose, dose = old['metrics'].get('cumulative_dose_msv'), observation.metrics.get('cumulative_dose_msv')
                if old_dose is not None and dose is not None:
                    delta = observation.observed_at - datetime.fromisoformat(old['observed_at'].replace('Z', '+00:00'))
                    if (delta.total_seconds() >= 0 and dose < old_dose) or (delta.total_seconds() <= 0 and dose > old_dose):
                        raise ValueError('Cumulative dose cannot decrease within a device/protocol series')
            db.execute('INSERT INTO health_observations VALUES (?,?,?,?,?)', (record['id'], astronaut_id, observation.mission_day, json.dumps(record), record['created_at']))
            db.execute('INSERT INTO audit_events(astronaut_id,event_type,record_id,created_at) VALUES (?,?,?,?)', (astronaut_id, 'health_observation_saved', record['id'], now()))
        return record

    def save_report(self, astronaut_id, report):
        report = {**report, 'id': str(uuid.uuid4()), 'created_at': now()}
        with self.connect() as db:
            db.execute('INSERT INTO reports VALUES (?,?,?,?)', (report['id'], astronaut_id, json.dumps(report), report['created_at']))
        return report

    def report(self, report_id):
        with self.connect() as db:
            row = db.execute('SELECT payload_json FROM reports WHERE id=?', (report_id,)).fetchone()
        if not row:
            raise KeyError('Report not found')
        return json.loads(row['payload_json'])

    def delete_profile(self, astronaut_id):
        self.profile(astronaut_id)
        with self.connect() as db:
            db.execute('DELETE FROM profiles WHERE astronaut_id=?', (astronaut_id,))

    def demo(self):
        scenario = json.loads((Path(__file__).resolve().parents[1] / 'src/demoMission.json').read_text())
        identifier = 'DEMO-180-' + uuid.uuid4().hex[:6]
        profile = self.create_profile(ProfileCreate(astronaut_id=identifier, **scenario['profile']), demo=True)
        for row in scenario['observations']:
            self.add_assessment(identifier, Assessment(
                **{key:value for key,value in row.items() if key != 'stage'}, protocol=scenario['protocol'], source='synthetic',
                gravity=scenario['gravity'], pose_model=scenario['pose_model'], consent_to_store=True,
            ))
        for row in scenario['health']:
            self.add_health(identifier, HealthObservation(**row, consent_to_store=True))
        with self.connect() as db:
            for row in scenario['radiation']:
                record = {**row, 'id':str(uuid.uuid4()), 'source':'synthetic', 'instrument_id':'DEMO-DOSIMETER', 'created_at':now()}
                db.execute('INSERT INTO radiation_observations VALUES (?,?,?,?,?)', (record['id'], identifier, row['mission_day'], json.dumps(record), record['created_at']))
        return profile

    def followups(self, astronaut_id):
        self.profile(astronaut_id)
        with self.connect() as db:
            rows = db.execute('SELECT payload_json FROM followups WHERE astronaut_id=? ORDER BY mission_day,created_at,id', (astronaut_id,)).fetchall()
        return [json.loads(row['payload_json']) for row in rows]

    def add_followup(self, astronaut_id, value):
        if not value.consent_to_store:
            raise ValueError('Consent is required to record a follow-up action')
        observation = next((row for row in self.history(astronaut_id) if row['id'] == value.assessment_id), None)
        if not observation or observation['mission_day'] != value.mission_day:
            raise ValueError('The action must link to the selected observation and mission day')
        record = {**value.model_dump(exclude={'consent_to_store'}), 'id':str(uuid.uuid4()), 'created_at':now(),
                  'text':'Crew requested a protocol-matched repeat, subject to approved procedures.' if value.kind == 'repeat_requested'
                  else 'Crew recorded review of this observation; no clearance or treatment was issued.'}
        with self.connect() as db:
            db.execute('INSERT INTO followups VALUES (?,?,?,?,?)', (record['id'], astronaut_id, value.mission_day, json.dumps(record), record['created_at']))
        return record
