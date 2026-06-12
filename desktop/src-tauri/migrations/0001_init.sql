PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  asset_type TEXT NOT NULL CHECK (asset_type IN ('person', 'garment', 'result')),
  original_name TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  thumb_relative_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (asset_type, sha256)
);

CREATE TABLE IF NOT EXISTS image_combinations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  person_asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS image_combination_items (
  combination_id TEXT NOT NULL REFERENCES image_combinations(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (role = 'garment'),
  sort_order INTEGER NOT NULL,
  PRIMARY KEY (combination_id, asset_id),
  UNIQUE (combination_id, sort_order)
);

CREATE TABLE IF NOT EXISTS prompt_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  variables_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS prompt_bindings (
  id TEXT PRIMARY KEY,
  combination_id TEXT NOT NULL UNIQUE REFERENCES image_combinations(id) ON DELETE CASCADE,
  system_mode TEXT NOT NULL CHECK (system_mode IN ('default', 'append', 'override')),
  system_base_template_id TEXT REFERENCES prompt_templates(id) ON DELETE SET NULL,
  system_append_text TEXT NOT NULL DEFAULT '',
  system_override_text TEXT NOT NULL DEFAULT '',
  user_mode TEXT NOT NULL CHECK (user_mode IN ('default', 'append', 'override')),
  user_base_template_id TEXT REFERENCES prompt_templates(id) ON DELETE SET NULL,
  user_append_text TEXT NOT NULL DEFAULT '',
  user_override_text TEXT NOT NULL DEFAULT '',
  negative_mode TEXT CHECK (negative_mode IN ('default', 'append', 'override')),
  negative_base_template_id TEXT REFERENCES prompt_templates(id) ON DELETE SET NULL,
  negative_append_text TEXT NOT NULL DEFAULT '',
  negative_override_text TEXT NOT NULL DEFAULT '',
  variables_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS model_configs (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  params_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS generation_tasks (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (
    status IN (
      'queued',
      'preparing',
      'calling_model',
      'waiting_result',
      'saving_result',
      'succeeded',
      'failed',
      'cancelled'
    )
  ),
  combination_id TEXT REFERENCES image_combinations(id) ON DELETE SET NULL,
  model_config_id TEXT REFERENCES model_configs(id) ON DELETE SET NULL,
  combination_snapshot_json TEXT NOT NULL,
  prompt_snapshot_json TEXT NOT NULL,
  model_snapshot_json TEXT NOT NULL,
  input_assets_snapshot_json TEXT NOT NULL,
  output_count INTEGER NOT NULL DEFAULT 1,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  finished_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_generation_tasks_single_running
ON generation_tasks(status)
WHERE status IN ('queued', 'preparing', 'calling_model', 'waiting_result', 'saving_result');

CREATE TABLE IF NOT EXISTS generation_task_results (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES generation_tasks(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (task_id, sort_order)
);
