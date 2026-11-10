-- BLUE Signal Lab R0.9 AI cache, shared by all devices.
-- Additive only: no changes to existing run/signals/search tables.
CREATE TABLE IF NOT EXISTS ai_analysis_cache (
  cache_key TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('market','stock')),
  asof_date TEXT NOT NULL,
  code TEXT,
  source_run_id TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('PENDING','READY','FAILED')),
  report_text TEXT,
  sources_json TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  generated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_ai_cached_by_day ON ai_analysis_cache(kind,asof_date,code,generated_at);
CREATE TABLE IF NOT EXISTS ai_daily_usage (
  day TEXT PRIMARY KEY,
  used INTEGER NOT NULL DEFAULT 0 CHECK(used>=0)
);
