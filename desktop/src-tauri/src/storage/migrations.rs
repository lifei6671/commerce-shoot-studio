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
