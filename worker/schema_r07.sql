-- BLUE Signal Lab R0.7 additive migration (DO NOT drop existing tables).
CREATE TABLE IF NOT EXISTS scan_requests (
  day TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN ('pending','failed')),
  requested_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  github_run_id INTEGER,
  github_run_url TEXT,
  failure_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_scan_requests_pending ON scan_requests(status,requested_at);
