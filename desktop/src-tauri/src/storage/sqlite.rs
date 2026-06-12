use std::path::Path;

use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::{Connection, Executor, SqliteConnection, SqlitePool};
use tokio::sync::{Mutex, MutexGuard};

use crate::error::AppResult;

pub struct WorkspaceDatabase {
    pool: SqlitePool,
    writer: Mutex<SqliteConnection>,
}

impl WorkspaceDatabase {
    pub async fn connect(database_path: &Path) -> AppResult<Self> {
        let options = sqlite_options(database_path);
        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .after_connect(|connection, _meta| {
                Box::pin(async move {
                    connection.execute("PRAGMA foreign_keys = ON").await?;
                    Ok(())
                })
            })
            .connect_with(options.clone())
            .await?;

        let mut writer = SqliteConnection::connect_with(&options).await?;
        writer.execute("PRAGMA foreign_keys = ON").await?;

        Ok(Self {
            pool,
            writer: Mutex::new(writer),
        })
    }

    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }

    pub async fn writer(&self) -> MutexGuard<'_, SqliteConnection> {
        self.writer.lock().await
    }
}

pub fn sqlite_options(database_path: &Path) -> SqliteConnectOptions {
    SqliteConnectOptions::new()
        .filename(database_path)
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .foreign_keys(true)
}

#[cfg(test)]
mod tests {
    use sqlx::{Executor, Row};

    use super::*;

    #[tokio::test]
    async fn connect_enables_foreign_keys_for_pool_and_writer() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let database = WorkspaceDatabase::connect(&temp_dir.path().join("workspace.db"))
            .await
            .expect("connect");

        let pool_foreign_keys: i64 = sqlx::query("PRAGMA foreign_keys")
            .fetch_one(database.pool())
            .await
            .expect("pool pragma")
            .get(0);
        assert_eq!(pool_foreign_keys, 1);

        let mut writer = database.writer().await;
        let row = writer
            .fetch_one("PRAGMA foreign_keys")
            .await
            .expect("writer pragma");
        let writer_foreign_keys: i64 = row.get(0);
        drop(writer);
        assert_eq!(writer_foreign_keys, 1);
    }

    #[tokio::test]
    async fn writer_serializes_write_operations() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let database = WorkspaceDatabase::connect(&temp_dir.path().join("workspace.db"))
            .await
            .expect("connect");

        let mut writer = database.writer().await;
        writer
            .execute("CREATE TABLE writes (id INTEGER PRIMARY KEY, value TEXT NOT NULL)")
            .await
            .expect("create table");
        drop(writer);

        let mut writer = database.writer().await;
        writer
            .execute("INSERT INTO writes (value) VALUES ('first')")
            .await
            .expect("insert first");
        writer
            .execute("INSERT INTO writes (value) VALUES ('second')")
            .await
            .expect("insert second");
        drop(writer);

        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM writes")
            .fetch_one(database.pool())
            .await
            .expect("count rows");
        assert_eq!(count, 2);
    }
}
