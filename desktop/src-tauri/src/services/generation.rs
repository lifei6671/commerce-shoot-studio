use std::path::Path;
use std::str::FromStr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::types::Value;
use rusqlite::{params, params_from_iter, OptionalExtension, Row};
use serde::Deserialize;
use serde_json::json;

use crate::domain::assets::Asset;
use crate::domain::generation::{
    GenerationError, GenerationTask, GenerationTaskAsset, GenerationTaskDetail, GenerationTaskKind,
    GenerationTaskStage, GenerationTaskStatus, NormalizedTaskError, TaskEvent, WorkspaceKind,
};
use crate::infrastructure::database::{DatabaseError, WorkspaceDatabase};

static TASK_ID_SEQUENCE: AtomicU64 = AtomicU64::new(0);
static EVENT_ID_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateGenerationTaskInput {
    pub idempotency_key: Option<String>,
    pub workspace: WorkspaceKind,
    pub kind: GenerationTaskKind,
    pub title: String,
    pub prompt_plan_id: Option<String>,
    pub input: Option<serde_json::Value>,
    #[serde(default)]
    pub input_assets: Vec<GenerationTaskInputAssetInput>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationTaskInputAssetInput {
    pub asset_id: String,
    pub role: String,
    pub sort_order: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetryGenerationTaskInput {
    pub task_id: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationTaskQuery {
    pub workspace: Option<WorkspaceKind>,
    pub status: Option<GenerationTaskStatus>,
    pub page: Option<i64>,
    pub page_size: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GenerationTaskPage {
    pub items: Vec<GenerationTask>,
    pub page: i64,
    pub page_size: i64,
    pub total: i64,
}

#[derive(Debug, Clone)]
struct StoredGenerationTask {
    task: GenerationTask,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct GenerationService;

impl GenerationService {
    pub fn new() -> Self {
        Self
    }

    pub fn create_task(
        &self,
        workspace_directory: &Path,
        input: CreateGenerationTaskInput,
    ) -> Result<GenerationTask, GenerationError> {
        validate_title(&input.title)?;
        let database = open_database(workspace_directory)?;
        let idempotency_key = input.idempotency_key.unwrap_or_else(create_idempotency_key);

        if let Some(existing) = find_task_by_idempotency_key(&database, &idempotency_key)? {
            if existing.task.status == GenerationTaskStatus::Failed {
                return Err(GenerationError::RetryRequired(
                    NormalizedTaskError::task_retry_required(),
                ));
            }
            return Ok(existing.task);
        }

        let task_id = create_task_id();
        let input_json = serialize_optional_json(input.input)?;
        database.connection().execute(
            "
            INSERT INTO generation_tasks (
                id, attempt_no, idempotency_key, workspace, kind, status, stage,
                title, prompt_plan_id, input_json
            )
            VALUES (?1, 1, ?2, ?3, ?4, 'queued', 'queued', ?5, ?6, ?7)
            ",
            params![
                task_id,
                idempotency_key,
                input.workspace.as_str(),
                input.kind.as_str(),
                input.title,
                input.prompt_plan_id,
                input_json
            ],
        )?;
        for input_asset in &input.input_assets {
            link_input_asset(&database, &task_id, input_asset)?;
        }
        insert_task_event(
            &database,
            &task_id,
            "task.created",
            Some(GenerationTaskStage::Queued),
            Some(json!({
                "idempotency_key_present": true,
                "workspace": input.workspace.as_str(),
                "kind": input.kind.as_str(),
            })),
        )?;

        find_task_by_id(&database, &task_id)?
            .map(|stored| stored.task)
            .ok_or(GenerationError::NotFound(task_id))
    }

    pub fn retry_task(
        &self,
        workspace_directory: &Path,
        input: RetryGenerationTaskInput,
    ) -> Result<GenerationTask, GenerationError> {
        let database = open_database(workspace_directory)?;
        let original = find_task_by_id(&database, &input.task_id)?
            .ok_or_else(|| GenerationError::NotFound(input.task_id.clone()))?;
        let task_id = create_task_id();
        let attempt_no = original.task.attempt_no + 1;
        let idempotency_key = format!("retry:{}:{attempt_no}", original.task.id);

        database.connection().execute(
            "
            INSERT INTO generation_tasks (
                id, retry_of_task_id, attempt_no, idempotency_key, workspace, kind,
                status, stage, title, input_summary, prompt_plan_id, input_json,
                prompt_plan_snapshot_json
            )
            SELECT
                ?1, id, ?2, ?3, workspace, kind,
                'queued', 'queued', title, input_summary, prompt_plan_id, input_json,
                prompt_plan_snapshot_json
            FROM generation_tasks
            WHERE id = ?4
            ",
            params![task_id, attempt_no, idempotency_key, original.task.id],
        )?;
        database.connection().execute(
            "
            INSERT INTO generation_task_input_assets (task_id, asset_id, role, sort_order)
            SELECT ?1, asset_id, role, sort_order
            FROM generation_task_input_assets
            WHERE task_id = ?2
            ",
            params![task_id, original.task.id],
        )?;
        insert_task_event(
            &database,
            &task_id,
            "task.retried",
            Some(GenerationTaskStage::Queued),
            Some(json!({
                "retry_of_task_id": original.task.id,
                "attempt_no": attempt_no,
            })),
        )?;

        find_task_by_id(&database, &task_id)?
            .map(|stored| stored.task)
            .ok_or(GenerationError::NotFound(task_id))
    }

    pub fn cancel_task(
        &self,
        workspace_directory: &Path,
        task_id: &str,
    ) -> Result<GenerationTask, GenerationError> {
        let database = open_database(workspace_directory)?;
        ensure_task_exists(&database, task_id)?;
        let updated = database.connection().execute(
            "
            UPDATE generation_tasks
            SET status = 'cancelled',
                stage = 'failed',
                completed_at = COALESCE(completed_at, datetime('now')),
                updated_at = datetime('now')
            WHERE id = ?1 AND status IN ('queued', 'running')
            ",
            params![task_id],
        )?;
        if updated == 0 {
            return Err(GenerationError::Validation(
                "只有排队中或运行中的任务可以取消。".to_string(),
            ));
        }
        insert_task_event(
            &database,
            task_id,
            "task.cancelled",
            Some(GenerationTaskStage::Failed),
            Some(json!({ "normalized_error_code": "TASK_CANCELLED" })),
        )?;

        self.get_task(workspace_directory, task_id)
    }

    pub fn delete_task(
        &self,
        workspace_directory: &Path,
        task_id: &str,
    ) -> Result<(), GenerationError> {
        let database = open_database(workspace_directory)?;
        ensure_task_exists(&database, task_id)?;
        database.connection().execute(
            "
            UPDATE generation_tasks
            SET hidden_at = COALESCE(hidden_at, datetime('now')),
                updated_at = datetime('now')
            WHERE id = ?1
            ",
            params![task_id],
        )?;
        Ok(())
    }

    pub fn get_task(
        &self,
        workspace_directory: &Path,
        task_id: &str,
    ) -> Result<GenerationTask, GenerationError> {
        let database = open_database(workspace_directory)?;
        find_task_by_id(&database, task_id)?
            .map(|stored| stored.task)
            .ok_or_else(|| GenerationError::NotFound(task_id.to_string()))
    }

    pub fn get_task_detail(
        &self,
        workspace_directory: &Path,
        task_id: &str,
    ) -> Result<GenerationTaskDetail, GenerationError> {
        let database = open_database(workspace_directory)?;
        let task = find_task_by_id(&database, task_id)?
            .map(|stored| stored.task)
            .ok_or_else(|| GenerationError::NotFound(task_id.to_string()))?;

        Ok(GenerationTaskDetail {
            input_assets: list_task_assets(&database, task_id, TaskAssetTable::Input)?,
            output_assets: list_task_assets(&database, task_id, TaskAssetTable::Output)?,
            events: list_task_events(&database, task_id)?,
            task,
        })
    }

    pub fn list_tasks(
        &self,
        workspace_directory: &Path,
        query: GenerationTaskQuery,
    ) -> Result<GenerationTaskPage, GenerationError> {
        let database = open_database(workspace_directory)?;
        list_tasks(&database, query)
    }
}

fn open_database(workspace_directory: &Path) -> Result<WorkspaceDatabase, GenerationError> {
    WorkspaceDatabase::open(workspace_directory).map_err(GenerationError::from)
}

fn list_tasks(
    database: &WorkspaceDatabase,
    query: GenerationTaskQuery,
) -> Result<GenerationTaskPage, GenerationError> {
    let page = query.page.unwrap_or(1).max(1);
    let page_size = query.page_size.unwrap_or(50).clamp(1, 200);
    let offset = (page - 1) * page_size;
    let mut filters = vec!["hidden_at IS NULL"];
    let mut values = Vec::new();

    if let Some(workspace) = query.workspace {
        filters.push("workspace = ?");
        values.push(Value::Text(workspace.as_str().to_string()));
    }
    if let Some(status) = query.status {
        filters.push("status = ?");
        values.push(Value::Text(status.as_str().to_string()));
    }

    let where_clause = format!(" WHERE {}", filters.join(" AND "));
    let total_sql = format!("SELECT COUNT(*) FROM generation_tasks{where_clause}");
    let total: i64 =
        database
            .connection()
            .query_row(&total_sql, params_from_iter(values.iter()), |row| {
                row.get(0)
            })?;

    let list_sql = format!(
        "
        SELECT id, retry_of_task_id, attempt_no, idempotency_key, workspace, kind,
               status, stage, title, input_summary, prompt_plan_id,
               error_json, created_at, updated_at, completed_at
        FROM generation_tasks
        {where_clause}
        ORDER BY datetime(created_at) DESC, id DESC
        LIMIT ? OFFSET ?
        "
    );
    let mut list_values = values;
    list_values.push(Value::Integer(page_size));
    list_values.push(Value::Integer(offset));
    let mut statement = database.connection().prepare(&list_sql)?;
    let rows = statement.query_map(params_from_iter(list_values.iter()), stored_task_from_row)?;
    let mut items = Vec::new();

    for row in rows {
        items.push(row?.task);
    }

    Ok(GenerationTaskPage {
        items,
        page,
        page_size,
        total,
    })
}

fn find_task_by_id(
    database: &WorkspaceDatabase,
    task_id: &str,
) -> Result<Option<StoredGenerationTask>, GenerationError> {
    database
        .connection()
        .query_row(
            "
            SELECT id, retry_of_task_id, attempt_no, idempotency_key, workspace, kind,
                   status, stage, title, input_summary, prompt_plan_id,
                   error_json, created_at, updated_at, completed_at
            FROM generation_tasks
            WHERE id = ?1
            ",
            params![task_id],
            stored_task_from_row,
        )
        .optional()
        .map_err(GenerationError::from)
}

fn find_task_by_idempotency_key(
    database: &WorkspaceDatabase,
    idempotency_key: &str,
) -> Result<Option<StoredGenerationTask>, GenerationError> {
    database
        .connection()
        .query_row(
            "
            SELECT id, retry_of_task_id, attempt_no, idempotency_key, workspace, kind,
                   status, stage, title, input_summary, prompt_plan_id,
                   error_json, created_at, updated_at, completed_at
            FROM generation_tasks
            WHERE idempotency_key = ?1
            ",
            params![idempotency_key],
            stored_task_from_row,
        )
        .optional()
        .map_err(GenerationError::from)
}

fn ensure_task_exists(database: &WorkspaceDatabase, task_id: &str) -> Result<(), GenerationError> {
    if find_task_by_id(database, task_id)?.is_some() {
        return Ok(());
    }
    Err(GenerationError::NotFound(task_id.to_string()))
}

#[derive(Debug, Clone, Copy)]
enum TaskAssetTable {
    Input,
    Output,
}

fn list_task_assets(
    database: &WorkspaceDatabase,
    task_id: &str,
    table: TaskAssetTable,
) -> Result<Vec<GenerationTaskAsset>, GenerationError> {
    let sql = match table {
        TaskAssetTable::Input => {
            "
            SELECT rel.role, rel.sort_order,
                   asset.id, asset.kind, asset.name, asset.original_name,
                   asset.mime_type, asset.relative_path, asset.sha256,
                   asset.width, asset.height, asset.size_bytes, asset.lifecycle,
                   asset.deleted_at, asset.created_at, asset.updated_at
            FROM generation_task_input_assets rel
            JOIN assets asset ON asset.id = rel.asset_id
            WHERE rel.task_id = ?1
            ORDER BY rel.sort_order ASC, asset.created_at ASC
            "
        }
        TaskAssetTable::Output => {
            "
            SELECT rel.role, rel.sort_order,
                   asset.id, asset.kind, asset.name, asset.original_name,
                   asset.mime_type, asset.relative_path, asset.sha256,
                   asset.width, asset.height, asset.size_bytes, asset.lifecycle,
                   asset.deleted_at, asset.created_at, asset.updated_at
            FROM generation_assets rel
            JOIN assets asset ON asset.id = rel.asset_id
            WHERE rel.task_id = ?1
            ORDER BY rel.sort_order ASC, asset.created_at ASC
            "
        }
    };
    let mut statement = database.connection().prepare(sql)?;
    let rows = statement.query_map(params![task_id], task_asset_from_row)?;
    let mut assets = Vec::new();

    for row in rows {
        assets.push(row?);
    }

    Ok(assets)
}

fn list_task_events(
    database: &WorkspaceDatabase,
    task_id: &str,
) -> Result<Vec<TaskEvent>, GenerationError> {
    let mut statement = database.connection().prepare(
        "
        SELECT id, event_type, stage, detail_json, created_at
        FROM task_events
        WHERE task_id = ?1
        ORDER BY datetime(created_at) ASC, id ASC
        ",
    )?;
    let rows = statement.query_map(params![task_id], task_event_from_row)?;
    let mut events = Vec::new();

    for row in rows {
        events.push(row?);
    }

    Ok(events)
}

fn link_input_asset(
    database: &WorkspaceDatabase,
    task_id: &str,
    input_asset: &GenerationTaskInputAssetInput,
) -> Result<(), GenerationError> {
    validate_input_asset_role(&input_asset.role)?;
    ensure_input_asset_available(database, &input_asset.asset_id)?;
    database.connection().execute(
        "
        INSERT INTO generation_task_input_assets (task_id, asset_id, role, sort_order)
        VALUES (?1, ?2, ?3, ?4)
        ",
        params![
            task_id,
            input_asset.asset_id,
            input_asset.role,
            input_asset.sort_order
        ],
    )?;
    database.connection().execute(
        "
        UPDATE assets
        SET lifecycle = 'active',
            updated_at = datetime('now')
        WHERE id = ?1 AND lifecycle != 'deleted'
        ",
        params![input_asset.asset_id],
    )?;
    Ok(())
}

fn ensure_input_asset_available(
    database: &WorkspaceDatabase,
    asset_id: &str,
) -> Result<(), GenerationError> {
    let available_count: i64 = database.connection().query_row(
        "SELECT COUNT(*) FROM assets WHERE id = ?1 AND lifecycle != 'deleted' AND deleted_at IS NULL",
        params![asset_id],
        |row| row.get(0),
    )?;
    if available_count == 1 {
        return Ok(());
    }

    Err(GenerationError::Validation(format!(
        "任务输入资产不可用：{asset_id}"
    )))
}

fn validate_input_asset_role(role: &str) -> Result<(), GenerationError> {
    match role {
        "source" | "reference" | "model" => Ok(()),
        _ => Err(GenerationError::Validation(format!(
            "不支持的任务输入资产角色：{role}"
        ))),
    }
}

fn stored_task_from_row(row: &Row<'_>) -> Result<StoredGenerationTask, rusqlite::Error> {
    let workspace_value: String = row.get(4)?;
    let kind_value: String = row.get(5)?;
    let status_value: String = row.get(6)?;
    let stage_value: String = row.get(7)?;
    let error_json: Option<String> = row.get(11)?;

    Ok(StoredGenerationTask {
        task: GenerationTask {
            id: row.get(0)?,
            retry_of_task_id: row.get(1)?,
            attempt_no: row.get(2)?,
            idempotency_key: row.get(3)?,
            workspace: parse_row_value(4, &workspace_value)?,
            kind: parse_row_value(5, &kind_value)?,
            status: parse_row_value(6, &status_value)?,
            stage: parse_row_value(7, &stage_value)?,
            title: row.get(8)?,
            input_summary: row.get(9)?,
            prompt_plan_id: row.get(10)?,
            error: deserialize_error_json(11, error_json)?,
            created_at: row.get(12)?,
            updated_at: row.get(13)?,
            completed_at: row.get(14)?,
        },
    })
}

fn task_asset_from_row(row: &Row<'_>) -> Result<GenerationTaskAsset, rusqlite::Error> {
    let kind_value: String = row.get(3)?;
    let lifecycle_value: String = row.get(12)?;
    let kind = parse_asset_row_value(3, &kind_value)?;
    let lifecycle = parse_asset_row_value(12, &lifecycle_value)?;

    Ok(GenerationTaskAsset {
        role: row.get(0)?,
        sort_order: row.get(1)?,
        asset: Asset {
            id: row.get(2)?,
            kind,
            name: row.get(4)?,
            original_name: row.get(5)?,
            mime_type: row.get(6)?,
            relative_path: row.get(7)?,
            sha256: row.get(8)?,
            width: row.get(9)?,
            height: row.get(10)?,
            size_bytes: row.get(11)?,
            lifecycle,
            deleted_at: row.get(13)?,
            created_at: row.get(14)?,
            updated_at: row.get(15)?,
        },
    })
}

fn task_event_from_row(row: &Row<'_>) -> Result<TaskEvent, rusqlite::Error> {
    let stage_value: Option<String> = row.get(2)?;
    let detail_json: Option<String> = row.get(3)?;

    Ok(TaskEvent {
        id: row.get(0)?,
        event_type: row.get(1)?,
        stage: stage_value
            .map(|value| parse_row_value(2, &value))
            .transpose()?,
        detail: deserialize_detail_json(3, detail_json)?,
        created_at: row.get(4)?,
    })
}

fn parse_row_value<T>(column: usize, value: &str) -> Result<T, rusqlite::Error>
where
    T: FromStr<Err = GenerationError>,
{
    T::from_str(value).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            column,
            rusqlite::types::Type::Text,
            Box::new(error),
        )
    })
}

fn parse_asset_row_value<T>(column: usize, value: &str) -> Result<T, rusqlite::Error>
where
    T: FromStr<Err = crate::domain::assets::AssetError>,
{
    T::from_str(value).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            column,
            rusqlite::types::Type::Text,
            Box::new(error),
        )
    })
}

