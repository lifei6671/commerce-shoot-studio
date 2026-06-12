CREATE TABLE IF NOT EXISTS asset_gc_queue (
  id TEXT PRIMARY KEY,
  relative_path TEXT NOT NULL UNIQUE,
  reason TEXT NOT NULL CHECK (reason IN ('delete_failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_asset_gc_queue_updated_at
ON asset_gc_queue(updated_at);
