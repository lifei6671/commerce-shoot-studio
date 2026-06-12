use std::fs;
use std::path::{Path, PathBuf};

use chrono::Utc;

use crate::error::AppResult;

pub const WORKSPACE_DATABASE_FILE: &str = "workspace.db";
pub const BACKUPS_DIR: &str = "backups";

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

    pub fn backup_database_before_migration(&self) -> AppResult<Option<PathBuf>> {
        self.ensure()?;
        let database_path = self.database_path();
        if !database_path.exists() {
            return Ok(None);
        }

        let timestamp = Utc::now().format("%Y%m%d%H%M%S");
        let backup_path = self
            .backups_dir()
            .join(format!("workspace-{timestamp}.db"));
        fs::copy(database_path, &backup_path)?;
        Ok(Some(backup_path))
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;

    #[test]
    fn backup_database_before_migration_copies_workspace_db_into_backups() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let paths = WorkspacePaths::new(temp_dir.path().to_path_buf());
        paths.ensure().expect("ensure workspace");
        fs::write(paths.database_path(), b"workspace-data").expect("write db");

        let backup = paths
            .backup_database_before_migration()
            .expect("backup")
            .expect("backup path");

        assert!(backup.starts_with(paths.backups_dir()));
        assert_eq!(fs::read(backup).expect("read backup"), b"workspace-data");
    }

    #[test]
    fn backup_database_before_migration_skips_missing_database() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let paths = WorkspacePaths::new(temp_dir.path().to_path_buf());

        let backup = paths
            .backup_database_before_migration()
            .expect("backup skipped");

        assert!(backup.is_none());
        assert!(paths.backups_dir().exists());
    }
}
