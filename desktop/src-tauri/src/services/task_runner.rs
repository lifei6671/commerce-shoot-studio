use serde_json::Value;
use sqlx::{Executor, QueryBuilder, Row};
use ulid::Ulid;

use crate::domain::task::{
    CreateGenerationTaskResultRequest, CreateGenerationTaskSnapshotRequest, GenerationTaskResult,
    LocalGenerationTask, APP_UNEXPECTED_SHUTDOWN, RUNNING_TASK_STATUSES,
};
use crate::error::{AppError, AppResult};
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

pub async fn create_generation_task_snapshot(
    database: &WorkspaceDatabase,
    request: CreateGenerationTaskSnapshotRequest,
) -> AppResult<LocalGenerationTask> {
    validate_safe_summary(request.request_summary_json.as_ref())?;

    let id = request
        .id
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| format!("generation_task_{}", Ulid::new()));

    let mut writer = database.writer().await;
    sqlx::query("BEGIN IMMEDIATE").execute(&mut *writer).await?;

    match get_running_task_id_for_writer(&mut *writer).await {
        Ok(Some(existing_task_id)) => {
            writer.execute("ROLLBACK").await?;
            return Err(AppError::TaskAlreadyRunning(existing_task_id));
        }
        Ok(None) => {}
        Err(err) => {
            writer.execute("ROLLBACK").await?;
            return Err(AppError::Storage(err));
        }
    }

    let write_result = async {
        sqlx::query(
            "INSERT INTO generation_tasks (
                id,
                combination_id,
                provider,
                model_id,
                status,
                progress,
                request_summary_json,
                input_snapshot_json,
                final_prompt_snapshot_json,
                model_config_snapshot_json,
                asset_snapshot_json,
                output_count
             ) VALUES (?, ?, ?, ?, 'queued', 0, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(&request.combination_id)
        .bind(&request.provider)
        .bind(&request.model_id)
        .bind(request.request_summary_json.as_ref().map(Value::to_string))
        .bind(request.input_snapshot_json.to_string())
        .bind(request.final_prompt_snapshot_json.to_string())
        .bind(request.model_config_snapshot_json.to_string())
        .bind(request.asset_snapshot_json.to_string())
        .bind(request.output_count)
        .execute(&mut *writer)
        .await?;

        for input_asset in &request.input_assets {
            sqlx::query(
                "INSERT INTO generation_task_input_assets (
                    task_id,
                    asset_id,
                    role,
                    view_type,
                    sort_order,
                    is_primary
                ) VALUES (?, ?, ?, ?, ?, ?)",
            )
            .bind(&id)
            .bind(&input_asset.asset_id)
            .bind(input_asset.role.as_str())
            .bind(&input_asset.view_type)
            .bind(input_asset.sort_order)
            .bind(if input_asset.is_primary { 1_i64 } else { 0_i64 })
            .execute(&mut *writer)
            .await?;
        }

        Ok::<(), sqlx::Error>(())
    }
    .await;

    if let Err(err) = write_result {
        writer.execute("ROLLBACK").await?;
        return Err(AppError::Storage(err));
    }

    writer.execute("COMMIT").await?;
    drop(writer);

    get_generation_task_by_id(database, &id)
        .await?
        .ok_or_else(|| AppError::InvalidInput("created generation task was not found".to_string()))
}

