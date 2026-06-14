PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS prompt_presets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  scenario TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL CHECK (source IN ('built_in', 'custom')),
  system_mode TEXT NOT NULL DEFAULT 'default'
    CHECK (system_mode IN ('default', 'append', 'override')),
  system_base_template_id TEXT REFERENCES prompt_templates(id) ON DELETE SET NULL,
  system_append_text TEXT NOT NULL DEFAULT '',
  system_override_text TEXT NOT NULL DEFAULT '',
  user_mode TEXT NOT NULL DEFAULT 'default'
    CHECK (user_mode IN ('default', 'append', 'override')),
  user_base_template_id TEXT REFERENCES prompt_templates(id) ON DELETE SET NULL,
  user_append_text TEXT NOT NULL DEFAULT '',
  user_override_text TEXT NOT NULL DEFAULT '',
  negative_mode TEXT CHECK (negative_mode IN ('default', 'append', 'override')),
  negative_base_template_id TEXT REFERENCES prompt_templates(id) ON DELETE SET NULL,
  negative_append_text TEXT NOT NULL DEFAULT '',
  negative_override_text TEXT NOT NULL DEFAULT '',
  variables_json TEXT NOT NULL DEFAULT '[]',
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  locked INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_prompt_presets_source
ON prompt_presets(source);

CREATE INDEX IF NOT EXISTS idx_prompt_presets_default
ON prompt_presets(is_default);