fn deserialize_error_json(
    column: usize,
    value: Option<String>,
) -> Result<Option<NormalizedTaskError>, rusqlite::Error> {
    value
        .map(|raw| {
            serde_json::from_str(&raw).map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(
                    column,
                    rusqlite::types::Type::Text,
                    Box::new(error),
                )
            })
        })
        .transpose()
}

fn deserialize_detail_json(
    column: usize,
    value: Option<String>,
) -> Result<Option<serde_json::Value>, rusqlite::Error> {
    value
        .map(|raw| {
            serde_json::from_str(&raw).map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(
                    column,
                    rusqlite::types::Type::Text,
                    Box::new(error),
                )
            })
        })
        .transpose()
}

pub(crate) fn insert_task_event(
    database: &WorkspaceDatabase,
    task_id: &str,
    event_type: &str,
    stage: Option<GenerationTaskStage>,
    detail: Option<serde_json::Value>,
) -> Result<(), GenerationError> {
    let detail_json = serialize_optional_json(detail)?;
    database.connection().execute(
        "
        INSERT INTO task_events (id, task_id, event_type, stage, detail_json)
        VALUES (?1, ?2, ?3, ?4, ?5)
        ",
        params![
            create_event_id(),
            task_id,
            event_type,
            stage.map(|value| value.as_str().to_string()),
            detail_json
        ],
    )?;
    Ok(())
}