pub async fn get_generation_task_by_id(
    database: &WorkspaceDatabase,
    id: &str,
) -> AppResult<Option<LocalGenerationTask>> {
    let row = sqlx::query(
        "SELECT
            id,
            combination_id,
            provider,
            model_id,
            status,
            progress,
            request_summary_json,
            input_snapshot_json,
            final_prompt_snapshot_json,
            model_config_snapshot_json,
            asset_snapshot_json,
            output_count,
            created_at,
            updated_at
         FROM generation_tasks
         WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(database.pool())
    .await?;

    row.map(row_to_generation_task).transpose()
}

pub async fn create_generation_task_result(
    database: &WorkspaceDatabase,
    request: CreateGenerationTaskResultRequest,
) -> AppResult<GenerationTaskResult> {
    let id = request
        .id
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| format!("generation_task_result_{}", Ulid::new()));
    let source_url = request.source_url.as_deref().and_then(sanitize_source_url);

    sqlx::query(
        "INSERT INTO generation_task_results (
            id,
            task_id,
            asset_id,
            sort_order,
            source_url
         ) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&request.task_id)
    .bind(&request.asset_id)
    .bind(request.sort_order)
    .bind(&source_url)
    .execute(database.pool())
    .await?;

    get_generation_task_result_by_id(database, &id)
        .await?
        .ok_or_else(|| {
            AppError::InvalidInput("created generation task result was not found".to_string())
        })
}

