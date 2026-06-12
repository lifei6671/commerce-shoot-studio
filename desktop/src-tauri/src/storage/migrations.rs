use crate::error::AppResult;
use crate::storage::file_store::WorkspacePaths;
use crate::storage::sqlite::WorkspaceDatabase;

pub async fn run_workspace_migrations(
    paths: &WorkspacePaths,
    database: &WorkspaceDatabase,
) -> AppResult<()> {
    paths.backup_database_before_migration()?;
    sqlx::migrate!("./migrations").run(database.pool()).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use sqlx::Row;

    use super::*;

    const LEGACY_0001_CHECKSUM_HEX: &str = "F949D10223F44C3B6FCDCDBB592B18A60BD33FF46B1E6EE95D00E8E1DD77088F15FE930DE6E73868A69283CBC97685F4";

    const LEGACY_0001_SQL: &str = r#"
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
  template_id TEXT REFERENCES prompt_templates(id) ON DELETE SET NULL,
  mode TEXT NOT NULL CHECK (mode IN ('default', 'append', 'override')),
  variables_json TEXT NOT NULL DEFAULT '{}',
  append_text TEXT NOT NULL DEFAULT '',
  override_text TEXT NOT NULL DEFAULT '',
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
"#;

    #[tokio::test]
    async fn migrates_database_that_already_applied_legacy_init() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let paths = WorkspacePaths::new(temp_dir.path().join("workspace"));
        paths.ensure().expect("workspace");
        let database = WorkspaceDatabase::connect(&paths.database_path())
            .await
            .expect("connect");

        sqlx::query(LEGACY_0001_SQL)
            .execute(database.pool())
            .await
            .expect("legacy schema");
        sqlx::query(
            "INSERT INTO generation_tasks (
                id,
                status,
                combination_snapshot_json,
                prompt_snapshot_json,
                model_snapshot_json,
                input_assets_snapshot_json
            ) VALUES ('legacy-task', 'succeeded', '{\"legacy\":true}', '{\"prompt\":true}', '{\"model\":true}', '[]')",
        )
        .execute(database.pool())
        .await
        .expect("legacy task");
        sqlx::query(
            "CREATE TABLE _sqlx_migrations (
                version BIGINT PRIMARY KEY,
                description TEXT NOT NULL,
                installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                success BOOLEAN NOT NULL,
                checksum BLOB NOT NULL,
                execution_time BIGINT NOT NULL
            )",
        )
        .execute(database.pool())
        .await
        .expect("migrations table");
        sqlx::query(
            "INSERT INTO _sqlx_migrations (
                version, description, success, checksum, execution_time
            ) VALUES (1, 'init', TRUE, CAST(? AS BLOB), 0)",
        )
        .bind(hex_to_bytes(LEGACY_0001_CHECKSUM_HEX))
        .execute(database.pool())
        .await
        .expect("legacy migration row");

        run_workspace_migrations(&paths, &database)
            .await
            .expect("migrate legacy database");

        assert!(table_has_column(&database, "generation_tasks", "provider").await);
        assert!(table_has_column(&database, "generation_tasks", "input_snapshot_json").await);
        assert!(table_has_column(&database, "generation_tasks", "cancel_mode").await);
        assert!(table_has_column(&database, "prompt_bindings", "user_mode").await);
        assert!(table_has_column(&database, "generation_task_results", "source_url").await);
        assert!(table_exists(&database, "generation_task_input_assets").await);

        let migrated_task = sqlx::query(
            "SELECT input_snapshot_json, final_prompt_snapshot_json, updated_at
             FROM generation_tasks
             WHERE id = 'legacy-task'",
        )
        .fetch_one(database.pool())
        .await
        .expect("migrated task");
        assert_eq!(
            migrated_task.get::<String, _>("input_snapshot_json"),
            "{\"legacy\":true}"
        );
        assert_eq!(
            migrated_task.get::<String, _>("final_prompt_snapshot_json"),
            "{\"prompt\":true}"
        );
        assert!(!migrated_task.get::<String, _>("updated_at").is_empty());
    }

    async fn table_has_column(database: &WorkspaceDatabase, table: &str, column: &str) -> bool {
        let rows = sqlx::query(&format!("PRAGMA table_info({table})"))
            .fetch_all(database.pool())
            .await
            .expect("table info");
        rows.into_iter()
            .any(|row| row.get::<String, _>("name") == column)
    }

    async fn table_exists(database: &WorkspaceDatabase, table: &str) -> bool {
        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?",
        )
        .bind(table)
        .fetch_one(database.pool())
        .await
        .expect("table exists query");
        count == 1
    }

    fn hex_to_bytes(value: &str) -> Vec<u8> {
        value
            .as_bytes()
            .chunks_exact(2)
            .map(|chunk| {
                let hex = std::str::from_utf8(chunk).expect("hex utf8");
                u8::from_str_radix(hex, 16).expect("hex byte")
            })
            .collect()
    }
}
