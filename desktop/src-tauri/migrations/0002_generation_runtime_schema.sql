PRAGMA foreign_keys = ON;

ALTER TABLE prompt_bindings
ADD COLUMN system_mode TEXT NOT NULL DEFAULT 'default'
CHECK (system_mode IN ('default', 'append', 'override'));

ALTER TABLE prompt_bindings
ADD COLUMN system_base_template_id TEXT REFERENCES prompt_templates(id) ON DELETE SET NULL;

ALTER TABLE prompt_bindings
ADD COLUMN system_append_text TEXT NOT NULL DEFAULT '';

ALTER TABLE prompt_bindings
ADD COLUMN system_override_text TEXT NOT NULL DEFAULT '';

ALTER TABLE prompt_bindings
ADD COLUMN user_mode TEXT NOT NULL DEFAULT 'default'
CHECK (user_mode IN ('default', 'append', 'override'));

ALTER TABLE prompt_bindings
ADD COLUMN user_base_template_id TEXT REFERENCES prompt_templates(id) ON DELETE SET NULL;

ALTER TABLE prompt_bindings
ADD COLUMN user_append_text TEXT NOT NULL DEFAULT '';

ALTER TABLE prompt_bindings
ADD COLUMN user_override_text TEXT NOT NULL DEFAULT '';

ALTER TABLE prompt_bindings
ADD COLUMN negative_mode TEXT CHECK (negative_mode IN ('default', 'append', 'override'));

ALTER TABLE prompt_bindings
ADD COLUMN negative_base_template_id TEXT REFERENCES prompt_templates(id) ON DELETE SET NULL;

ALTER TABLE prompt_bindings
ADD COLUMN negative_append_text TEXT NOT NULL DEFAULT '';

ALTER TABLE prompt_bindings
ADD COLUMN negative_override_text TEXT NOT NULL DEFAULT '';

UPDATE prompt_bindings
SET
  user_mode = mode,
  user_base_template_id = template_id,
  user_append_text = append_text,
  user_override_text = override_text;

ALTER TABLE generation_tasks
ADD COLUMN provider TEXT NOT NULL DEFAULT 'openai';

ALTER TABLE generation_tasks
ADD COLUMN model_id TEXT NOT NULL DEFAULT 'gpt-image-2';

ALTER TABLE generation_tasks
ADD COLUMN progress INTEGER NOT NULL DEFAULT 0;

ALTER TABLE generation_tasks
ADD COLUMN message TEXT;

ALTER TABLE generation_tasks
ADD COLUMN request_summary_json TEXT;

ALTER TABLE generation_tasks
ADD COLUMN response_summary_json TEXT;

ALTER TABLE generation_tasks
ADD COLUMN input_snapshot_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE generation_tasks
ADD COLUMN final_prompt_snapshot_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE generation_tasks
ADD COLUMN model_config_snapshot_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE generation_tasks
ADD COLUMN asset_snapshot_json TEXT NOT NULL DEFAULT '[]';

ALTER TABLE generation_tasks
ADD COLUMN cancel_mode TEXT CHECK (
  cancel_mode IS NULL OR cancel_mode IN (
    'local_only',
    'remote_requested',
    'remote_confirmed',
    'remote_not_supported',
    'remote_failed'
  )
);

ALTER TABLE generation_tasks
ADD COLUMN error_detail TEXT;

ALTER TABLE generation_tasks
ADD COLUMN updated_at TEXT;

UPDATE generation_tasks
SET
  input_snapshot_json = combination_snapshot_json,
  final_prompt_snapshot_json = prompt_snapshot_json,
  model_config_snapshot_json = model_snapshot_json,
  asset_snapshot_json = input_assets_snapshot_json,
  updated_at = created_at;

DROP INDEX IF EXISTS idx_generation_tasks_single_running;

CREATE INDEX IF NOT EXISTS idx_generation_tasks_status
ON generation_tasks(status);

CREATE INDEX IF NOT EXISTS idx_generation_tasks_created_at
ON generation_tasks(created_at);

CREATE INDEX IF NOT EXISTS idx_generation_tasks_combination_created_at
ON generation_tasks(combination_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_generation_tasks_single_running
ON generation_tasks((1))
WHERE status IN ('queued', 'preparing', 'calling_model', 'waiting_result', 'saving_result');

ALTER TABLE generation_task_results
ADD COLUMN source_url TEXT;

CREATE INDEX IF NOT EXISTS idx_task_results_task_id
ON generation_task_results(task_id);

CREATE INDEX IF NOT EXISTS idx_task_results_asset_id
ON generation_task_results(asset_id);

CREATE TABLE IF NOT EXISTS generation_task_input_assets (
  task_id TEXT NOT NULL REFERENCES generation_tasks(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (role IN ('person', 'garment', 'reference', 'mask')),
  view_type TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_primary INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (task_id, asset_id, role, sort_order)
);

CREATE INDEX IF NOT EXISTS idx_task_input_assets_task_id
ON generation_task_input_assets(task_id);

CREATE INDEX IF NOT EXISTS idx_task_input_assets_asset_id
ON generation_task_input_assets(asset_id);