pub async fn get_generation_task_result_by_id(
    database: &WorkspaceDatabase,
    id: &str,
) -> AppResult<Option<GenerationTaskResult>> {
    let row = sqlx::query(
        "SELECT id, task_id, asset_id, sort_order, source_url, created_at
         FROM generation_task_results
         WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(database.pool())
    .await?;

    Ok(row.map(row_to_generation_task_result))
}

pub fn sanitize_source_url(source_url: &str) -> Option<String> {
    let lower = source_url.to_ascii_lowercase();
    if !(lower.starts_with("https://") || lower.starts_with("http://")) {
        return None;
    }
    if let Some(query_start) = lower.find('?') {
        let query = &lower[query_start + 1..];
        if query.contains("token")
            || query.contains("signature")
            || query.contains("sig=")
            || query.contains("expires")
            || query.contains("x-amz")
            || query.contains("credential")
            || query.contains("api_key")
            || query.contains("apikey")
            || query.contains("access_key")
            || query.contains("authorization")
            || query.contains("secret")
        {
            return None;
        }
    }
    Some(source_url.to_string())
}

async fn get_running_task_id_for_writer(
    writer: &mut sqlx::SqliteConnection,
) -> Result<Option<String>, sqlx::Error> {
    let mut builder =
        QueryBuilder::<sqlx::Sqlite>::new("SELECT id FROM generation_tasks WHERE status IN (");
    let mut separated = builder.separated(", ");
    for status in RUNNING_TASK_STATUSES {
        separated.push_bind(status);
    }
    separated.push_unseparated(") ORDER BY created_at DESC LIMIT 1");

    builder.build_query_scalar().fetch_optional(writer).await
}

fn validate_safe_summary(summary: Option<&Value>) -> AppResult<()> {
    if let Some(summary) = summary {
        validate_safe_json_value(summary, "$")?;
    }
    Ok(())
}

fn validate_safe_json_value(value: &Value, path: &str) -> AppResult<()> {
    match value {
        Value::String(value) => {
            let lower = value.to_ascii_lowercase();
            if lower.contains("base64")
                || lower.contains("data:image")
                || lower.contains("authorization:")
                || lower.contains("bearer ")
                || lower.contains("/users/")
            {
                return Err(AppError::InvalidInput(format!(
                    "request_summary_json contains sensitive value at {path}"
                )));
            }
        }
        Value::Array(values) => {
            for (index, value) in values.iter().enumerate() {
                validate_safe_json_value(value, &format!("{path}[{index}]"))?;
            }
        }
        Value::Object(values) => {
            for (key, value) in values {
                let lower_key = key.to_ascii_lowercase();
                if lower_key.contains("rawresponse")
                    || lower_key.contains("apikey")
                    || lower_key.contains("api_key")
                    || lower_key.contains("authorization")
                    || lower_key.contains("base64")
                {
                    return Err(AppError::InvalidInput(format!(
                        "request_summary_json contains sensitive key at {path}.{key}"
                    )));
                }
                validate_safe_json_value(value, &format!("{path}.{key}"))?;
            }
        }
        Value::Null | Value::Bool(_) | Value::Number(_) => {}
    }
    Ok(())
}

fn row_to_generation_task(row: sqlx::sqlite::SqliteRow) -> AppResult<LocalGenerationTask> {
    Ok(LocalGenerationTask {
        id: row.get("id"),
        combination_id: row.get("combination_id"),
        provider: row.get("provider"),
        model_id: row.get("model_id"),
        status: row.get("status"),
        progress: row.get("progress"),
        request_summary_json: parse_optional_json(row.get("request_summary_json"))?,
        input_snapshot_json: parse_required_json(row.get("input_snapshot_json"))?,
        final_prompt_snapshot_json: parse_required_json(row.get("final_prompt_snapshot_json"))?,
        model_config_snapshot_json: parse_required_json(row.get("model_config_snapshot_json"))?,
        asset_snapshot_json: parse_required_json(row.get("asset_snapshot_json"))?,
        output_count: row.get("output_count"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    })
}

fn row_to_generation_task_result(row: sqlx::sqlite::SqliteRow) -> GenerationTaskResult {
    GenerationTaskResult {
        id: row.get("id"),
        task_id: row.get("task_id"),
        asset_id: row.get("asset_id"),
        sort_order: row.get("sort_order"),
        source_url: row.get("source_url"),
        created_at: row.get("created_at"),
    }
}

fn parse_optional_json(value: Option<String>) -> AppResult<Option<Value>> {
    value
        .map(|value| serde_json::from_str(&value))
        .transpose()
        .map_err(|err| AppError::InvalidInput(format!("task json field is invalid: {err}")))
}

fn parse_required_json(value: String) -> AppResult<Value> {
    serde_json::from_str(&value)
        .map_err(|err| AppError::InvalidInput(format!("task json field is invalid: {err}")))
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use sqlx::Row;

    use super::*;
    use crate::domain::task::{
        CreateGenerationTaskResultRequest, CreateGenerationTaskSnapshotRequest,
        GenerationTaskInputAsset, GenerationTaskInputRole,
    };
    use crate::storage::file_store::WorkspacePaths;
    use crate::storage::migrations::run_workspace_migrations;

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

        let recovered = recover_interrupted_tasks(&database).await.expect("recover");
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

    #[tokio::test]
    async fn create_generation_task_snapshot_persists_snapshots_and_input_asset_refs() {
        let (_temp_dir, database) = test_database().await;
        seed_assets(&database).await;

        let task = create_generation_task_snapshot(
            &database,
            CreateGenerationTaskSnapshotRequest {
                id: Some("task_1".to_string()),
                combination_id: None,
                provider: "openai".to_string(),
                model_id: "gpt-image-1".to_string(),
                request_summary_json: Some(json!({
                    "provider": "openai",
                    "modelId": "gpt-image-1",
                    "assetCount": 2,
                    "promptLength": 24
                })),
                input_snapshot_json: json!({"inputAssets": ["person_1", "garment_1"]}),
                final_prompt_snapshot_json: json!({"user": "wear linen dress"}),
                model_config_snapshot_json: json!({"modelId": "gpt-image-1", "outputCount": 1}),
                asset_snapshot_json: json!([
                    {"assetId": "person_1", "relativePath": "assets/person/person_1.png"},
                    {"assetId": "garment_1", "relativePath": "assets/garment/garment_1.png"}
                ]),
                input_assets: vec![
                    GenerationTaskInputAsset {
                        asset_id: "person_1".to_string(),
                        role: GenerationTaskInputRole::Person,
                        view_type: None,
                        sort_order: 0,
                        is_primary: true,
                    },
                    GenerationTaskInputAsset {
                        asset_id: "garment_1".to_string(),
                        role: GenerationTaskInputRole::Garment,
                        view_type: Some("front".to_string()),
                        sort_order: 0,
                        is_primary: false,
                    },
                ],
                output_count: 1,
            },
        )
        .await
        .expect("create task");

        assert_eq!(task.status, "queued");
        assert_eq!(task.final_prompt_snapshot_json["user"], "wear linen dress");
        assert_eq!(task.model_config_snapshot_json["modelId"], "gpt-image-1");

        let input_refs: Vec<(String, String, i64)> = sqlx::query(
            "SELECT asset_id, role, is_primary
             FROM generation_task_input_assets
             WHERE task_id = ?
             ORDER BY role DESC",
        )
        .bind(&task.id)
        .fetch_all(database.pool())
        .await
        .expect("input refs")
        .into_iter()
        .map(|row| (row.get("asset_id"), row.get("role"), row.get("is_primary")))
        .collect();

        assert_eq!(
            input_refs,
            vec![
                ("person_1".to_string(), "person".to_string(), 1),
                ("garment_1".to_string(), "garment".to_string(), 0),
            ]
        );
    }

    #[tokio::test]
    async fn create_generation_task_snapshot_rejects_unsafe_request_summary() {
        let (_temp_dir, database) = test_database().await;
        seed_assets(&database).await;

        let result = create_generation_task_snapshot(
            &database,
            CreateGenerationTaskSnapshotRequest {
                id: Some("task_unsafe".to_string()),
                combination_id: None,
                provider: "openai".to_string(),
                model_id: "gpt-image-1".to_string(),
                request_summary_json: Some(json!({
                    "Authorization": "Bearer secret",
                    "image": "data:image/png;base64,AAAA"
                })),
                input_snapshot_json: json!({}),
                final_prompt_snapshot_json: json!({"user": "prompt"}),
                model_config_snapshot_json: json!({}),
                asset_snapshot_json: json!([]),
                input_assets: vec![],
                output_count: 1,
            },
        )
        .await;

        assert!(matches!(result, Err(AppError::InvalidInput(_))));

        let task_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM generation_tasks")
            .fetch_one(database.pool())
            .await
            .expect("task count");
        assert_eq!(task_count, 0);
    }

    #[tokio::test]
    async fn create_generation_task_snapshot_rejects_existing_running_task() {
        let (_temp_dir, database) = test_database().await;
        seed_assets(&database).await;
        create_minimal_task(&database, "task_first").await;

        let second = create_generation_task_snapshot(
            &database,
            CreateGenerationTaskSnapshotRequest {
                id: Some("task_second".to_string()),
                combination_id: None,
                provider: "openai".to_string(),
                model_id: "gpt-image-1".to_string(),
                request_summary_json: Some(json!({"provider": "openai"})),
                input_snapshot_json: json!({}),
                final_prompt_snapshot_json: json!({"user": "prompt"}),
                model_config_snapshot_json: json!({"modelId": "gpt-image-1"}),
                asset_snapshot_json: json!([]),
                input_assets: vec![],
                output_count: 1,
            },
        )
        .await;

        assert!(matches!(
            second,
            Err(AppError::TaskAlreadyRunning(task_id)) if task_id == "task_first"
        ));

        let task_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM generation_tasks")
            .fetch_one(database.pool())
            .await
            .expect("task count");
        assert_eq!(task_count, 1);
    }

    #[tokio::test]
    async fn create_generation_task_result_sanitizes_source_url_before_persisting() {
        let (_temp_dir, database) = test_database().await;
        seed_assets(&database).await;
        create_minimal_task(&database, "task_for_result").await;

        let safe_result = create_generation_task_result(
            &database,
            CreateGenerationTaskResultRequest {
                id: Some("result_safe".to_string()),
                task_id: "task_for_result".to_string(),
                asset_id: "result_1".to_string(),
                sort_order: 0,
                source_url: Some("https://cdn.example.com/result.png".to_string()),
            },
        )
        .await
        .expect("safe result");

        assert_eq!(
            safe_result.source_url,
            Some("https://cdn.example.com/result.png".to_string())
        );

        let signed_result = create_generation_task_result(
            &database,
            CreateGenerationTaskResultRequest {
                id: Some("result_signed".to_string()),
                task_id: "task_for_result".to_string(),
                asset_id: "result_1".to_string(),
                sort_order: 1,
                source_url: Some("https://cdn.example.com/result.png?token=secret".to_string()),
            },
        )
        .await
        .expect("signed result");

        assert_eq!(signed_result.source_url, None);

        let refs: Vec<(String, String, i64, Option<String>)> = sqlx::query(
            "SELECT task_id, asset_id, sort_order, source_url
             FROM generation_task_results
             WHERE task_id = ?
             ORDER BY sort_order",
        )
        .bind("task_for_result")
        .fetch_all(database.pool())
        .await
        .expect("result refs")
        .into_iter()
        .map(|row| {
            (
                row.get("task_id"),
                row.get("asset_id"),
                row.get("sort_order"),
                row.get("source_url"),
            )
        })
        .collect();

        assert_eq!(
            refs,
            vec![
                (
                    "task_for_result".to_string(),
                    "result_1".to_string(),
                    0,
                    Some("https://cdn.example.com/result.png".to_string()),
                ),
                (
                    "task_for_result".to_string(),
                    "result_1".to_string(),
                    1,
                    None,
                ),
            ]
        );
    }

    #[test]
    fn sanitize_source_url_drops_signed_or_sensitive_urls() {
        assert_eq!(
            sanitize_source_url("https://cdn.example.com/result.png"),
            Some("https://cdn.example.com/result.png".to_string())
        );
        assert_eq!(
            sanitize_source_url("https://cdn.example.com/result.png?token=secret"),
            None
        );
        assert_eq!(
            sanitize_source_url("https://cdn.example.com/result.png?X-Amz-Signature=abc"),
            None
        );
        assert_eq!(
            sanitize_source_url("https://cdn.example.com/result.png?api_key=secret"),
            None
        );
        assert_eq!(sanitize_source_url("file:///Users/me/result.png"), None);
    }

    async fn test_database() -> (tempfile::TempDir, WorkspaceDatabase) {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let paths = WorkspacePaths::new(temp_dir.path().join("workspace"));
        paths.ensure().expect("ensure workspace");
        let database = WorkspaceDatabase::connect(&paths.database_path())
            .await
            .expect("connect");
        run_workspace_migrations(&paths, &database)
            .await
            .expect("migrate");
        (temp_dir, database)
    }

    async fn seed_assets(database: &WorkspaceDatabase) {
        let mut writer = database.writer().await;
        for (id, asset_type) in [
            ("person_1", "person"),
            ("garment_1", "garment"),
            ("result_1", "result"),
        ] {
            sqlx::query(
                "INSERT INTO assets (
                    id, asset_type, original_name, relative_path, thumb_relative_path,
                    mime_type, sha256, width, height
                ) VALUES (?, ?, ?, ?, ?, 'image/png', ?, 10, 10)",
            )
            .bind(id)
            .bind(asset_type)
            .bind(format!("{id}.png"))
            .bind(format!("assets/{asset_type}/{id}.png"))
            .bind(format!("assets/cache/thumbs/{id}.jpg"))
            .bind(format!("sha-{id}"))
            .execute(&mut *writer)
            .await
            .expect("seed asset");
        }
    }

    async fn create_minimal_task(database: &WorkspaceDatabase, id: &str) {
        create_generation_task_snapshot(
            database,
            CreateGenerationTaskSnapshotRequest {
                id: Some(id.to_string()),
                combination_id: None,
                provider: "openai".to_string(),
                model_id: "gpt-image-1".to_string(),
                request_summary_json: Some(json!({"provider": "openai"})),
                input_snapshot_json: json!({}),
                final_prompt_snapshot_json: json!({"user": "prompt"}),
                model_config_snapshot_json: json!({"modelId": "gpt-image-1"}),
                asset_snapshot_json: json!([]),
                input_assets: vec![],
                output_count: 1,
            },
        )
        .await
        .expect("create minimal task");
    }
}