fn validate_title(title: &str) -> Result<(), GenerationError> {
    if title.trim().is_empty() {
        return Err(GenerationError::Validation(
            "任务标题不能为空。".to_string(),
        ));
    }
    Ok(())
}

fn serialize_optional_json(
    value: Option<serde_json::Value>,
) -> Result<Option<String>, GenerationError> {
    value
        .map(|value| serde_json::to_string(&value).map_err(GenerationError::from))
        .transpose()
}

fn create_task_id() -> String {
    create_sequenced_id("task", &TASK_ID_SEQUENCE)
}

fn create_event_id() -> String {
    create_sequenced_id("event", &EVENT_ID_SEQUENCE)
}

fn create_idempotency_key() -> String {
    create_sequenced_id("idem", &TASK_ID_SEQUENCE)
}

fn create_sequenced_id(prefix: &str, sequence: &AtomicU64) -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let sequence = sequence.fetch_add(1, Ordering::Relaxed);
    format!("{prefix}_{nanos}_{sequence}")
}

impl From<DatabaseError> for GenerationError {
    fn from(source: DatabaseError) -> Self {
        Self::Database(source.to_string())
    }
}

impl From<rusqlite::Error> for GenerationError {
    fn from(source: rusqlite::Error) -> Self {
        Self::Database(DatabaseError::from(source).to_string())
    }
}

impl From<serde_json::Error> for GenerationError {
    fn from(source: serde_json::Error) -> Self {
        Self::Serde(format!("任务 JSON 序列化失败：{source}"))
    }
}
