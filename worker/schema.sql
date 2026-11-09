CREATE TABLE IF NOT EXISTS runs (
 run_id TEXT PRIMARY KEY, created_at TEXT NOT NULL, source TEXT NOT NULL,
 latest_price_date TEXT, notes TEXT, is_demo INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS signals (
 run_id TEXT NOT NULL, code TEXT NOT NULL, day TEXT NOT NULL,
 signal_names TEXT NOT NULL, close_price REAL, supply_distance_pct REAL,
 extras_json TEXT NOT NULL DEFAULT '{}',
 PRIMARY KEY (run_id, code, day),
 FOREIGN KEY(run_id) REFERENCES runs(run_id)
);
CREATE INDEX IF NOT EXISTS idx_signal_day ON signals(day);
CREATE INDEX IF NOT EXISTS idx_signal_code ON signals(code,day);
CREATE TABLE IF NOT EXISTS daily_counts (
 run_id TEXT NOT NULL, day TEXT NOT NULL, observed_stocks INTEGER NOT NULL,
 signal_events INTEGER NOT NULL, matched_stocks INTEGER NOT NULL,
 PRIMARY KEY (run_id,day)
);
CREATE INDEX IF NOT EXISTS idx_counts_day ON daily_counts(day);
