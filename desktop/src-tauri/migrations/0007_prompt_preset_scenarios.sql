PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS prompt_preset_scenarios (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL CHECK (source IN ('built_in', 'custom')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_prompt_preset_scenarios_sort
ON prompt_preset_scenarios(sort_order, created_at);

INSERT OR IGNORE INTO prompt_preset_scenarios (id, name, source, sort_order)
VALUES
  ('builtin_scenario_white_background', '白底主图', 'built_in', 10),
  ('builtin_scenario_model_display', '模特展示', 'built_in', 20),
  ('builtin_scenario_detail_display', '细节展示', 'built_in', 30),
  ('builtin_scenario_social_style', '社媒风格', 'built_in', 40);

INSERT OR IGNORE INTO prompt_preset_scenarios (id, name, source, sort_order)
SELECT
  'prompt_preset_scenario_' || lower(hex(randomblob(16))),
  scenario,
  'custom',
  1000
FROM (
  SELECT DISTINCT scenario
  FROM prompt_presets
  WHERE trim(scenario) <> ''
);
