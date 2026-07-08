use std::error::Error;
use std::fmt;
use std::path::{Path, PathBuf};

use rusqlite::{params, Connection, Transaction};

const BASELINE_MIGRATIONS: &[Migration] = &[Migration::new(
    1,
    "create_settings_table",
    "
    CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        settings_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('source', 'reference', 'model', 'generated', 'thumbnail')),
        name TEXT NOT NULL,
        original_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        width INTEGER,
        height INTEGER,
        size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
        lifecycle TEXT NOT NULL DEFAULT 'staged' CHECK (lifecycle IN ('staged', 'active', 'deleted')),
        deleted_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_assets_relative_path ON assets(relative_path);
    CREATE INDEX IF NOT EXISTS idx_assets_kind_created_at ON assets(kind, created_at);
    CREATE INDEX IF NOT EXISTS idx_assets_sha256 ON assets(sha256);
    CREATE INDEX IF NOT EXISTS idx_assets_lifecycle_created_at ON assets(lifecycle, created_at);
    CREATE INDEX IF NOT EXISTS idx_assets_deleted_at ON assets(deleted_at);

    CREATE TABLE IF NOT EXISTS generation_tasks (
        id TEXT PRIMARY KEY,
        retry_of_task_id TEXT,
        attempt_no INTEGER NOT NULL CHECK (attempt_no >= 1),
        idempotency_key TEXT,
        workspace TEXT NOT NULL CHECK (workspace IN ('product', 'clothing', 'scene')),
        kind TEXT NOT NULL CHECK (kind IN ('prompt-plan', 'image-generation', 'image-edit', 'listing-copy')),
        status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted')),
        stage TEXT NOT NULL CHECK (stage IN ('queued', 'validating', 'rendering-prompt', 'calling-provider', 'polling-provider', 'downloading-result', 'saving-result', 'completed', 'failed')),
        title TEXT NOT NULL,
        input_summary TEXT,
        prompt_plan_id TEXT,
        input_json TEXT,
        prompt_plan_snapshot_json TEXT,
        output_json TEXT,
        resolved_prompt_hash TEXT,
        error_json TEXT,
        hidden_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at TEXT,
        FOREIGN KEY (retry_of_task_id) REFERENCES generation_tasks(id) ON DELETE SET NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_generation_tasks_idempotency_key
        ON generation_tasks(idempotency_key)
        WHERE idempotency_key IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_generation_tasks_workspace_created_at
        ON generation_tasks(workspace, created_at);
    CREATE INDEX IF NOT EXISTS idx_generation_tasks_status_created_at
        ON generation_tasks(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_generation_tasks_hidden_at
        ON generation_tasks(hidden_at);

    CREATE TABLE IF NOT EXISTS generation_task_input_assets (
        task_id TEXT NOT NULL,
        asset_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('source', 'reference', 'model')),
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (task_id, asset_id, role),
        FOREIGN KEY (task_id) REFERENCES generation_tasks(id) ON DELETE CASCADE,
        FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS generation_assets (
        task_id TEXT NOT NULL,
        asset_id TEXT,
        role TEXT NOT NULL CHECK (role IN ('output', 'thumbnail')),
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (task_id, role, sort_order),
        FOREIGN KEY (task_id) REFERENCES generation_tasks(id) ON DELETE CASCADE,
        FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS task_events (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        stage TEXT CHECK (stage IN ('queued', 'validating', 'rendering-prompt', 'calling-provider', 'polling-provider', 'downloading-result', 'saving-result', 'completed', 'failed')),
        detail_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (task_id) REFERENCES generation_tasks(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_task_events_task_id_created_at
        ON task_events(task_id, created_at);

    CREATE TABLE IF NOT EXISTS model_configs (
        id TEXT PRIMARY KEY,
        capability_id TEXT NOT NULL,
        provider_profile_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        protocol TEXT NOT NULL CHECK (protocol IN ('openai', 'openai-compatible')),
        execution_mode TEXT NOT NULL CHECK (execution_mode IN ('sync', 'stream', 'async-task', 'auto')),
        model TEXT NOT NULL,
        endpoint_path TEXT,
        secret_ref TEXT,
        enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
        is_default INTEGER NOT NULL CHECK (is_default IN (0, 1)),
        connection_status TEXT NOT NULL DEFAULT 'untested' CHECK (connection_status IN ('untested', 'available', 'unavailable')),
        connection_message TEXT,
        connection_tested_at TEXT,
        connection_fingerprint TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_model_configs_default
        ON model_configs(capability_id)
        WHERE is_default = 1;
    CREATE INDEX IF NOT EXISTS idx_model_configs_capability_enabled
        ON model_configs(capability_id, enabled);
    CREATE INDEX IF NOT EXISTS idx_model_configs_provider_profile
        ON model_configs(provider_profile_id);

    CREATE TABLE IF NOT EXISTS model_secrets (
        id TEXT PRIMARY KEY,
        provider_profile_id TEXT NOT NULL,
        capability_id TEXT NOT NULL DEFAULT '',
        secret_value TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(provider_profile_id, capability_id)
    );

    CREATE TABLE IF NOT EXISTS model_invocations (
        id TEXT PRIMARY KEY,
        capability_id TEXT NOT NULL,
        provider_profile_id TEXT NOT NULL,
        model TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed')),
        request_summary_json TEXT NOT NULL,
        output_summary_json TEXT,
        usage_json TEXT,
        error_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_model_invocations_capability_created_at
        ON model_invocations(capability_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_model_invocations_status_created_at
        ON model_invocations(status, created_at);
    ",
)];

#[derive(Debug)]
pub enum DatabaseError {
    Open {
        path: PathBuf,
        source: rusqlite::Error,
    },
    Sqlite(rusqlite::Error),
}

impl fmt::Display for DatabaseError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            DatabaseError::Open { path, source } => {
                write!(
                    formatter,
                    "打开 workspace.db 失败：{} ({source})",
                    path.display()
                )
            }
            DatabaseError::Sqlite(source) => write!(formatter, "SQLite 操作失败：{source}"),
        }
    }
}

impl Error for DatabaseError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            DatabaseError::Open { source, .. } => Some(source),
            DatabaseError::Sqlite(source) => Some(source),
        }
    }
}

impl From<rusqlite::Error> for DatabaseError {
    fn from(source: rusqlite::Error) -> Self {
        DatabaseError::Sqlite(source)
    }
}

#[derive(Debug)]
pub struct WorkspaceDatabase {
    connection: Connection,
}

impl WorkspaceDatabase {
    pub fn open(workspace_directory: &Path) -> Result<Self, DatabaseError> {
        let database_path = workspace_directory.join("workspace.db");
        let connection =
            Connection::open(&database_path).map_err(|source| DatabaseError::Open {
                path: database_path,
                source,
            })?;
        let database = Self { connection };
        database.configure_pragmas()?;
        MigrationRunner::new(BASELINE_MIGRATIONS).run(&database.connection)?;
        Ok(database)
    }

    pub fn connection(&self) -> &Connection {
        &self.connection
    }

    pub fn foreign_keys_enabled(&self) -> Result<bool, DatabaseError> {
        let enabled: i64 = self
            .connection
            .query_row("PRAGMA foreign_keys", [], |row| row.get(0))?;
        Ok(enabled == 1)
    }

    pub fn busy_timeout_ms(&self) -> Result<i64, DatabaseError> {
        let timeout_ms = self
            .connection
            .query_row("PRAGMA busy_timeout", [], |row| row.get(0))?;
        Ok(timeout_ms)
    }

    pub fn journal_mode(&self) -> Result<String, DatabaseError> {
        let journal_mode: String = self
            .connection
            .query_row("PRAGMA journal_mode", [], |row| row.get(0))?;
        Ok(journal_mode.to_lowercase())
    }

    pub fn applied_migrations(&self) -> Result<Vec<i64>, DatabaseError> {
        applied_migrations(&self.connection)
    }

    fn configure_pragmas(&self) -> Result<(), DatabaseError> {
        self.connection.execute_batch(
            "
            PRAGMA foreign_keys = ON;
            PRAGMA journal_mode = WAL;
            PRAGMA busy_timeout = 5000;
            ",
        )?;
        Ok(())
    }
}

#[derive(Debug, Clone, Copy)]
pub struct Migration {
    pub id: i64,
    pub name: &'static str,
    pub sql: &'static str,
}

impl Migration {
    pub const fn new(id: i64, name: &'static str, sql: &'static str) -> Self {
        Self { id, name, sql }
    }
}

#[derive(Debug)]
pub struct MigrationRunner<'a> {
    migrations: &'a [Migration],
}

