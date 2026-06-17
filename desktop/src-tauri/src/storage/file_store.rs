use std::fs;
use std::path::{Path, PathBuf};

use chrono::Utc;
use sqlx::Executor;

use crate::error::AppResult;
use crate::storage::sqlite::WorkspaceDatabase;

pub const WORKSPACE_DATABASE_FILE: &str = "workspace.db";
pub const BACKUPS_DIR: &str = "backups";
const MIGRATION_BACKUP_PREFIX: &str = "workspace-migration-";
const MIGRATION_BACKUP_SUFFIX: &str = ".db";

#[derive(Debug, Clone)]
pub struct WorkspacePaths {
    root: PathBuf,
}

impl WorkspacePaths {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn database_path(&self) -> PathBuf {
        self.root.join(WORKSPACE_DATABASE_FILE)
    }

    pub fn backups_dir(&self) -> PathBuf {
        self.root.join(BACKUPS_DIR)
    }

    pub fn ensure(&self) -> AppResult<()> {
        fs::create_dir_all(self.root())?;
        fs::create_dir_all(self.backups_dir())?;
        Ok(())
    }

    pub fn next_migration_backup_path(&self) -> AppResult<Option<PathBuf>> {
        self.ensure()?;
        let database_path = self.database_path();
        if !database_path.exists() {
            return Ok(None);
        }

        let timestamp = Utc::now().format("%Y%m%d%H%M%S");
        let mut backup_path = self.backups_dir().join(format!(
            "{MIGRATION_BACKUP_PREFIX}{timestamp}{MIGRATION_BACKUP_SUFFIX}"
        ));
        let mut suffix = 1;
        while backup_path.exists() {
            backup_path = self.backups_dir().join(format!(
                "{MIGRATION_BACKUP_PREFIX}{timestamp}-{suffix}{MIGRATION_BACKUP_SUFFIX}"
            ));
            suffix += 1;
        }
        Ok(Some(backup_path))
    }

    pub async fn backup_database_before_migration(
        &self,
        database: &WorkspaceDatabase,
    ) -> AppResult<Option<PathBuf>> {
        let Some(backup_path) = self.next_migration_backup_path()? else {
            return Ok(None);
        };

        let backup_path_text = backup_path.to_string_lossy().to_string();
        let mut writer = database.writer().await;
        writer.execute("PRAGMA wal_checkpoint(FULL)").await?;
        sqlx::query("VACUUM main INTO ?")
            .bind(backup_path_text)
            .execute(&mut *writer)
            .await?;
        Ok(Some(backup_path))
    }
}

#[cfg(test)]
mod tests {
    use sqlx::Executor;

    use crate::storage::sqlite::WorkspaceDatabase;

    use super::*;

    #[tokio::test]
    async fn backup_database_before_migration_writes_workspace_db_into_backups() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let paths = WorkspacePaths::new(temp_dir.path().to_path_buf());
        paths.ensure().expect("ensure workspace");
        let database = WorkspaceDatabase::connect(&paths.database_path())
            .await
            .expect("connect database");
        let mut writer = database.writer().await;
        writer
            .execute("CREATE TABLE backup_probe (id TEXT PRIMARY KEY, value TEXT NOT NULL)")
            .await
            .expect("create table");
        writer
            .execute("INSERT INTO backup_probe (id, value) VALUES ('latest', 'committed')")
            .await
            .expect("insert row");
        drop(writer);

        let backup = paths
            .backup_database_before_migration(&database)
            .await
            .expect("backup")
            .expect("backup path");

        assert!(backup.starts_with(paths.backups_dir()));
        assert!(backup
            .file_name()
            .and_then(|value| value.to_str())
            .is_some_and(|file_name| file_name.starts_with(MIGRATION_BACKUP_PREFIX)));
        assert!(backup.exists());
    }

    #[test]
    fn backup_database_before_migration_skips_missing_database() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let paths = WorkspacePaths::new(temp_dir.path().to_path_buf());

        let backup = paths.next_migration_backup_path().expect("backup skipped");

        assert!(backup.is_none());
        assert!(paths.backups_dir().exists());
    }

    #[tokio::test]
    async fn backup_database_before_migration_contains_committed_wal_changes() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let paths = WorkspacePaths::new(temp_dir.path().to_path_buf());
        paths.ensure().expect("ensure workspace");
        let database = WorkspaceDatabase::connect(&paths.database_path())
            .await
            .expect("connect database");
        let mut writer = database.writer().await;
        writer
            .execute("PRAGMA wal_autocheckpoint = 0")
            .await
            .expect("disable auto checkpoint");
        writer
            .execute("CREATE TABLE backup_probe (id TEXT PRIMARY KEY, value TEXT NOT NULL)")
            .await
            .expect("create table");
        writer
            .execute("INSERT INTO backup_probe (id, value) VALUES ('latest', 'committed')")
            .await
            .expect("insert row");
        drop(writer);

        let backup_path = paths
            .backup_database_before_migration(&database)
            .await
            .expect("backup")
            .expect("backup path");
        let backup = WorkspaceDatabase::connect(&backup_path)
            .await
            .expect("connect backup");
        let value: String =
            sqlx::query_scalar("SELECT value FROM backup_probe WHERE id = 'latest'")
                .fetch_one(backup.pool())
                .await
                .expect("backup row");

        assert_eq!(value, "committed");
    }
}
