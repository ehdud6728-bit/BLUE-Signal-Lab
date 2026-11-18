-- Turso only. Manually created with the separate schema-init workflow.
-- Exact source column shape from the D1 collector; no D1 SQL is executed.
CREATE TABLE IF NOT EXISTS blue_kis_live_quotes_r141 (
  trade_date TEXT NOT NULL,
  market TEXT NOT NULL,
  code TEXT NOT NULL,
  received_at_utc TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY(trade_date,market,code)
);
CREATE TABLE IF NOT EXISTS blue_kis_live_history_r141 (
  trade_date TEXT NOT NULL,
  market TEXT NOT NULL,
  code TEXT NOT NULL,
  received_at_utc TEXT NOT NULL,
  price INTEGER NOT NULL,
  volume INTEGER NOT NULL,
  phase TEXT NOT NULL,
  PRIMARY KEY(trade_date,market,code,received_at_utc)
);
CREATE INDEX IF NOT EXISTS idx_blue_turso_hist_code_time_v1
  ON blue_kis_live_history_r141(code,received_at_utc);