impl<'a> MigrationRunner<'a> {
    pub fn new(migrations: &'a [Migration]) -> Self {
        Self { migrations }
    }

    pub fn run(&self, connection: &Connection) -> Result<(), DatabaseError> {
        ensure_migrations_table(connection)?;
        let applied_ids = applied_migrations(connection)?;

        for migration in self.migrations {
            if applied_ids.contains(&migration.id) {
                if migration.id == 1 {
                    repair_baseline_schema(connection, migration)?;
                }
                continue;
            }

            run_single_migration(connection, migration)?;
        }

        Ok(())
    }
}

fn repair_baseline_schema(
    connection: &Connection,
    migration: &Migration,
) -> Result<(), DatabaseError> {
    // 交付前 baseline schema 会持续补表。开发期旧 workspace 已记录 migration 1 时，
    // 仍需要重放 IF NOT EXISTS 语句来补齐新增表，避免要求用户手动删库。
    connection.execute_batch(migration.sql)?;
    repair_generation_tasks_listing_copy_schema(connection)?;
    repair_model_secrets_version_column(connection)?;
    Ok(())
}

fn repair_generation_tasks_listing_copy_schema(
    connection: &Connection,
) -> Result<(), DatabaseError> {
    let task_table_count: i64 = connection.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'generation_tasks'",
        [],
        |row| row.get(0),
    )?;
    if task_table_count == 0 {
        return Ok(());
    }

    let output_column_count: i64 = connection.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('generation_tasks') WHERE name = 'output_json'",
        [],
        |row| row.get(0),
    )?;
    if output_column_count == 0 {
        connection.execute_batch("ALTER TABLE generation_tasks ADD COLUMN output_json TEXT;")?;
    }

    let create_sql: String = connection.query_row(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'generation_tasks'",
        [],
        |row| row.get(0),
    )?;
    if !create_sql.contains("'listing-copy'") {
        rebuild_generation_tasks_table(connection)?;
    }

    Ok(())
}

