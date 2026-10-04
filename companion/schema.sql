PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS followups (
  id TEXT PRIMARY KEY,
  astronaut_id TEXT NOT NULL REFERENCES profiles(astronaut_id) ON DELETE CASCADE,
  mission_day INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS profiles (
  astronaut_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  mission_name TEXT NOT NULL,
  equipment_json TEXT NOT NULL,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS assessments (
  id TEXT PRIMARY KEY,
  astronaut_id TEXT NOT NULL REFERENCES profiles(astronaut_id) ON DELETE CASCADE,
  mission_day INTEGER NOT NULL CHECK(mission_day >= 0),
  is_baseline INTEGER NOT NULL CHECK(is_baseline IN (0,1)),
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS one_baseline_per_profile
  ON assessments(astronaut_id) WHERE is_baseline=1;
CREATE INDEX IF NOT EXISTS assessment_timeline ON assessments(astronaut_id, mission_day, created_at);
CREATE TABLE IF NOT EXISTS radiation_observations (
  id TEXT PRIMARY KEY,
  astronaut_id TEXT NOT NULL REFERENCES profiles(astronaut_id) ON DELETE CASCADE,
  mission_day INTEGER NOT NULL CHECK(mission_day >= 0),
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS radiation_timeline ON radiation_observations(astronaut_id, mission_day, created_at);
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  astronaut_id TEXT NOT NULL REFERENCES profiles(astronaut_id) ON DELETE CASCADE,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS health_observations (
  id TEXT PRIMARY KEY,
  astronaut_id TEXT NOT NULL REFERENCES profiles(astronaut_id) ON DELETE CASCADE,
  mission_day INTEGER NOT NULL CHECK(mission_day >= 0),
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS health_timeline ON health_observations(astronaut_id, mission_day, created_at);
CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  astronaut_id TEXT REFERENCES profiles(astronaut_id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  record_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
