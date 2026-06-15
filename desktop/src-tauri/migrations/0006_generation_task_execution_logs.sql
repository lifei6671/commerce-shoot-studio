CREATE TABLE IF NOT EXISTS generation_task_execution_logs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES generation_tasks(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  prompt_json TEXT NOT NULL,
  success_response_json TEXT,
  error_response_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(task_id)
);

CREATE INDEX IF NOT EXISTS idx_generation_task_execution_logs_task_id
ON generation_task_execution_logs(task_id);

CREATE INDEX IF NOT EXISTS idx_generation_task_execution_logs_started_at
ON generation_task_execution_logs(started_at);