fn rebuild_generation_tasks_table(connection: &Connection) -> Result<(), DatabaseError> {
    connection.execute_batch(
        "
        PRAGMA foreign_keys = OFF;
        PRAGMA legacy_alter_table = ON;

        DROP INDEX IF EXISTS idx_generation_tasks_idempotency_key;
        DROP INDEX IF EXISTS idx_generation_tasks_workspace_created_at;
        DROP INDEX IF EXISTS idx_generation_tasks_status_created_at;
        DROP INDEX IF EXISTS idx_generation_tasks_hidden_at;

        ALTER TABLE generation_tasks RENAME TO generation_tasks_old;

        CREATE TABLE generation_tasks (
            id TEXT PRIMARY KEY,
            retry_of_task_id TEXT,
            attempt_no INTEGER NOT NULL CHECK (attempt_no >= 1),
            idempotency_key TEXT,
            workspace TEXT NOT NULL CHECK (workspace IN ('product', 'clothing', 'scene')),
            kind TEXT NOT NULL CHECK (kind IN ('prompt-plan', 'image-generation', 'image-edit', 'listing-copy')),
            status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted')),
            stage TEXT NOT NULL CHECK (stage IN ('queued', 'validating', 'rendering-prompt', 'calling-provider', 'polling-provider', 'downloading-result', 'saving-result', 'completed', 'failed')),
            title TEXT NOT NULL,
            input_summary TEXT,
            prompt_plan_id TEXT,
            input_json TEXT,
            prompt_plan_snapshot_json TEXT,
            output_json TEXT,
            resolved_prompt_hash TEXT,
            error_json TEXT,
            hidden_at TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            completed_at TEXT,
            FOREIGN KEY (retry_of_task_id) REFERENCES generation_tasks(id) ON DELETE SET NULL
        );

        INSERT INTO generation_tasks (
            id, retry_of_task_id, attempt_no, idempotency_key, workspace, kind,
            status, stage, title, input_summary, prompt_plan_id, input_json,
            prompt_plan_snapshot_json, output_json, resolved_prompt_hash, error_json,
            hidden_at, created_at, updated_at, completed_at
        )
        SELECT
            id, retry_of_task_id, attempt_no, idempotency_key, workspace, kind,
            status, stage, title, input_summary, prompt_plan_id, input_json,
            prompt_plan_snapshot_json, output_json, resolved_prompt_hash, error_json,
            hidden_at, created_at, updated_at, completed_at
        FROM generation_tasks_old;

        DROP TABLE generation_tasks_old;

        CREATE UNIQUE INDEX IF NOT EXISTS idx_generation_tasks_idempotency_key
            ON generation_tasks(idempotency_key)
            WHERE idempotency_key IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_generation_tasks_workspace_created_at
            ON generation_tasks(workspace, created_at);
        CREATE INDEX IF NOT EXISTS idx_generation_tasks_status_created_at
            ON generation_tasks(status, created_at);
        CREATE INDEX IF NOT EXISTS idx_generation_tasks_hidden_at
            ON generation_tasks(hidden_at);

        PRAGMA foreign_keys = ON;
        PRAGMA legacy_alter_table = OFF;
        ",
    )?;
    Ok(())
}

