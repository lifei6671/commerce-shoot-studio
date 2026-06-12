use sqlx::QueryBuilder;

use crate::domain::task::{APP_UNEXPECTED_SHUTDOWN, RUNNING_TASK_STATUSES};
use crate::error::AppResult;
use crate::storage::sqlite::WorkspaceDatabase;

pub async fn recover_interrupted_tasks(database: &WorkspaceDatabase) -> AppResult<u64> {
    let mut writer = database.writer().await;
    let mut builder =
        QueryBuilder::new("UPDATE generation_tasks SET status = 'failed', error_code = ");
    builder.push_bind(APP_UNEXPECTED_SHUTDOWN);
    builder.push(", finished_at = datetime('now') WHERE status IN (");

    let mut separated = builder.separated(", ");
    for status in RUNNING_TASK_STATUSES {
        separated.push_bind(status);
    }
    separated.push_unseparated(")");

    let result = builder.build().execute(&mut *writer).await?;
    Ok(result.rows_affected())
}

#[cfg(test)]
mod tests {
    use sqlx::Row;

    use super::*;

    #[tokio::test]
    async fn recover_interrupted_tasks_fails_only_running_tasks() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let database = WorkspaceDatabase::connect(&temp_dir.path().join("workspace.db"))
            .await
            .expect("connect");

        let mut writer = database.writer().await;
        sqlx::query(
            "CREATE TABLE generation_tasks (
                id TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                error_code TEXT,
                finished_at TEXT
            )",
        )
        .execute(&mut *writer)
        .await
        .expect("create table");

        for (id, status) in [
            ("task-queued", "queued"),
            ("task-calling", "calling_model"),
            ("task-succeeded", "succeeded"),
        ] {
            sqlx::query("INSERT INTO generation_tasks (id, status) VALUES (?, ?)")
                .bind(id)
                .bind(status)
                .execute(&mut *writer)
                .await
                .expect("insert task");
        }
        drop(writer);

        let recovered = recover_interrupted_tasks(&database)
            .await
            .expect("recover");
        assert_eq!(recovered, 2);

        let rows = sqlx::query("SELECT id, status, error_code FROM generation_tasks ORDER BY id")
            .fetch_all(database.pool())
            .await
            .expect("fetch tasks");

        let states: Vec<(String, String, Option<String>)> = rows
            .into_iter()
            .map(|row| (row.get("id"), row.get("status"), row.get("error_code")))
            .collect();

        assert_eq!(
            states,
            vec![
                (
                    "task-calling".to_string(),
                    "failed".to_string(),
                    Some(APP_UNEXPECTED_SHUTDOWN.to_string())
                ),
                (
                    "task-queued".to_string(),
                    "failed".to_string(),
                    Some(APP_UNEXPECTED_SHUTDOWN.to_string())
                ),
                ("task-succeeded".to_string(), "succeeded".to_string(), None),
            ]
        );
    }
}
