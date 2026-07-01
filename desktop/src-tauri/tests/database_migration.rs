use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use commerce_shoot_studio_lib::infrastructure::database::{
    Migration, MigrationRunner, WorkspaceDatabase,
};
use commerce_shoot_studio_lib::infrastructure::filesystem::WorkspaceFileSystem;
use commerce_shoot_studio_lib::services::workspace::{InitializeWorkspaceInput, WorkspaceService};

#[test]
fn open_workspace_database_creates_db_and_configures_sqlite_pragmas() {
    let workspace_dir = initialized_workspace("pragma");

    let database = WorkspaceDatabase::open(&workspace_dir).expect("workspace database should open");

    assert!(workspace_dir.join("workspace.db").is_file());
    assert!(database.foreign_keys_enabled().expect("query foreign_keys"));
    assert_eq!(
        database.busy_timeout_ms().expect("query busy_timeout"),
        5000
    );
    assert_eq!(database.journal_mode().expect("query journal_mode"), "wal");
    assert_eq!(
        database
            .applied_migrations()
            .expect("query applied migrations"),
        vec![1],
        "workspace database should apply the current baseline schema",
    );
    let settings_table_count: i64 = database
        .connection()
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'settings'",
            [],
            |row| row.get(0),
        )
        .expect("query settings table");
    assert_eq!(settings_table_count, 1);
    let assets_table_count: i64 = database
        .connection()
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'assets'",
            [],
            |row| row.get(0),
        )
        .expect("query assets table");
    assert_eq!(assets_table_count, 1);
    let relative_path_index_count: i64 = database
        .connection()
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_assets_relative_path'",
            [],
            |row| row.get(0),
        )
        .expect("query assets relative path index");
    assert_eq!(relative_path_index_count, 1);
    for table_name in [
        "generation_tasks",
        "generation_task_input_assets",
        "generation_assets",
        "task_events",
        "model_configs",
        "model_secrets",
    ] {
        let table_count: i64 = database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
                [table_name],
                |row| row.get(0),
            )
            .expect("query generation table");
        assert_eq!(table_count, 1, "{table_name} should exist");
    }

    remove_workspace(&workspace_dir);
}

#[test]
fn open_workspace_database_repairs_missing_baseline_tables_during_development() {
    let workspace_dir = initialized_workspace("baseline-repair");
    {
        let database =
            WorkspaceDatabase::open(&workspace_dir).expect("workspace database should open");
        database
            .connection()
            .execute("DROP TABLE model_invocations", [])
            .expect("drop baseline table to simulate old local db");
    }

    let database =
        WorkspaceDatabase::open(&workspace_dir).expect("workspace database should reopen");
    let table_count: i64 = database
        .connection()
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'model_invocations'",
            [],
            |row| row.get(0),
        )
        .expect("query repaired table");

    assert_eq!(table_count, 1);

    remove_workspace(&workspace_dir);
}

#[test]
fn open_workspace_database_repairs_missing_secret_version_column() {
    let workspace_dir = initialized_workspace("baseline-secret-version-repair");
    {
        let database =
            WorkspaceDatabase::open(&workspace_dir).expect("workspace database should open");
        database
            .connection()
            .execute(
                "CREATE TABLE old_model_secrets (
                    id TEXT PRIMARY KEY,
                    provider_profile_id TEXT NOT NULL,
                    capability_id TEXT NOT NULL DEFAULT '',
                    secret_value TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                    UNIQUE(provider_profile_id, capability_id)
                )",
                [],
            )
            .expect("create old secret table");
        database
            .connection()
            .execute("INSERT INTO old_model_secrets SELECT id, provider_profile_id, capability_id, secret_value, created_at, updated_at FROM model_secrets", [])
            .expect("copy secrets into old table");
        database
            .connection()
            .execute("DROP TABLE model_secrets", [])
            .expect("drop current secret table");
        database
            .connection()
            .execute("ALTER TABLE old_model_secrets RENAME TO model_secrets", [])
            .expect("rename old secret table");
    }

    let database =
        WorkspaceDatabase::open(&workspace_dir).expect("workspace database should reopen");
    let version_column_count: i64 = database
        .connection()
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('model_secrets') WHERE name = 'version'",
            [],
            |row| row.get(0),
        )
        .expect("query repaired secret version column");

    assert_eq!(version_column_count, 1);

    remove_workspace(&workspace_dir);
}

#[test]
fn migration_runner_applies_pending_migrations_once() {
    let workspace_dir = initialized_workspace("migration-once");
    let database = WorkspaceDatabase::open(&workspace_dir).expect("workspace database should open");
    let migrations = [Migration::new(
        901,
        "create_probe_table",
        "CREATE TABLE migration_probe (id INTEGER PRIMARY KEY, name TEXT NOT NULL);",
    )];

    MigrationRunner::new(&migrations)
        .run(database.connection())
        .expect("migration should run");
    MigrationRunner::new(&migrations)
        .run(database.connection())
        .expect("migration should be idempotent");

    assert_eq!(
        database.applied_migrations().expect("query migrations"),
        vec![1, 901]
    );
    let table_count: i64 = database
        .connection()
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'migration_probe'",
            [],
            |row| row.get(0),
        )
        .expect("query probe table");
    assert_eq!(table_count, 1);

    remove_workspace(&workspace_dir);
}

#[test]
fn migration_runner_does_not_mark_failed_migration_as_applied() {
    let workspace_dir = initialized_workspace("migration-fail");
    let database = WorkspaceDatabase::open(&workspace_dir).expect("workspace database should open");
    let migrations = [Migration::new(902, "broken_sql", "CREATE TABLE broken (")];

    let result = MigrationRunner::new(&migrations).run(database.connection());

    assert!(result.is_err());
    assert!(
        database
            .applied_migrations()
            .expect("query applied migrations")
            == vec![1],
        "failed migrations must not be recorded as applied",
    );

    remove_workspace(&workspace_dir);
}

fn initialized_workspace(label: &str) -> PathBuf {
    let workspace_dir = unique_temp_workspace(label);
    WorkspaceService::new(WorkspaceFileSystem::new())
        .initialize_workspace(InitializeWorkspaceInput {
            workspace_directory: workspace_dir.clone(),
        })
        .expect("workspace should initialize");
    workspace_dir
}

fn unique_temp_workspace(label: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time before epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("commerce-shoot-studio-db-{label}-{nanos}"))
}

fn remove_workspace(path: &Path) {
    let _ = fs::remove_dir_all(path);
}