fn repair_model_secrets_version_column(connection: &Connection) -> Result<(), DatabaseError> {
    let version_column_count: i64 = connection.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('model_secrets') WHERE name = 'version'",
        [],
        |row| row.get(0),
    )?;
    if version_column_count == 0 {
        connection.execute_batch(
            "ALTER TABLE model_secrets ADD COLUMN version INTEGER NOT NULL DEFAULT 1;",
        )?;
    }
    Ok(())
}

fn ensure_migrations_table(connection: &Connection) -> Result<(), DatabaseError> {
    connection.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS schema_migrations (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        ",
    )?;
    Ok(())
}

fn applied_migrations(connection: &Connection) -> Result<Vec<i64>, DatabaseError> {
    ensure_migrations_table(connection)?;
    let mut statement = connection.prepare("SELECT id FROM schema_migrations ORDER BY id ASC")?;
    let rows = statement.query_map([], |row| row.get::<_, i64>(0))?;
    let mut migration_ids = Vec::new();

    for row in rows {
        migration_ids.push(row?);
    }

    Ok(migration_ids)
}

fn run_single_migration(
    connection: &Connection,
    migration: &Migration,
) -> Result<(), DatabaseError> {
    let transaction = connection.unchecked_transaction()?;
    execute_migration_sql(&transaction, migration)?;
    transaction.commit()?;
    Ok(())
}

fn execute_migration_sql(
    transaction: &Transaction<'_>,
    migration: &Migration,
) -> Result<(), DatabaseError> {
    // migration SQL 和记录写入必须在同一事务内完成，避免失败 migration 被标记为已执行。
    transaction.execute_batch(migration.sql)?;
    transaction.execute(
        "INSERT INTO schema_migrations (id, name) VALUES (?1, ?2)",
        params![migration.id, migration.name],
    )?;
    Ok(())
}
