PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS image_combination_people (
  combination_id TEXT NOT NULL REFERENCES image_combinations(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  sort_order INTEGER NOT NULL,
  PRIMARY KEY (combination_id, asset_id),
  UNIQUE (combination_id, sort_order)
);

INSERT OR IGNORE INTO image_combination_people (combination_id, asset_id, sort_order)
SELECT id, person_asset_id, 0
FROM image_combinations;
