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
    pub prompt_plan_snapshot: Option<serde_json::Value>,
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

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceGenerationResultImageInput {
    pub task_id: String,
    #[serde(default)]
    pub current_asset_id: Option<String>,
    #[serde(default)]
    pub displayed_asset_id: Option<String>,
    pub replacement_task_id: String,
    pub replacement_asset_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteGenerationResultImageInput {
    pub task_id: String,
    pub image_id: String,
    pub image_no: Option<i64>,
    #[serde(default)]
    pub asset_id: Option<String>,
    #[serde(default)]
    pub displayed_asset_id: Option<String>,
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
        validate_persisted_task_input(input.workspace, input.kind, input.input.as_ref())?;
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
        let prompt_plan_snapshot_json = serialize_optional_json(input.prompt_plan_snapshot)?;
        database.connection().execute(
            "
            INSERT INTO generation_tasks (
                id, attempt_no, idempotency_key, workspace, kind, status, stage,
                title, prompt_plan_id, input_json, prompt_plan_snapshot_json
            )
            VALUES (?1, 1, ?2, ?3, ?4, 'queued', 'queued', ?5, ?6, ?7, ?8)
            ",
            params![
                task_id,
                idempotency_key,
                input.workspace.as_str(),
                input.kind.as_str(),
                input.title,
                input.prompt_plan_id,
                input_json,
                prompt_plan_snapshot_json
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
        let original_input_json: Option<String> = database.connection().query_row(
            "SELECT input_json FROM generation_tasks WHERE id = ?1",
            params![original.task.id],
            |row| row.get(0),
        )?;
        let original_input = original_input_json
            .as_deref()
            .map(serde_json::from_str::<serde_json::Value>)
            .transpose()?;
        validate_result_image_task_kind(original.task.kind, original_input.as_ref())?;
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
        let transaction = database.connection().unchecked_transaction()?;
        let is_unmerged_text_rewrite: bool = transaction.query_row(
            "
            SELECT COALESCE(
                kind = 'image-edit'
                AND CASE
                        WHEN json_valid(input_json)
                        THEN json_extract(input_json, '$.kind')
                    END = 'result-image-text-rewrite',
                0
            )
            FROM generation_tasks
            WHERE id = ?1
            ",
            params![task_id],
            |row| row.get(0),
        )?;
        if is_unmerged_text_rewrite {
            cleanup_derived_result_task(&transaction, task_id)?;
        } else {
            transaction.execute(
                "
                UPDATE generation_tasks
                SET hidden_at = COALESCE(hidden_at, datetime('now')),
                    updated_at = datetime('now')
                WHERE id = ?1
                ",
                params![task_id],
            )?;
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn replace_result_image(
        &self,
        workspace_directory: &Path,
        input: ReplaceGenerationResultImageInput,
    ) -> Result<(), GenerationError> {
        if input.task_id == input.replacement_task_id {
            return Err(GenerationError::Validation(
                "原任务与替换任务不能相同。".to_string(),
            ));
        }

        let database = open_database(workspace_directory)?;
        let transaction = database.connection().unchecked_transaction()?;
        let replacement_task: Option<(String, Option<String>, String, Option<String>)> =
            transaction
                .query_row(
                    "
                    SELECT status, hidden_at, kind, input_json
                    FROM generation_tasks
                    WHERE id = ?1
                    ",
                    params![input.replacement_task_id],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
                )
                .optional()?;
        let Some((status, hidden_at, kind, input_json)) = replacement_task else {
            return Err(GenerationError::Validation("替换任务不存在。".to_string()));
        };
        if status != "succeeded" || hidden_at.is_some() {
            return Err(GenerationError::Validation(
                "替换任务必须已成功且仍然可见。".to_string(),
            ));
        }
        let replacement_input = input_json
            .as_deref()
            .map(serde_json::from_str::<serde_json::Value>)
            .transpose()?
            .ok_or_else(|| GenerationError::Validation("替换任务缺少输入快照。".to_string()))?;
        if replacement_input
            .get("parentTaskId")
            .and_then(serde_json::Value::as_str)
            != Some(input.task_id.as_str())
        {
            return Err(GenerationError::Validation(
                "替换任务与原结果图不匹配。".to_string(),
            ));
        }
        let replacement_input_kind = replacement_input
            .get("kind")
            .and_then(serde_json::Value::as_str);
        let (target_image_id, image_no, source_asset_id) =
            match (kind.as_str(), replacement_input_kind) {
                (
                    "image-edit",
                    Some(
                        "result-image-resize"
                        | "result-image-rewrite"
                        | "result-image-text-rewrite"
                        | "product-detail-image-rewrite",
                    ),
                ) => {
                    let target_image_id = replacement_input
                        .get("targetImageId")
                        .and_then(serde_json::Value::as_str)
                        .ok_or_else(|| {
                            GenerationError::Validation("替换任务缺少目标结果图标识。".to_string())
                        })?;
                    let image_no = replacement_input
                        .get("imageNo")
                        .and_then(serde_json::Value::as_i64)
                        .filter(|value| *value > 0)
                        .ok_or_else(|| {
                            GenerationError::Validation("替换任务缺少有效结果图序号。".to_string())
                        })?;
                    let source_asset_id = replacement_input
                        .get("sourceAssetId")
                        .and_then(serde_json::Value::as_str)
                        .ok_or_else(|| {
                            GenerationError::Validation("替换任务缺少来源结果资产。".to_string())
                        })?;
                    (target_image_id, image_no, Some(source_asset_id))
                }
                (
                    "image-generation",
                    Some("product-detail-generation" | "clothing-tryon-generation"),
                ) => {
                    let items = replacement_input
                        .get("items")
                        .and_then(serde_json::Value::as_array)
                        .filter(|items| items.len() == 1)
                        .ok_or_else(|| {
                            GenerationError::Validation(
                                "单图重试任务必须且只能包含一个结果项。".to_string(),
                            )
                        })?;
                    let item = &items[0];
                    let target_image_id = item
                        .get("imageId")
                        .and_then(serde_json::Value::as_str)
                        .ok_or_else(|| {
                        GenerationError::Validation("单图重试任务缺少目标结果图标识。".to_string())
                    })?;
                    let image_no = item
                        .get("imageNo")
                        .and_then(serde_json::Value::as_i64)
                        .filter(|value| *value > 0)
                        .ok_or_else(|| {
                            GenerationError::Validation(
                                "单图重试任务缺少有效结果图序号。".to_string(),
                            )
                        })?;
                    (target_image_id, image_no, None)
                }
                ("image-generation", Some("scene-image-generation")) => {
                    if replacement_input
                        .get("singleImageRetry")
                        .and_then(serde_json::Value::as_bool)
                        != Some(true)
                    {
                        return Err(GenerationError::Validation(
                            "场景替换任务必须是专用单图重试任务。".to_string(),
                        ));
                    }
                    let target_image_id = replacement_input
                        .get("targetImageId")
                        .and_then(serde_json::Value::as_str)
                        .filter(|value| !value.is_empty())
                        .ok_or_else(|| {
                            GenerationError::Validation(
                                "场景单图重试任务缺少目标结果图标识。".to_string(),
                            )
                        })?;
                    let items = replacement_input
                        .get("items")
                        .and_then(serde_json::Value::as_array)
                        .filter(|items| items.len() == 1)
                        .ok_or_else(|| {
                            GenerationError::Validation(
                                "场景单图重试任务必须且只能包含一个结果项。".to_string(),
                            )
                        })?;
                    let item = &items[0];
                    if item.get("imageId").and_then(serde_json::Value::as_str)
                        != Some(target_image_id)
                    {
                        return Err(GenerationError::Validation(
                            "场景单图重试任务目标结果图标识不一致。".to_string(),
                        ));
                    }
                    let image_no = item
                        .get("imageNo")
                        .and_then(serde_json::Value::as_i64)
                        .filter(|value| *value > 0)
                        .ok_or_else(|| {
                            GenerationError::Validation(
                                "场景单图重试任务缺少有效结果图序号。".to_string(),
                            )
                        })?;
                    (target_image_id, image_no, None)
                }
                _ => {
                    return Err(GenerationError::Validation(
                        "替换任务与原结果图不匹配。".to_string(),
                    ));
                }
            };
        let sort_order = image_no - 1;
        validate_result_image_identity(
            &transaction,
            &input.task_id,
            sort_order,
            target_image_id,
            Some(image_no),
        )?;
        let target_was_deleted: i64 = transaction.query_row(
            "
            SELECT EXISTS(
                SELECT 1
                FROM task_events
                WHERE task_id = ?1
                  AND event_type = 'task.result-image-deleted'
                  AND json_extract(detail_json, '$.imageId') = ?2
                  AND json_extract(detail_json, '$.imageNo') = ?3
            )
            ",
            params![input.task_id, target_image_id, image_no],
            |row| row.get(0),
        )?;
        if target_was_deleted != 0 {
            return Err(GenerationError::Validation(
                "结果图已删除，不能归并晚到的重试结果。".to_string(),
            ));
        }
        let current_slot_asset_id = transaction
            .query_row(
                "
                SELECT asset_id
                FROM generation_assets
                WHERE task_id = ?1 AND role = 'output' AND sort_order = ?2
                ",
                params![input.task_id, sort_order],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()?
            .flatten();
        let requested_current_asset_id = input
            .current_asset_id
            .as_deref()
            .filter(|value| !value.is_empty());
        match (requested_current_asset_id, current_slot_asset_id.as_deref()) {
            (Some(requested), Some(current)) if requested == current => {}
            (None, None) => {}
            _ => {
                return Err(GenerationError::Validation(
                    "替换任务与原结果图不匹配。".to_string(),
                ));
            }
        }
        let displayed_asset_id = input
            .displayed_asset_id
            .as_deref()
            .or(requested_current_asset_id);
        if source_asset_id.is_some() && source_asset_id != displayed_asset_id {
            return Err(GenerationError::Validation(
                "替换任务与当前展示结果图不匹配。".to_string(),
            ));
        }
        let replacement_output_count: i64 = transaction.query_row(
            "SELECT COUNT(*) FROM generation_assets WHERE task_id = ?1 AND role = 'output'",
            params![input.replacement_task_id],
            |row| row.get(0),
        )?;
        if replacement_output_count != 1 {
            return Err(GenerationError::Validation(
                "替换任务必须且只能生成一张结果图。".to_string(),
            ));
        }
        let replacement_relation_count: i64 = transaction.query_row(
            "
            SELECT COUNT(*)
            FROM generation_assets rel
            JOIN assets asset ON asset.id = rel.asset_id
            WHERE rel.task_id = ?1 AND rel.asset_id = ?2 AND rel.role = 'output'
              AND asset.kind = 'generated' AND asset.lifecycle = 'active'
              AND asset.deleted_at IS NULL
            ",
            params![input.replacement_task_id, input.replacement_asset_id],
            |row| row.get(0),
        )?;
        if replacement_relation_count != 1 {
            return Err(GenerationError::Validation(
                "替换任务的结果资产不可用。".to_string(),
            ));
        }

        if let Some(current_asset_id) = current_slot_asset_id.as_deref() {
            transaction.execute(
                "
                UPDATE generation_assets
                SET asset_id = ?1
                WHERE task_id = ?2 AND role = 'output' AND sort_order = ?3 AND asset_id = ?4
                ",
                params![
                    input.replacement_asset_id,
                    input.task_id,
                    sort_order,
                    current_asset_id,
                ],
            )?;
        } else {
            transaction.execute(
                "DELETE FROM generation_assets WHERE task_id = ?1 AND role = 'output' AND sort_order = ?2",
                params![input.task_id, sort_order],
            )?;
            transaction.execute(
                "
                INSERT INTO generation_assets (task_id, asset_id, role, sort_order)
                VALUES (?1, ?2, 'output', ?3)
                ",
                params![input.task_id, input.replacement_asset_id, sort_order],
            )?;
        }
        transaction.execute(
            "DELETE FROM generation_assets WHERE task_id = ?1 AND asset_id = ?2",
            params![input.replacement_task_id, input.replacement_asset_id],
        )?;
        transaction.execute(
            "DELETE FROM generation_task_input_assets WHERE task_id = ?1",
            params![input.replacement_task_id],
        )?;
        transaction.execute(
            "
            UPDATE generation_tasks
            SET hidden_at = COALESCE(hidden_at, datetime('now')),
                updated_at = datetime('now')
            WHERE id = ?1
            ",
            params![input.replacement_task_id],
        )?;
        let derived_displayed_asset_id = displayed_asset_id
            .filter(|displayed| current_slot_asset_id.as_deref() != Some(*displayed));
        hide_superseded_result_tasks(
            &transaction,
            &input.task_id,
            target_image_id,
            image_no,
            derived_displayed_asset_id,
            Some(&input.replacement_task_id),
        )?;
        if let Some(current_asset_id) = current_slot_asset_id.as_deref() {
            soft_delete_asset_without_visible_references(&transaction, current_asset_id)?;
        }
        if let Some(displayed_asset_id) = derived_displayed_asset_id {
            soft_delete_asset_without_visible_references(&transaction, displayed_asset_id)?;
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn delete_result_image(
        &self,
        workspace_directory: &Path,
        input: DeleteGenerationResultImageInput,
    ) -> Result<(), GenerationError> {
        let database = open_database(workspace_directory)?;
        let transaction = database.connection().unchecked_transaction()?;
        let image_no = input
            .image_no
            .filter(|value| *value > 0)
            .ok_or_else(|| GenerationError::Validation("结果图序号必须是正整数。".to_string()))?;
        let sort_order = image_no - 1;
        validate_result_image_identity(
            &transaction,
            &input.task_id,
            sort_order,
            &input.image_id,
            Some(image_no),
        )?;
        let current_slot_asset_id = transaction
            .query_row(
                "
                SELECT asset_id
                FROM generation_assets
                WHERE task_id = ?1 AND role = 'output' AND sort_order = ?2
                ",
                params![input.task_id, sort_order],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()?
            .flatten();
        let requested_asset_id = input.asset_id.as_deref().filter(|value| !value.is_empty());
        match (requested_asset_id, current_slot_asset_id.as_deref()) {
            (Some(requested), Some(current)) if requested == current => {}
            (None, None) => {}
            _ => {
                return Err(GenerationError::Validation(
                    "待删除的结果资产不存在或与目标槽位不匹配。".to_string(),
                ));
            }
        }
        if current_slot_asset_id.is_none()
            && input
                .displayed_asset_id
                .as_deref()
                .is_some_and(|value| !value.is_empty())
        {
            return Err(GenerationError::Validation(
                "失败空槽不能携带展示资产。".to_string(),
            ));
        }

        if let Some(current_asset_id) = current_slot_asset_id.as_deref() {
            transaction.execute(
                "
                DELETE FROM generation_assets
                WHERE task_id = ?1 AND asset_id = ?2 AND role = 'output' AND sort_order = ?3
                ",
                params![input.task_id, current_asset_id, sort_order],
            )?;
        }
        let derived_displayed_asset_id = input
            .displayed_asset_id
            .as_deref()
            .filter(|displayed| current_slot_asset_id.as_deref() != Some(*displayed));
        hide_superseded_result_tasks(
            &transaction,
            &input.task_id,
            &input.image_id,
            image_no,
            derived_displayed_asset_id,
            None,
        )?;
        if let Some(displayed_asset_id) = derived_displayed_asset_id {
            soft_delete_asset_without_visible_references(&transaction, displayed_asset_id)?;
        }
        if let Some(current_asset_id) = current_slot_asset_id.as_deref() {
            soft_delete_asset_without_visible_references(&transaction, current_asset_id)?;
        }
        insert_task_event_on_connection(
            &transaction,
            &input.task_id,
            "task.result-image-deleted",
            None,
            Some(json!({
                "sortOrder": sort_order,
                "imageId": input.image_id,
                "imageNo": image_no,
                "assetId": current_slot_asset_id,
            })),
        )?;
        transaction.commit()?;
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
            input: task_detail_json(&database, task_id, "input_json")?,
            prompt_plan_snapshot: task_detail_json(
                &database,
                task_id,
                "prompt_plan_snapshot_json",
            )?,
            output: task_detail_json(&database, task_id, "output_json")?,
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

fn soft_delete_asset_without_visible_references(
    connection: &rusqlite::Connection,
    asset_id: &str,
) -> Result<(), GenerationError> {
    connection.execute(
        "
        UPDATE assets
        SET lifecycle = 'deleted',
            deleted_at = COALESCE(deleted_at, datetime('now')),
            updated_at = datetime('now')
        WHERE id = ?1
          AND NOT EXISTS (
              SELECT 1
              FROM generation_assets rel
              JOIN generation_tasks task ON task.id = rel.task_id
              WHERE rel.asset_id = assets.id AND task.hidden_at IS NULL
          )
          AND NOT EXISTS (
              SELECT 1
              FROM generation_task_input_assets rel
              JOIN generation_tasks task ON task.id = rel.task_id
              WHERE rel.asset_id = assets.id AND task.hidden_at IS NULL
          )
        ",
        params![asset_id],
    )?;
    Ok(())
}

fn hide_superseded_result_tasks(
    connection: &rusqlite::Connection,
    parent_task_id: &str,
    image_id: &str,
    image_no: i64,
    displayed_asset_id: Option<&str>,
    excluded_task_id: Option<&str>,
) -> Result<(), GenerationError> {
    let mut statement = connection.prepare(
        "
        SELECT task.id,
               task.input_json,
               EXISTS(
                   SELECT 1
                   FROM generation_assets rel
                   JOIN assets asset ON asset.id = rel.asset_id
                   WHERE rel.task_id = task.id
                     AND rel.asset_id = ?1
                     AND rel.role = 'output'
                     AND asset.kind = 'generated'
                     AND asset.lifecycle = 'active'
                     AND asset.deleted_at IS NULL
               ) AS owns_displayed_asset
        FROM generation_tasks task
        WHERE task.hidden_at IS NULL
          AND task.id != ?2
          AND CASE
                  WHEN json_valid(task.input_json)
                  THEN json_extract(task.input_json, '$.parentTaskId')
              END = ?2
        ",
    )?;
    let candidates = statement
        .query_map(params![displayed_asset_id, parent_task_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, i64>(2)? != 0,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    drop(statement);

    let mut displayed_task_matched = false;
    let mut matched_tasks = Vec::new();
    for (task_id, input_json, owns_displayed_asset) in candidates {
        if excluded_task_id == Some(task_id.as_str()) {
            continue;
        }
        let task_input = input_json
            .as_deref()
            .map(serde_json::from_str::<serde_json::Value>)
            .transpose()?;
        let Some(task_input) = task_input else {
            continue;
        };
        let matches_parent = task_input
            .get("parentTaskId")
            .and_then(serde_json::Value::as_str)
            == Some(parent_task_id);
        let matches_direct_target = task_input
            .get("targetImageId")
            .and_then(serde_json::Value::as_str)
            == Some(image_id)
            && task_input
                .get("imageNo")
                .and_then(serde_json::Value::as_i64)
                == Some(image_no);
        let matches_item_target = task_input
            .get("items")
            .and_then(serde_json::Value::as_array)
            .and_then(|items| items.first())
            .is_some_and(|item| {
                item.get("imageId").and_then(serde_json::Value::as_str) == Some(image_id)
                    && item.get("imageNo").and_then(serde_json::Value::as_i64) == Some(image_no)
            });
        if !matches_parent || (!matches_direct_target && !matches_item_target) {
            continue;
        }
        displayed_task_matched |= owns_displayed_asset;
        matched_tasks.push(task_id);
    }
    if displayed_asset_id.is_some() && !displayed_task_matched {
        return Err(GenerationError::Validation(
            "当前展示资产与目标结果图不匹配。".to_string(),
        ));
    }

    for task_id in matched_tasks {
        cleanup_derived_result_task(connection, &task_id)?;
    }
    Ok(())
}

fn cleanup_derived_result_task(
    connection: &rusqlite::Connection,
    task_id: &str,
) -> Result<(), GenerationError> {
    let output_asset_ids = {
        let mut statement = connection.prepare(
            "SELECT asset_id FROM generation_assets WHERE task_id = ?1 AND role = 'output'",
        )?;
        let asset_ids = statement
            .query_map([task_id], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        asset_ids
    };
    connection.execute(
        "DELETE FROM generation_assets WHERE task_id = ?1 AND role = 'output'",
        [task_id],
    )?;
    connection.execute(
        "DELETE FROM generation_task_input_assets WHERE task_id = ?1",
        [task_id],
    )?;
    connection.execute(
        "
        UPDATE generation_tasks
        SET status = CASE
                WHEN status IN ('queued', 'running') THEN 'cancelled'
                ELSE status
            END,
            stage = CASE
                WHEN status IN ('queued', 'running') THEN 'failed'
                ELSE stage
            END,
            completed_at = CASE
                WHEN status IN ('queued', 'running')
                THEN COALESCE(completed_at, datetime('now'))
                ELSE completed_at
            END,
            hidden_at = COALESCE(hidden_at, datetime('now')),
            updated_at = datetime('now')
        WHERE id = ?1
        ",
        params![task_id],
    )?;
    for output_asset_id in output_asset_ids {
        soft_delete_asset_without_visible_references(connection, &output_asset_id)?;
    }
    Ok(())
}

fn validate_result_image_identity(
    connection: &rusqlite::Connection,
    task_id: &str,
    sort_order: i64,
    image_id: &str,
    image_no: Option<i64>,
) -> Result<(), GenerationError> {
    validate_result_image_identity_anchored(connection, task_id, sort_order, image_id, image_no)
        .map(|_| ())
}

fn validate_result_image_identity_anchored(
    connection: &rusqlite::Connection,
    task_id: &str,
    sort_order: i64,
    image_id: &str,
    image_no: Option<i64>,
) -> Result<bool, GenerationError> {
    if image_id.trim().is_empty() {
        return Err(GenerationError::Validation(
            "结果图标识不能为空。".to_string(),
        ));
    }
    let image_no = image_no
        .filter(|value| *value > 0)
        .ok_or_else(|| GenerationError::Validation("结果图序号必须是正整数。".to_string()))?;
    let expected_image_no = sort_order + 1;
    if image_no != expected_image_no {
        return Err(GenerationError::Validation(
            "结果图序号与输出位置不匹配。".to_string(),
        ));
    }

    let (input_json, prompt_plan_snapshot_json): (Option<String>, Option<String>) = connection
        .query_row(
            "SELECT input_json, prompt_plan_snapshot_json FROM generation_tasks WHERE id = ?1",
            params![task_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
    let input_json = input_json
        .as_deref()
        .map(serde_json::from_str::<serde_json::Value>)
        .transpose()?;
    let prompt_plan_snapshot = prompt_plan_snapshot_json
        .as_deref()
        .map(serde_json::from_str::<serde_json::Value>)
        .transpose()?;
    let mut expected_image_ids = Vec::new();
    if let Some(item) = input_json
        .as_ref()
        .and_then(|value| result_item_for_slot(value, sort_order, expected_image_no))
    {
        validate_result_item_image_no(item, expected_image_no)?;
        if let Some(value) = item.get("imageId").and_then(serde_json::Value::as_str) {
            expected_image_ids.push(value.to_string());
        }
        if let Some(value) = item.get("id").and_then(serde_json::Value::as_str) {
            expected_image_ids.push(value.to_string());
            if !value.starts_with(&format!("{task_id}:"))
                && !value.starts_with(&format!("{task_id}-"))
            {
                expected_image_ids.push(format!("{task_id}:{value}"));
            }
        }
    }
    if let Some(item) = prompt_plan_snapshot
        .as_ref()
        .and_then(|value| result_item_for_slot(value, sort_order, expected_image_no))
    {
        if let Some(intent) = item.get("intent") {
            validate_result_item_image_no(intent, expected_image_no)?;
        }
        if let Some(value) = item.get("id").and_then(serde_json::Value::as_str) {
            expected_image_ids.push(value.to_string());
            if !value.starts_with(&format!("{task_id}:"))
                && !value.starts_with(&format!("{task_id}-"))
            {
                expected_image_ids.push(format!("{task_id}:{value}"));
            }
        }
    }
    if !expected_image_ids.is_empty()
        && !expected_image_ids
            .iter()
            .any(|expected| expected == image_id)
    {
        return Err(GenerationError::Validation(
            "结果图标识与任务快照不匹配。".to_string(),
        ));
    }
    Ok(!expected_image_ids.is_empty())
}

pub(crate) fn validate_result_image_rewrite_source(
    workspace_directory: &Path,
    parent_task_id: &str,
    target_image_id: &str,
    image_no: i64,
    source_asset_id: &str,
) -> Result<(), GenerationError> {
    if image_no <= 0 || parent_task_id.trim().is_empty() || source_asset_id.trim().is_empty() {
        return Err(GenerationError::Validation(
            "图片文字修改来源结果无效。".to_string(),
        ));
    }
    let database = open_database(workspace_directory)?;
    let identity_anchored = validate_result_image_identity_anchored(
        database.connection(),
        parent_task_id,
        image_no - 1,
        target_image_id,
        Some(image_no),
    )?;
    let legacy_fallback_image_id = format!("{parent_task_id}:{}", image_no - 1);
    if !identity_anchored && target_image_id != legacy_fallback_image_id {
        return Err(GenerationError::Validation(
            "图片文字修改缺少稳定结果图标识。".to_string(),
        ));
    }
    let current_source_count: i64 = database.connection().query_row(
        "
        SELECT COUNT(*)
        FROM generation_assets rel
        JOIN generation_tasks parent ON parent.id = rel.task_id
        JOIN assets asset ON asset.id = rel.asset_id
        WHERE rel.task_id = ?1
          AND rel.role = 'output'
          AND rel.sort_order = ?2
          AND rel.asset_id = ?3
          AND parent.hidden_at IS NULL
          AND asset.kind = 'generated'
          AND asset.lifecycle = 'active'
          AND asset.deleted_at IS NULL
        ",
        params![parent_task_id, image_no - 1, source_asset_id],
        |row| row.get(0),
    )?;
    if current_source_count != 1 {
        return Err(GenerationError::Validation(
            "图片文字修改来源已失效。".to_string(),
        ));
    }
    Ok(())
}

fn result_item_for_slot(
    value: &serde_json::Value,
    sort_order: i64,
    image_no: i64,
) -> Option<&serde_json::Value> {
    let items = value.get("items")?.as_array()?;
    items
        .iter()
        .find(|item| item.get("sortOrder").and_then(serde_json::Value::as_i64) == Some(sort_order))
        .or_else(|| {
            items.iter().find(|item| {
                item.get("imageNo").and_then(serde_json::Value::as_i64) == Some(image_no)
                    || item
                        .get("intent")
                        .and_then(|intent| intent.get("imageNo"))
                        .and_then(serde_json::Value::as_i64)
                        == Some(image_no)
            })
        })
        .or_else(|| {
            usize::try_from(sort_order)
                .ok()
                .and_then(|index| items.get(index))
        })
}

fn validate_result_item_image_no(
    item: &serde_json::Value,
    expected_image_no: i64,
) -> Result<(), GenerationError> {
    if let Some(value) = item.get("imageNo").and_then(serde_json::Value::as_i64) {
        if value != expected_image_no {
            return Err(GenerationError::Validation(
                "结果图序号与任务快照不匹配。".to_string(),
            ));
        }
    }
    Ok(())
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

fn task_detail_json(
    database: &WorkspaceDatabase,
    task_id: &str,
    column_name: &str,
) -> Result<Option<serde_json::Value>, GenerationError> {
    let sql = match column_name {
        "input_json" => "SELECT input_json FROM generation_tasks WHERE id = ?1",
        "prompt_plan_snapshot_json" => {
            "SELECT prompt_plan_snapshot_json FROM generation_tasks WHERE id = ?1"
        }
        "output_json" => "SELECT output_json FROM generation_tasks WHERE id = ?1",
        _ => {
            return Err(GenerationError::Validation(
                "不支持的任务 JSON 字段。".to_string(),
            ))
        }
    };
    let raw: Option<String> = database
        .connection()
        .query_row(sql, params![task_id], |row| row.get(0))?;

    raw.map(|value| serde_json::from_str(&value))
        .transpose()
        .map_err(GenerationError::from)
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
    insert_task_event_on_connection(database.connection(), task_id, event_type, stage, detail)
}

pub(crate) fn insert_task_event_on_connection(
    connection: &rusqlite::Connection,
    task_id: &str,
    event_type: &str,
    stage: Option<GenerationTaskStage>,
    detail: Option<serde_json::Value>,
) -> Result<(), GenerationError> {
    let detail_json = serialize_optional_json(detail)?;
    connection.execute(
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

fn validate_persisted_task_input(
    workspace: WorkspaceKind,
    task_kind: GenerationTaskKind,
    input: Option<&serde_json::Value>,
) -> Result<(), GenerationError> {
    if workspace == WorkspaceKind::Scene
        && input.is_some_and(|value| value.get("userImages").is_some())
    {
        return Err(GenerationError::Validation(
            "场景任务参考图只能通过 inputAssets 关联。".to_string(),
        ));
    }
    let Some(input) = input else {
        return Ok(());
    };
    validate_result_image_task_kind(task_kind, Some(input))?;
    let input_kind = input.get("kind").and_then(serde_json::Value::as_str);
    let is_result_rewrite = matches!(
        input_kind,
        Some("result-image-rewrite" | "product-detail-image-rewrite" | "result-image-text-rewrite")
    );
    if !is_result_rewrite {
        return Ok(());
    }
    if contains_forbidden_persisted_rewrite_value(input) {
        return Err(GenerationError::Validation(
            "结果图片修改任务包含禁止持久化的模型输入。".to_string(),
        ));
    }
    if input.get("kind").and_then(serde_json::Value::as_str) == Some("result-image-text-rewrite") {
        let changes = input
            .get("changes")
            .and_then(serde_json::Value::as_array)
            .filter(|changes| !changes.is_empty() && changes.len() <= 100)
            .ok_or_else(|| {
                GenerationError::Validation("图片文字修改 changes 数量无效。".to_string())
            })?;
        if serde_json::to_vec(changes)?.len() > 512 * 1024 {
            return Err(GenerationError::Validation(
                "图片文字修改 changes 体积超过限制。".to_string(),
            ));
        }
        for change in changes {
            let change = change.as_object().ok_or_else(|| {
                GenerationError::Validation("图片文字修改 change 格式无效。".to_string())
            })?;
            if change.keys().any(|field| {
                !matches!(
                    field.as_str(),
                    "lineId" | "operation" | "originalText" | "replacementText" | "box"
                )
            }) {
                return Err(GenerationError::Validation(
                    "图片文字修改 change 包含未知字段。".to_string(),
                ));
            }
            for field in ["lineId", "originalText", "replacementText"] {
                if let Some(value) = change.get(field) {
                    let value = value.as_str().ok_or_else(|| {
                        GenerationError::Validation(format!("图片文字修改 {field} 必须是字符串。"))
                    })?;
                    if value.chars().count() > 500 {
                        return Err(GenerationError::Validation(
                            "图片文字修改文本长度超过限制。".to_string(),
                        ));
                    }
                }
            }
        }
    }
    Ok(())
}

fn validate_result_image_task_kind(
    task_kind: GenerationTaskKind,
    input: Option<&serde_json::Value>,
) -> Result<(), GenerationError> {
    let input_kind = input
        .and_then(|value| value.get("kind"))
        .and_then(serde_json::Value::as_str);
    let is_result_image_edit = matches!(
        input_kind,
        Some(
            "result-image-resize"
                | "result-image-rewrite"
                | "product-detail-image-rewrite"
                | "result-image-text-rewrite"
        )
    );
    if is_result_image_edit && task_kind != GenerationTaskKind::ImageEdit {
        return Err(GenerationError::Validation(
            "结果图片修改任务的外层 kind 必须是 image-edit。".to_string(),
        ));
    }
    Ok(())
}

fn contains_forbidden_persisted_rewrite_value(value: &serde_json::Value) -> bool {
    match value {
        serde_json::Value::Object(object) => object.iter().any(|(key, value)| {
            matches!(
                key.as_str(),
                "prompt" | "messages" | "rolelessPrompt" | "userImages"
            ) || contains_forbidden_persisted_rewrite_value(value)
        }),
        serde_json::Value::Array(values) => values
            .iter()
            .any(contains_forbidden_persisted_rewrite_value),
        serde_json::Value::String(value) => value.trim_start().starts_with("data:image/"),
        _ => false,
    }
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

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::{Path, PathBuf};

    use rusqlite::params;
    use serde_json::json;

    use super::{
        validate_result_image_rewrite_source, CreateGenerationTaskInput,
        DeleteGenerationResultImageInput, GenerationService, GenerationTaskQuery,
        ReplaceGenerationResultImageInput, RetryGenerationTaskInput,
    };
    use crate::domain::generation::{GenerationError, GenerationTaskKind, WorkspaceKind};
    use crate::infrastructure::database::WorkspaceDatabase;

    struct TestWorkspace {
        path: PathBuf,
    }

    impl TestWorkspace {
        fn new(name: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "commerce-shoot-studio-generation-{name}-{}-{}",
                std::process::id(),
                super::create_sequenced_id("test", &super::TASK_ID_SEQUENCE)
            ));
            fs::create_dir_all(&path).expect("创建测试 workspace");
            Self { path }
        }

        fn path(&self) -> &Path {
            &self.path
        }

        fn database(&self) -> WorkspaceDatabase {
            WorkspaceDatabase::open(&self.path).expect("打开测试数据库")
        }
    }

    impl Drop for TestWorkspace {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn create_scene_task_rejects_persisted_user_images_before_inserting() {
        let workspace = TestWorkspace::new("scene-user-images-persistence");

        let error = GenerationService::new()
            .create_task(
                workspace.path(),
                CreateGenerationTaskInput {
                    idempotency_key: Some("scene-user-images-persistence".to_string()),
                    workspace: WorkspaceKind::Scene,
                    kind: GenerationTaskKind::PromptPlan,
                    title: "场景方案".to_string(),
                    prompt_plan_id: None,
                    input: Some(json!({
                        "kind": "scene-prompt-planning",
                        "userImages": [{
                            "role": "reference",
                            "dataUrl": "data:image/png;base64,AA==",
                        }],
                    })),
                    prompt_plan_snapshot: None,
                    input_assets: Vec::new(),
                },
            )
            .expect_err("Scene Base64 input must be rejected before persistence");

        assert!(matches!(error, GenerationError::Validation(_)));
        let task_count: i64 = workspace
            .database()
            .connection()
            .query_row("SELECT COUNT(*) FROM generation_tasks", [], |row| {
                row.get(0)
            })
            .expect("查询任务数量");
        assert_eq!(task_count, 0);
    }

    #[test]
    fn create_result_rewrite_rejects_model_payloads_before_inserting() {
        let workspace = TestWorkspace::new("rewrite-sensitive-persistence");
        let cases = [
            json!({
                "kind": "result-image-rewrite",
                "rewriteInstruction": "换背景",
                "prompt": { "rolelessPrompt": "完整 Prompt" }
            }),
            json!({
                "kind": "result-image-text-rewrite",
                "changes": [{
                    "lineId": "line-001",
                    "operation": "delete",
                    "originalText": "旧文",
                    "box": { "x": 0.1, "y": 0.1, "width": 0.2, "height": 0.1 }
                }],
                "userImages": [{ "dataUrl": "data:image/png;base64,AA==" }]
            }),
            json!({
                "kind": "result-image-rewrite",
                "rewriteInstruction": "data:image/png;base64,AA=="
            }),
        ];

        for (index, input) in cases.into_iter().enumerate() {
            GenerationService::new()
                .create_task(
                    workspace.path(),
                    CreateGenerationTaskInput {
                        idempotency_key: Some(format!("rewrite-sensitive-{index}")),
                        workspace: WorkspaceKind::Product,
                        kind: GenerationTaskKind::ImageEdit,
                        title: "结果图修改".to_string(),
                        prompt_plan_id: None,
                        input: Some(input),
                        prompt_plan_snapshot: None,
                        input_assets: Vec::new(),
                    },
                )
                .expect_err("模型 Prompt 或内联图片必须在写库前拒绝");
        }

        let task_count: i64 = workspace
            .database()
            .connection()
            .query_row("SELECT COUNT(*) FROM generation_tasks", [], |row| {
                row.get(0)
            })
            .expect("查询任务数量");
        assert_eq!(task_count, 0);
    }

    #[test]
    fn create_text_rewrite_rejects_oversized_changes_before_inserting() {
        let workspace = TestWorkspace::new("rewrite-changes-persistence");
        let cases = [
            json!({ "kind": "result-image-text-rewrite", "changes": [] }),
            json!({
                "kind": "result-image-text-rewrite",
                "changes": [{
                    "lineId": "line-001",
                    "operation": "replace",
                    "originalText": "旧文",
                    "replacementText": "字".repeat(501),
                    "box": { "x": 0.1, "y": 0.1, "width": 0.2, "height": 0.1 }
                }]
            }),
            json!({
                "kind": "result-image-text-rewrite",
                "changes": [{
                    "lineId": "line-001",
                    "operation": "replace",
                    "originalText": "旧文",
                    "replacementText": ["新文"],
                    "box": { "x": 0.1, "y": 0.1, "width": 0.2, "height": 0.1 }
                }]
            }),
            json!({
                "kind": "result-image-text-rewrite",
                "changes": [{
                    "lineId": "line-001",
                    "operation": "replace",
                    "originalText": "旧文",
                    "replacementText": ["字".repeat(600_000)],
                    "box": { "x": 0.1, "y": 0.1, "width": 0.2, "height": 0.1 }
                }]
            }),
            json!({
                "kind": "result-image-text-rewrite",
                "changes": [{
                    "lineId": "line-001",
                    "operation": "delete",
                    "originalText": "旧文",
                    "box": { "x": 0.1, "y": 0.1, "width": 0.2, "height": 0.1 },
                    "payload": "unexpected"
                }]
            }),
        ];

        for (index, input) in cases.into_iter().enumerate() {
            GenerationService::new()
                .create_task(
                    workspace.path(),
                    CreateGenerationTaskInput {
                        idempotency_key: Some(format!("rewrite-changes-{index}")),
                        workspace: WorkspaceKind::Product,
                        kind: GenerationTaskKind::ImageEdit,
                        title: "结果图改字".to_string(),
                        prompt_plan_id: None,
                        input: Some(input),
                        prompt_plan_snapshot: None,
                        input_assets: Vec::new(),
                    },
                )
                .expect_err("过量或超长改字输入必须在写库前拒绝");
        }

        let task_count: i64 = workspace
            .database()
            .connection()
            .query_row("SELECT COUNT(*) FROM generation_tasks", [], |row| {
                row.get(0)
            })
            .expect("查询任务数量");
        assert_eq!(task_count, 0);
    }

    #[test]
    fn create_result_image_internal_kinds_reject_non_image_edit_before_inserting() {
        let workspace = TestWorkspace::new("result-image-kind-binding");
        let cases = [
            json!({
                "kind": "result-image-resize",
                "parentTaskId": "parent-task",
                "targetImageId": "parent-task:item-1",
                "imageNo": 1,
                "sourceAssetId": "source-asset",
                "size": "1024x1024"
            }),
            json!({
                "kind": "result-image-rewrite",
                "parentTaskId": "parent-task",
                "targetImageId": "parent-task:item-1",
                "imageNo": 1,
                "sourceAssetId": "source-asset",
                "rewriteInstruction": "换成浅灰背景"
            }),
            json!({
                "kind": "product-detail-image-rewrite",
                "parentTaskId": "parent-task",
                "targetImageId": "parent-task:item-1",
                "imageNo": 1,
                "sourceAssetId": "source-asset",
                "rewriteInstruction": "换成浅灰背景"
            }),
            json!({
                "kind": "result-image-text-rewrite",
                "parentTaskId": "parent-task",
                "targetImageId": "parent-task:item-1",
                "imageNo": 1,
                "sourceAssetId": "source-asset",
                "changes": [{
                    "lineId": "line-001",
                    "operation": "replace",
                    "originalText": "旧文",
                    "replacementText": "新文",
                    "box": { "x": 0.1, "y": 0.1, "width": 0.2, "height": 0.1 }
                }]
            }),
        ];

        for (index, input) in cases.into_iter().enumerate() {
            let error = GenerationService::new()
                .create_task(
                    workspace.path(),
                    CreateGenerationTaskInput {
                        idempotency_key: Some(format!("result-image-kind-binding-{index}")),
                        workspace: WorkspaceKind::Product,
                        kind: GenerationTaskKind::PromptPlan,
                        title: "错误外层类型的结果图编辑".to_string(),
                        prompt_plan_id: None,
                        input: Some(input),
                        prompt_plan_snapshot: None,
                        input_assets: Vec::new(),
                    },
                )
                .expect_err("结果图编辑内部 kind 必须绑定外层 image-edit");
            assert!(matches!(error, GenerationError::Validation(_)));
        }

        let task_count: i64 = workspace
            .database()
            .connection()
            .query_row("SELECT COUNT(*) FROM generation_tasks", [], |row| {
                row.get(0)
            })
            .expect("查询任务数量");
        assert_eq!(task_count, 0);
    }

    #[test]
    fn retry_rejects_legacy_result_image_task_with_mismatched_outer_kind() {
        let workspace = TestWorkspace::new("retry-result-image-kind-binding");
        let database = workspace.database();
        insert_derived_result_task(
            &database,
            "legacy-mismatched-task",
            "prompt-plan",
            json!({
                "kind": "result-image-text-rewrite",
                "parentTaskId": "parent-task",
                "targetImageId": "parent-task:item-1",
                "imageNo": 1,
                "sourceAssetId": "source-asset",
                "changes": [{
                    "lineId": "line-001",
                    "operation": "delete",
                    "originalText": "旧文",
                    "box": { "x": 0.1, "y": 0.1, "width": 0.2, "height": 0.1 }
                }]
            }),
        );
        drop(database);

        let error = GenerationService::new()
            .retry_task(
                workspace.path(),
                RetryGenerationTaskInput {
                    task_id: "legacy-mismatched-task".to_string(),
                },
            )
            .expect_err("历史错误类型任务不能继续复制出新的非法任务");
        assert!(matches!(error, GenerationError::Validation(_)));

        let task_count: i64 = workspace
            .database()
            .connection()
            .query_row("SELECT COUNT(*) FROM generation_tasks", [], |row| {
                row.get(0)
            })
            .expect("查询任务数量");
        assert_eq!(task_count, 1);
    }

    #[test]
    fn retry_allows_legacy_image_edit_with_historical_prompt_payload() {
        let workspace = TestWorkspace::new("retry-legacy-image-edit-prompt");
        let database = workspace.database();
        insert_derived_result_task(
            &database,
            "legacy-valid-image-edit",
            "image-edit",
            json!({
                "kind": "product-detail-image-rewrite",
                "parentTaskId": "parent-task",
                "targetImageId": "parent-task:item-1",
                "imageNo": 1,
                "sourceAssetId": "source-asset",
                "rewriteInstruction": "换成浅灰背景",
                "prompt": {
                    "messages": [{ "role": "user", "content": "历史完整 Prompt" }],
                    "rolelessPrompt": "历史完整 Prompt"
                }
            }),
        );
        drop(database);

        let retry = GenerationService::new()
            .retry_task(
                workspace.path(),
                RetryGenerationTaskInput {
                    task_id: "legacy-valid-image-edit".to_string(),
                },
            )
            .expect("外层类型正确的历史图片编辑任务仍应可重试");

        assert_eq!(retry.kind, GenerationTaskKind::ImageEdit);
        assert_eq!(
            retry.retry_of_task_id.as_deref(),
            Some("legacy-valid-image-edit")
        );
    }

    #[test]
    fn result_rewrite_source_accepts_only_exact_legacy_fallback_identity() {
        let workspace = TestWorkspace::new("legacy-fallback-rewrite");
        let database = workspace.database();
        insert_task(&database, "legacy-task", false);
        insert_asset(&database, "current-asset");
        link_output(&database, "legacy-task", "current-asset", 0);
        drop(database);

        validate_result_image_rewrite_source(
            workspace.path(),
            "legacy-task",
            "legacy-task:0",
            1,
            "current-asset",
        )
        .expect("旧历史零基 sortOrder fallback 应可定位当前唯一槽位");

        let error = validate_result_image_rewrite_source(
            workspace.path(),
            "legacy-task",
            "legacy-task:wrong",
            1,
            "current-asset",
        )
        .expect_err("任意未锚定标识不能冒充旧历史 fallback");
        assert!(matches!(error, GenerationError::Validation(_)));
    }

    fn insert_task(database: &WorkspaceDatabase, task_id: &str, hidden: bool) {
        database
            .connection()
            .execute(
                "
                INSERT INTO generation_tasks (
                    id, attempt_no, idempotency_key, workspace, kind, status, stage,
                    title, hidden_at
                )
                VALUES (?1, 1, ?2, 'product', 'image-generation', 'succeeded',
                        'completed', ?1, CASE WHEN ?3 THEN datetime('now') END)
                ",
                params![task_id, format!("idem-{task_id}"), hidden],
            )
            .expect("插入测试任务");
    }

    fn insert_resize_task(
        database: &WorkspaceDatabase,
        task_id: &str,
        parent_task_id: &str,
        image_no: i64,
        source_asset_id: &str,
    ) {
        database
            .connection()
            .execute(
                "
                INSERT INTO generation_tasks (
                    id, attempt_no, idempotency_key, workspace, kind, status, stage,
                    title, input_json
                )
                VALUES (?1, 1, ?2, 'product', 'image-edit', 'succeeded', 'completed',
                        ?1, ?3)
                ",
                params![
                    task_id,
                    format!("idem-{task_id}"),
                    json!({
                        "kind": "result-image-resize",
                        "parentTaskId": parent_task_id,
                        "targetImageId": format!("{parent_task_id}:item-{image_no}"),
                        "imageNo": image_no,
                        "sourceAssetId": source_asset_id,
                    })
                    .to_string()
                ],
            )
            .expect("插入测试尺寸替换任务");
    }

    fn insert_derived_result_task(
        database: &WorkspaceDatabase,
        task_id: &str,
        task_kind: &str,
        input: serde_json::Value,
    ) {
        database
            .connection()
            .execute(
                "
                INSERT INTO generation_tasks (
                    id, attempt_no, idempotency_key, workspace, kind, status, stage,
                    title, input_json
                )
                VALUES (?1, 1, ?2, 'product', ?3, 'succeeded', 'completed', ?1, ?4)
                ",
                params![
                    task_id,
                    format!("idem-{task_id}"),
                    task_kind,
                    input.to_string(),
                ],
            )
            .expect("插入测试派生结果任务");
    }

    fn set_task_items(database: &WorkspaceDatabase, task_id: &str, items: serde_json::Value) {
        database
            .connection()
            .execute(
                "UPDATE generation_tasks SET input_json = ?1 WHERE id = ?2",
                params![json!({ "items": items }).to_string(), task_id],
            )
            .expect("设置测试任务 items");
    }

    fn insert_asset(database: &WorkspaceDatabase, asset_id: &str) {
        database
            .connection()
            .execute(
                "
                INSERT INTO assets (
                    id, kind, name, original_name, mime_type, relative_path, sha256,
                    width, height, size_bytes, lifecycle
                )
                VALUES (?1, 'generated', ?1, ?1, 'image/png', ?2, ?1, 512, 512, 4, 'active')
                ",
                params![asset_id, format!("assets/generated/{asset_id}.png")],
            )
            .expect("插入测试资产");
    }

    fn link_output(database: &WorkspaceDatabase, task_id: &str, asset_id: &str, sort_order: i64) {
        database
            .connection()
            .execute(
                "
                INSERT INTO generation_assets (task_id, asset_id, role, sort_order)
                VALUES (?1, ?2, 'output', ?3)
                ",
                params![task_id, asset_id, sort_order],
            )
            .expect("关联测试输出资产");
    }

    fn link_input(database: &WorkspaceDatabase, task_id: &str, asset_id: &str, sort_order: i64) {
        database
            .connection()
            .execute(
                "
                INSERT INTO generation_task_input_assets (task_id, asset_id, role, sort_order)
                VALUES (?1, ?2, 'reference', ?3)
                ",
                params![task_id, asset_id, sort_order],
            )
            .expect("关联测试输入资产");
    }

    fn asset_lifecycle(database: &WorkspaceDatabase, asset_id: &str) -> (String, Option<String>) {
        database
            .connection()
            .query_row(
                "SELECT lifecycle, deleted_at FROM assets WHERE id = ?1",
                params![asset_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("读取资产生命周期")
    }

    fn output_relation_count(database: &WorkspaceDatabase, task_id: &str, asset_id: &str) -> i64 {
        database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM generation_assets WHERE task_id = ?1 AND asset_id = ?2 AND role = 'output'",
                params![task_id, asset_id],
                |row| row.get(0),
            )
            .expect("读取输出资产关系数量")
    }

    fn input_relation_count(database: &WorkspaceDatabase, task_id: &str, asset_id: &str) -> i64 {
        database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM generation_task_input_assets WHERE task_id = ?1 AND asset_id = ?2",
                params![task_id, asset_id],
                |row| row.get(0),
            )
            .expect("读取输入资产关系数量")
    }

    fn asset_reference_count(database: &WorkspaceDatabase, asset_id: &str) -> i64 {
        database
            .connection()
            .query_row(
                "
                SELECT
                    (SELECT COUNT(*) FROM generation_assets WHERE asset_id = ?1) +
                    (SELECT COUNT(*) FROM generation_task_input_assets WHERE asset_id = ?1)
                ",
                params![asset_id],
                |row| row.get(0),
            )
            .expect("读取资产引用数量")
    }

    #[test]
    fn replace_result_image_input_allows_an_empty_parent_slot() {
        let input = serde_json::from_value::<ReplaceGenerationResultImageInput>(json!({
            "taskId": "original-task",
            "replacementTaskId": "replacement-task",
            "replacementAssetId": "replacement-asset",
        }));

        input.expect("空父槽位不应要求 currentAssetId 或 displayedAssetId");
    }

    #[test]
    fn delete_result_image_input_allows_a_failed_slot_without_assets() {
        let input = serde_json::from_value::<DeleteGenerationResultImageInput>(json!({
            "taskId": "original-task",
            "imageId": "original-task:item-1",
            "imageNo": 1,
        }));

        input.expect("失败空槽删除不应要求 assetId 或 displayedAssetId");
    }

    #[test]
    fn delete_unmerged_text_rewrite_cleans_child_assets_and_keeps_parent_result() {
        let workspace = TestWorkspace::new("delete-unmerged-text-rewrite");
        let database = workspace.database();
        insert_task(&database, "parent-task", false);
        insert_derived_result_task(
            &database,
            "text-rewrite-task",
            "image-edit",
            json!({
                "kind": "result-image-text-rewrite",
                "parentTaskId": "parent-task",
                "targetImageId": "parent-task:item-1",
                "imageNo": 1,
                "sourceAssetId": "source-asset",
                "changes": [{
                    "lineId": "line-001",
                    "operation": "replace",
                    "originalText": "旧文",
                    "replacementText": "新文",
                    "box": { "x": 0.1, "y": 0.1, "width": 0.2, "height": 0.1 }
                }]
            }),
        );
        insert_asset(&database, "source-asset");
        insert_asset(&database, "replacement-asset");
        link_output(&database, "parent-task", "source-asset", 0);
        link_input(&database, "text-rewrite-task", "source-asset", 0);
        link_output(&database, "text-rewrite-task", "replacement-asset", 0);
        drop(database);

        GenerationService::new()
            .delete_task(workspace.path(), "text-rewrite-task")
            .expect("删除未归并改字任务");

        let database = workspace.database();
        assert_eq!(
            output_relation_count(&database, "text-rewrite-task", "replacement-asset"),
            0
        );
        assert_eq!(
            input_relation_count(&database, "text-rewrite-task", "source-asset"),
            0
        );
        assert_eq!(
            output_relation_count(&database, "parent-task", "source-asset"),
            1
        );
        assert_eq!(asset_lifecycle(&database, "source-asset").0, "active");
        assert_eq!(asset_lifecycle(&database, "replacement-asset").0, "deleted");
        let hidden_at: Option<String> = database
            .connection()
            .query_row(
                "SELECT hidden_at FROM generation_tasks WHERE id = 'text-rewrite-task'",
                [],
                |row| row.get(0),
            )
            .expect("读取改字任务隐藏状态");
        assert!(hidden_at.is_some());
    }

    #[test]
    fn delete_ordinary_task_remains_hide_only() {
        let workspace = TestWorkspace::new("delete-ordinary-task");
        let database = workspace.database();
        insert_derived_result_task(&database, "ordinary-task", "image-edit", json!({}));
        insert_asset(&database, "ordinary-output");
        link_output(&database, "ordinary-task", "ordinary-output", 0);
        drop(database);

        GenerationService::new()
            .delete_task(workspace.path(), "ordinary-task")
            .expect("隐藏普通任务");

        let database = workspace.database();
        assert_eq!(
            output_relation_count(&database, "ordinary-task", "ordinary-output"),
            1
        );
        assert_eq!(asset_lifecycle(&database, "ordinary-output").0, "active");
    }

    #[test]
    fn replace_result_image_accepts_result_rewrite_with_matching_lineage() {
        let workspace = TestWorkspace::new("replace-result-rewrite");
        let database = workspace.database();
        insert_task(&database, "original-task", false);
        set_task_items(
            &database,
            "original-task",
            json!([{ "imageId": "original-task:item-1", "imageNo": 1, "sortOrder": 0 }]),
        );
        insert_derived_result_task(
            &database,
            "rewrite-task",
            "image-edit",
            json!({
                "kind": "result-image-rewrite",
                "parentTaskId": "original-task",
                "targetImageId": "original-task:item-1",
                "imageNo": 1,
                "sourceAssetId": "old-asset",
            }),
        );
        insert_asset(&database, "old-asset");
        insert_asset(&database, "replacement-asset");
        link_output(&database, "original-task", "old-asset", 0);
        link_output(&database, "rewrite-task", "replacement-asset", 0);
        drop(database);

        GenerationService::new()
            .replace_result_image(
                workspace.path(),
                ReplaceGenerationResultImageInput {
                    task_id: "original-task".into(),
                    current_asset_id: Some("old-asset".into()),
                    displayed_asset_id: Some("old-asset".into()),
                    replacement_task_id: "rewrite-task".into(),
                    replacement_asset_id: "replacement-asset".into(),
                },
            )
            .expect("匹配父槽位的商品微调结果应可替换原图");

        let service = GenerationService::new();
        let original = service
            .get_task_detail(workspace.path(), "original-task")
            .expect("读取父任务");
        assert_eq!(original.output_assets[0].asset.id, "replacement-asset");
        let visible = service
            .list_tasks(workspace.path(), GenerationTaskQuery::default())
            .expect("列出可见任务");
        assert_eq!(visible.items.len(), 1);
        assert_eq!(visible.items[0].id, "original-task");
    }

    #[test]
    fn replace_result_image_accepts_text_rewrite_with_matching_lineage() {
        let workspace = TestWorkspace::new("replace-result-text-rewrite");
        let database = workspace.database();
        insert_task(&database, "original-task", false);
        set_task_items(
            &database,
            "original-task",
            json!([{ "imageId": "original-task:item-1", "imageNo": 1, "sortOrder": 0 }]),
        );
        insert_derived_result_task(
            &database,
            "rewrite-task",
            "image-edit",
            json!({
                "kind": "result-image-text-rewrite",
                "parentTaskId": "original-task",
                "targetImageId": "original-task:item-1",
                "imageNo": 1,
                "sourceAssetId": "old-asset",
            }),
        );
        insert_asset(&database, "old-asset");
        insert_asset(&database, "replacement-asset");
        link_output(&database, "original-task", "old-asset", 0);
        link_output(&database, "rewrite-task", "replacement-asset", 0);
        drop(database);

        GenerationService::new()
            .replace_result_image(
                workspace.path(),
                ReplaceGenerationResultImageInput {
                    task_id: "original-task".into(),
                    current_asset_id: Some("old-asset".into()),
                    displayed_asset_id: Some("old-asset".into()),
                    replacement_task_id: "rewrite-task".into(),
                    replacement_asset_id: "replacement-asset".into(),
                },
            )
            .expect("匹配父槽位的文字改写结果应可替换原图");

        let original = GenerationService::new()
            .get_task_detail(workspace.path(), "original-task")
            .expect("读取父任务");
        assert_eq!(original.output_assets[0].asset.id, "replacement-asset");
    }

    #[test]
    fn replace_result_image_merges_single_item_product_and_clothing_retries_into_empty_parent_slots(
    ) {
        for (case, input_kind) in [
            ("product", "product-detail-generation"),
            ("clothing", "clothing-tryon-generation"),
        ] {
            let workspace = TestWorkspace::new(&format!("merge-empty-retry-{case}"));
            let database = workspace.database();
            insert_task(&database, "original-task", false);
            set_task_items(
                &database,
                "original-task",
                json!([{ "imageId": "original-task:item-1", "imageNo": 1, "sortOrder": 0 }]),
            );
            insert_derived_result_task(
                &database,
                "retry-task",
                "image-generation",
                json!({
                    "kind": input_kind,
                    "parentTaskId": "original-task",
                    "items": [{
                        "imageId": "original-task:item-1",
                        "imageNo": 1,
                        "sortOrder": 0,
                    }],
                }),
            );
            insert_asset(&database, "retry-asset");
            link_output(&database, "retry-task", "retry-asset", 0);
            drop(database);

            GenerationService::new()
                .replace_result_image(
                    workspace.path(),
                    ReplaceGenerationResultImageInput {
                        task_id: "original-task".into(),
                        current_asset_id: None,
                        displayed_asset_id: None,
                        replacement_task_id: "retry-task".into(),
                        replacement_asset_id: "retry-asset".into(),
                    },
                )
                .expect("单项重试结果应归并到父任务空槽");

            let service = GenerationService::new();
            let original = service
                .get_task_detail(workspace.path(), "original-task")
                .expect("读取归并后的父任务");
            assert_eq!(original.output_assets.len(), 1);
            assert_eq!(original.output_assets[0].sort_order, 0);
            assert_eq!(original.output_assets[0].asset.id, "retry-asset");
            let retry = service
                .get_task_detail(workspace.path(), "retry-task")
                .expect("读取已隐藏重试任务");
            assert!(retry.output_assets.is_empty());
            let visible = service
                .list_tasks(workspace.path(), GenerationTaskQuery::default())
                .expect("列出可见任务");
            assert_eq!(visible.items.len(), 1);
            assert_eq!(visible.items[0].id, "original-task");
        }
    }

    #[test]
    fn replace_result_image_merges_dedicated_scene_retry_into_parent_slot() {
        let workspace = TestWorkspace::new("merge-scene-retry");
        let database = workspace.database();
        insert_task(&database, "scene-parent", false);
        set_task_items(
            &database,
            "scene-parent",
            json!([{ "imageId": "scene-item-2", "imageNo": 2, "sortOrder": 1 }]),
        );
        insert_derived_result_task(
            &database,
            "scene-retry",
            "image-generation",
            json!({
                "kind": "scene-image-generation",
                "parentTaskId": "scene-parent",
                "targetImageId": "scene-item-2",
                "singleImageRetry": true,
                "items": [{
                    "imageId": "scene-item-2",
                    "imageNo": 2,
                    "sortOrder": 0,
                }],
            }),
        );
        insert_asset(&database, "scene-retry-asset");
        link_output(&database, "scene-retry", "scene-retry-asset", 0);
        drop(database);

        GenerationService::new()
            .replace_result_image(
                workspace.path(),
                ReplaceGenerationResultImageInput {
                    task_id: "scene-parent".into(),
                    current_asset_id: None,
                    displayed_asset_id: None,
                    replacement_task_id: "scene-retry".into(),
                    replacement_asset_id: "scene-retry-asset".into(),
                },
            )
            .expect("场景单图重试结果应归并父任务稳定槽位");

        let service = GenerationService::new();
        let parent = service
            .get_task_detail(workspace.path(), "scene-parent")
            .expect("读取场景父任务");
        assert_eq!(parent.output_assets.len(), 1);
        assert_eq!(parent.output_assets[0].sort_order, 1);
        assert_eq!(parent.output_assets[0].asset.id, "scene-retry-asset");
        let retry = service
            .get_task_detail(workspace.path(), "scene-retry")
            .expect("读取隐藏后的场景重试任务");
        assert!(retry.output_assets.is_empty());
    }

    #[test]
    fn replace_result_image_rejects_scene_retry_with_mismatched_lineage() {
        let workspace = TestWorkspace::new("reject-scene-retry-lineage");
        let database = workspace.database();
        insert_task(&database, "scene-parent", false);
        set_task_items(
            &database,
            "scene-parent",
            json!([{ "imageId": "scene-item-1", "imageNo": 1, "sortOrder": 0 }]),
        );
        insert_derived_result_task(
            &database,
            "scene-retry",
            "image-generation",
            json!({
                "kind": "scene-image-generation",
                "parentTaskId": "scene-parent",
                "targetImageId": "different-item",
                "singleImageRetry": true,
                "items": [{
                    "imageId": "scene-item-1",
                    "imageNo": 1,
                    "sortOrder": 0,
                }],
            }),
        );
        insert_asset(&database, "scene-retry-asset");
        link_output(&database, "scene-retry", "scene-retry-asset", 0);
        drop(database);

        let error = GenerationService::new()
            .replace_result_image(
                workspace.path(),
                ReplaceGenerationResultImageInput {
                    task_id: "scene-parent".into(),
                    current_asset_id: None,
                    displayed_asset_id: None,
                    replacement_task_id: "scene-retry".into(),
                    replacement_asset_id: "scene-retry-asset".into(),
                },
            )
            .expect_err("场景重试 targetImageId 与 item lineage 不一致必须拒绝");

        assert!(error.to_string().contains("目标结果图标识不一致"));
        let service = GenerationService::new();
        assert!(service
            .get_task_detail(workspace.path(), "scene-parent")
            .unwrap()
            .output_assets
            .is_empty());
        assert_eq!(
            service
                .get_task_detail(workspace.path(), "scene-retry")
                .unwrap()
                .output_assets
                .len(),
            1
        );
    }

    #[test]
    fn replace_result_image_rejects_retry_output_after_the_empty_parent_slot_was_deleted() {
        let workspace = TestWorkspace::new("reject-retry-after-empty-slot-delete");
        let database = workspace.database();
        insert_task(&database, "original-task", false);
        set_task_items(
            &database,
            "original-task",
            json!([{ "imageId": "original-task:item-1", "imageNo": 1, "sortOrder": 0 }]),
        );
        insert_derived_result_task(
            &database,
            "retry-task",
            "image-generation",
            json!({
                "kind": "clothing-tryon-generation",
                "parentTaskId": "original-task",
                "items": [{
                    "imageId": "original-task:item-1",
                    "imageNo": 1,
                    "sortOrder": 0,
                }],
            }),
        );
        insert_asset(&database, "retry-asset");
        link_output(&database, "retry-task", "retry-asset", 0);
        drop(database);

        let service = GenerationService::new();
        service
            .delete_result_image(
                workspace.path(),
                DeleteGenerationResultImageInput {
                    task_id: "original-task".into(),
                    image_id: "original-task:item-1".into(),
                    image_no: Some(1),
                    asset_id: None,
                    displayed_asset_id: None,
                },
            )
            .expect("失败空槽删除应先写入 tombstone");

        let error = service
            .replace_result_image(
                workspace.path(),
                ReplaceGenerationResultImageInput {
                    task_id: "original-task".into(),
                    current_asset_id: None,
                    displayed_asset_id: None,
                    replacement_task_id: "retry-task".into(),
                    replacement_asset_id: "retry-asset".into(),
                },
            )
            .expect_err("删除完成后，晚到的重试结果不能重新占用父任务槽位");
        assert!(matches!(error, GenerationError::Validation(_)));

        let original = service
            .get_task_detail(workspace.path(), "original-task")
            .expect("读取父任务");
        assert!(original.output_assets.is_empty());
        let retry = service
            .get_task_detail(workspace.path(), "retry-task")
            .expect("读取已隐藏的未归并重试任务");
        assert!(retry.output_assets.is_empty());
        let visible = service
            .list_tasks(workspace.path(), GenerationTaskQuery::default())
            .expect("列出可见任务");
        assert_eq!(visible.items.len(), 1);
        assert_eq!(visible.items[0].id, "original-task");
        let database = workspace.database();
        assert_eq!(asset_lifecycle(&database, "retry-asset").0, "deleted");
    }

    #[test]
    fn delete_result_image_records_a_tombstone_for_a_failed_empty_slot() {
        let workspace = TestWorkspace::new("delete-failed-empty-slot");
        let database = workspace.database();
        insert_task(&database, "original-task", false);
        set_task_items(
            &database,
            "original-task",
            json!([{ "imageId": "original-task:item-1", "imageNo": 1, "sortOrder": 0 }]),
        );
        drop(database);

        GenerationService::new()
            .delete_result_image(
                workspace.path(),
                DeleteGenerationResultImageInput {
                    task_id: "original-task".into(),
                    image_id: "original-task:item-1".into(),
                    image_no: Some(1),
                    asset_id: None,
                    displayed_asset_id: None,
                },
            )
            .expect("失败空槽应写入删除 tombstone");

        let detail = GenerationService::new()
            .get_task_detail(workspace.path(), "original-task")
            .expect("读取父任务");
        assert!(detail.output_assets.is_empty());
        assert_eq!(detail.events.len(), 1);
        assert_eq!(detail.events[0].event_type, "task.result-image-deleted");
        assert_eq!(
            detail.events[0].detail,
            Some(json!({
                "sortOrder": 0,
                "imageId": "original-task:item-1",
                "imageNo": 1,
                "assetId": null,
            }))
        );
    }

    #[test]
    fn delete_failed_empty_slot_cancels_a_running_retry_for_the_same_image() {
        let workspace = TestWorkspace::new("delete-empty-slot-cancels-running-retry");
        let database = workspace.database();
        insert_task(&database, "original-task", false);
        set_task_items(
            &database,
            "original-task",
            json!([{ "imageId": "original-task:item-1", "imageNo": 1, "sortOrder": 0 }]),
        );
        insert_derived_result_task(
            &database,
            "running-retry-task",
            "image-generation",
            json!({
                "kind": "product-detail-generation",
                "parentTaskId": "original-task",
                "items": [{ "imageId": "original-task:item-1", "imageNo": 1 }],
            }),
        );
        database
            .connection()
            .execute(
                "UPDATE generation_tasks SET status = 'running', stage = 'calling-provider' WHERE id = 'running-retry-task'",
                [],
            )
            .expect("将重试任务设为运行中");
        drop(database);

        GenerationService::new()
            .delete_result_image(
                workspace.path(),
                DeleteGenerationResultImageInput {
                    task_id: "original-task".into(),
                    image_id: "original-task:item-1".into(),
                    image_no: Some(1),
                    asset_id: None,
                    displayed_asset_id: None,
                },
            )
            .expect("删除失败空槽应终止同槽位运行中重试");

        let database = workspace.database();
        let (status, hidden_at, completed_at): (String, Option<String>, Option<String>) = database
            .connection()
            .query_row(
                "SELECT status, hidden_at, completed_at FROM generation_tasks WHERE id = 'running-retry-task'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("读取运行中重试终态");
        assert_eq!(status, "cancelled");
        assert!(hidden_at.is_some());
        assert!(completed_at.is_some());
    }

    #[test]
    fn replace_result_image_keeps_original_slot_hides_replacement_task_and_soft_deletes_old_asset()
    {
        let workspace = TestWorkspace::new("replace");
        let database = workspace.database();
        insert_task(&database, "original-task", false);
        insert_resize_task(
            &database,
            "replacement-task",
            "original-task",
            4,
            "old-asset",
        );
        insert_asset(&database, "old-asset");
        insert_asset(&database, "replacement-asset");
        link_output(&database, "original-task", "old-asset", 3);
        link_output(&database, "replacement-task", "replacement-asset", 0);
        link_input(&database, "replacement-task", "old-asset", 0);
        drop(database);

        GenerationService::new()
            .replace_result_image(
                workspace.path(),
                ReplaceGenerationResultImageInput {
                    task_id: "original-task".into(),
                    current_asset_id: Some("old-asset".into()),
                    displayed_asset_id: Some("old-asset".into()),
                    replacement_task_id: "replacement-task".into(),
                    replacement_asset_id: "replacement-asset".into(),
                },
            )
            .expect("替换结果图");

        let detail = GenerationService::new()
            .get_task_detail(workspace.path(), "original-task")
            .expect("读取原任务详情");
        assert_eq!(detail.output_assets.len(), 1);
        assert_eq!(detail.output_assets[0].sort_order, 3);
        assert_eq!(detail.output_assets[0].role, "output");
        assert_eq!(detail.output_assets[0].asset.id, "replacement-asset");

        let replacement_detail = GenerationService::new()
            .get_task_detail(workspace.path(), "replacement-task")
            .expect("读取替换任务详情");
        assert!(replacement_detail.output_assets.is_empty());
        let visible_tasks = GenerationService::new()
            .list_tasks(workspace.path(), GenerationTaskQuery::default())
            .expect("列出可见任务");
        assert_eq!(visible_tasks.items.len(), 1);
        assert_eq!(visible_tasks.items[0].id, "original-task");

        let database = workspace.database();
        assert_eq!(asset_lifecycle(&database, "old-asset").0, "deleted");
        assert_eq!(asset_lifecycle(&database, "replacement-asset").0, "active");
        assert_eq!(
            input_relation_count(&database, "replacement-task", "old-asset"),
            0
        );
        assert_eq!(asset_reference_count(&database, "old-asset"), 0);
    }

    #[test]
    fn replace_result_image_preserves_old_asset_when_another_visible_task_references_it() {
        let workspace = TestWorkspace::new("replace-shared");
        let database = workspace.database();
        insert_task(&database, "original-task", false);
        insert_task(&database, "shared-task", false);
        insert_resize_task(
            &database,
            "replacement-task",
            "original-task",
            1,
            "old-asset",
        );
        insert_asset(&database, "old-asset");
        insert_asset(&database, "replacement-asset");
        link_output(&database, "original-task", "old-asset", 0);
        link_output(&database, "shared-task", "old-asset", 0);
        link_output(&database, "replacement-task", "replacement-asset", 0);
        drop(database);

        GenerationService::new()
            .replace_result_image(
                workspace.path(),
                ReplaceGenerationResultImageInput {
                    task_id: "original-task".into(),
                    current_asset_id: Some("old-asset".into()),
                    displayed_asset_id: Some("old-asset".into()),
                    replacement_task_id: "replacement-task".into(),
                    replacement_asset_id: "replacement-asset".into(),
                },
            )
            .expect("替换共享结果图");

        let database = workspace.database();
        assert_eq!(asset_lifecycle(&database, "old-asset").0, "active");
    }

    #[test]
    fn replace_result_image_hides_matching_derived_task_and_soft_deletes_its_output() {
        let workspace = TestWorkspace::new("replace-derived");
        let database = workspace.database();
        insert_task(&database, "original-task", false);
        insert_resize_task(&database, "derived-task", "original-task", 1, "old-asset");
        insert_resize_task(
            &database,
            "replacement-task",
            "original-task",
            1,
            "displayed-asset",
        );
        insert_asset(&database, "old-asset");
        insert_asset(&database, "displayed-asset");
        insert_asset(&database, "derived-sibling-asset");
        insert_asset(&database, "replacement-asset");
        link_output(&database, "original-task", "old-asset", 0);
        link_output(&database, "derived-task", "displayed-asset", 0);
        link_output(&database, "derived-task", "derived-sibling-asset", 1);
        link_output(&database, "replacement-task", "replacement-asset", 0);
        drop(database);

        GenerationService::new()
            .replace_result_image(
                workspace.path(),
                ReplaceGenerationResultImageInput {
                    task_id: "original-task".into(),
                    current_asset_id: Some("old-asset".into()),
                    displayed_asset_id: Some("displayed-asset".into()),
                    replacement_task_id: "replacement-task".into(),
                    replacement_asset_id: "replacement-asset".into(),
                },
            )
            .expect("替换派生结果图");

        let visible_tasks = GenerationService::new()
            .list_tasks(workspace.path(), GenerationTaskQuery::default())
            .expect("列出可见任务");
        assert_eq!(visible_tasks.items.len(), 1);
        assert_eq!(visible_tasks.items[0].id, "original-task");
        let database = workspace.database();
        assert_eq!(asset_lifecycle(&database, "displayed-asset").0, "deleted");
        assert_eq!(
            asset_lifecycle(&database, "derived-sibling-asset").0,
            "deleted"
        );
        assert_eq!(
            output_relation_count(&database, "derived-task", "displayed-asset"),
            0
        );
        assert_eq!(
            output_relation_count(&database, "derived-task", "derived-sibling-asset"),
            0
        );
    }

    #[test]
    fn replace_result_image_hides_all_older_visible_tasks_for_the_same_slot() {
        let workspace = TestWorkspace::new("replace-all-older-derived");
        let database = workspace.database();
        insert_task(&database, "original-task", false);
        insert_resize_task(
            &database,
            "older-derived-task",
            "original-task",
            1,
            "old-asset",
        );
        insert_resize_task(
            &database,
            "displayed-derived-task",
            "original-task",
            1,
            "older-derived-asset",
        );
        insert_resize_task(
            &database,
            "replacement-task",
            "original-task",
            1,
            "displayed-asset",
        );
        for asset_id in [
            "old-asset",
            "older-derived-asset",
            "displayed-asset",
            "replacement-asset",
        ] {
            insert_asset(&database, asset_id);
        }
        link_output(&database, "original-task", "old-asset", 0);
        link_output(&database, "older-derived-task", "older-derived-asset", 0);
        link_output(&database, "displayed-derived-task", "displayed-asset", 0);
        link_output(&database, "replacement-task", "replacement-asset", 0);
        link_input(&database, "older-derived-task", "old-asset", 0);
        drop(database);

        GenerationService::new()
            .replace_result_image(
                workspace.path(),
                ReplaceGenerationResultImageInput {
                    task_id: "original-task".into(),
                    current_asset_id: Some("old-asset".into()),
                    displayed_asset_id: Some("displayed-asset".into()),
                    replacement_task_id: "replacement-task".into(),
                    replacement_asset_id: "replacement-asset".into(),
                },
            )
            .expect("最新结果应归并并清理同槽位的全部旧派生任务");

        let visible_tasks = GenerationService::new()
            .list_tasks(workspace.path(), GenerationTaskQuery::default())
            .expect("列出可见任务");
        assert_eq!(visible_tasks.items.len(), 1);
        assert_eq!(visible_tasks.items[0].id, "original-task");

        let database = workspace.database();
        for (task_id, asset_id) in [
            ("older-derived-task", "older-derived-asset"),
            ("displayed-derived-task", "displayed-asset"),
        ] {
            assert_eq!(output_relation_count(&database, task_id, asset_id), 0);
            assert_eq!(asset_lifecycle(&database, asset_id).0, "deleted");
        }
        assert_eq!(
            output_relation_count(&database, "original-task", "replacement-asset"),
            1
        );
        assert_eq!(
            output_relation_count(&database, "replacement-task", "replacement-asset"),
            0
        );
        assert_eq!(asset_lifecycle(&database, "old-asset").0, "deleted");
        assert_eq!(
            input_relation_count(&database, "older-derived-task", "old-asset"),
            0
        );
        assert_eq!(asset_reference_count(&database, "old-asset"), 0);
        assert_eq!(asset_lifecycle(&database, "replacement-asset").0, "active");
    }

    #[test]
    fn replace_result_image_cleans_older_slot_tasks_when_parent_asset_is_displayed() {
        let workspace = TestWorkspace::new("replace-parent-displayed-cleans-older");
        let database = workspace.database();
        insert_task(&database, "original-task", false);
        insert_resize_task(
            &database,
            "older-derived-task",
            "original-task",
            1,
            "old-asset",
        );
        insert_resize_task(
            &database,
            "replacement-task",
            "original-task",
            1,
            "old-asset",
        );
        for asset_id in ["old-asset", "older-derived-asset", "replacement-asset"] {
            insert_asset(&database, asset_id);
        }
        link_output(&database, "original-task", "old-asset", 0);
        link_output(&database, "older-derived-task", "older-derived-asset", 0);
        link_output(&database, "replacement-task", "replacement-asset", 0);
        drop(database);

        GenerationService::new()
            .replace_result_image(
                workspace.path(),
                ReplaceGenerationResultImageInput {
                    task_id: "original-task".into(),
                    current_asset_id: Some("old-asset".into()),
                    displayed_asset_id: Some("old-asset".into()),
                    replacement_task_id: "replacement-task".into(),
                    replacement_asset_id: "replacement-asset".into(),
                },
            )
            .expect("展示父槽位资产时也应清理同槽位旧派生任务");

        let visible_tasks = GenerationService::new()
            .list_tasks(workspace.path(), GenerationTaskQuery::default())
            .expect("列出可见任务");
        assert_eq!(visible_tasks.items.len(), 1);
        assert_eq!(visible_tasks.items[0].id, "original-task");
        let database = workspace.database();
        assert_eq!(
            output_relation_count(&database, "older-derived-task", "older-derived-asset"),
            0
        );
        assert_eq!(
            asset_lifecycle(&database, "older-derived-asset").0,
            "deleted"
        );
    }

    #[test]
    fn delete_result_image_cleans_older_slot_tasks_when_parent_asset_is_displayed() {
        let workspace = TestWorkspace::new("delete-parent-displayed-cleans-older");
        let database = workspace.database();
        insert_task(&database, "original-task", false);
        set_task_items(
            &database,
            "original-task",
            json!([{ "imageId": "original-task:item-1", "imageNo": 1, "sortOrder": 0 }]),
        );
        insert_resize_task(
            &database,
            "older-derived-task",
            "original-task",
            1,
            "old-asset",
        );
        insert_asset(&database, "old-asset");
        insert_asset(&database, "older-derived-asset");
        link_output(&database, "original-task", "old-asset", 0);
        link_output(&database, "older-derived-task", "older-derived-asset", 0);
        drop(database);

        GenerationService::new()
            .delete_result_image(
                workspace.path(),
                DeleteGenerationResultImageInput {
                    task_id: "original-task".into(),
                    image_id: "original-task:item-1".into(),
                    image_no: Some(1),
                    asset_id: Some("old-asset".into()),
                    displayed_asset_id: Some("old-asset".into()),
                },
            )
            .expect("展示父槽位资产时也应清理同槽位旧派生任务");

        let visible_tasks = GenerationService::new()
            .list_tasks(workspace.path(), GenerationTaskQuery::default())
            .expect("列出可见任务");
        assert_eq!(visible_tasks.items.len(), 1);
        assert_eq!(visible_tasks.items[0].id, "original-task");
        let database = workspace.database();
        assert_eq!(
            output_relation_count(&database, "older-derived-task", "older-derived-asset"),
            0
        );
        assert_eq!(
            asset_lifecycle(&database, "older-derived-asset").0,
            "deleted"
        );
        assert_eq!(asset_lifecycle(&database, "old-asset").0, "deleted");
    }

    #[test]
    fn delete_result_image_cancels_a_running_derived_task_before_hiding_it() {
        let workspace = TestWorkspace::new("delete-cancels-running-derived");
        let database = workspace.database();
        insert_task(&database, "original-task", false);
        set_task_items(
            &database,
            "original-task",
            json!([{ "imageId": "original-task:item-1", "imageNo": 1, "sortOrder": 0 }]),
        );
        insert_resize_task(
            &database,
            "running-derived-task",
            "original-task",
            1,
            "old-asset",
        );
        database
            .connection()
            .execute(
                "UPDATE generation_tasks SET status = 'running', stage = 'calling-provider' WHERE id = 'running-derived-task'",
                [],
            )
            .expect("将派生任务设为运行中");
        insert_asset(&database, "old-asset");
        link_output(&database, "original-task", "old-asset", 0);
        drop(database);

        GenerationService::new()
            .delete_result_image(
                workspace.path(),
                DeleteGenerationResultImageInput {
                    task_id: "original-task".into(),
                    image_id: "original-task:item-1".into(),
                    image_no: Some(1),
                    asset_id: Some("old-asset".into()),
                    displayed_asset_id: Some("old-asset".into()),
                },
            )
            .expect("删除结果图应同时终止同槽位运行中派生任务");

        let database = workspace.database();
        let (status, stage, hidden_at, completed_at): (
            String,
            String,
            Option<String>,
            Option<String>,
        ) = database
            .connection()
            .query_row(
                "SELECT status, stage, hidden_at, completed_at FROM generation_tasks WHERE id = 'running-derived-task'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .expect("读取派生任务终态");
        assert_eq!(status, "cancelled");
        assert_eq!(stage, "failed");
        assert!(hidden_at.is_some());
        assert!(completed_at.is_some());
    }

    #[test]
    fn replace_result_image_rejects_unrelated_displayed_asset_without_mutation() {
        let workspace = TestWorkspace::new("replace-unrelated-displayed");
        let database = workspace.database();
        insert_task(&database, "original-task", false);
        insert_resize_task(
            &database,
            "replacement-task",
            "original-task",
            1,
            "unrelated-asset",
        );
        insert_asset(&database, "old-asset");
        insert_asset(&database, "unrelated-asset");
        insert_asset(&database, "replacement-asset");
        link_output(&database, "original-task", "old-asset", 0);
        link_output(&database, "replacement-task", "replacement-asset", 0);
        set_task_items(
            &database,
            "original-task",
            json!([{ "imageId": "original-task:item-1", "imageNo": 1, "sortOrder": 0 }]),
        );
        drop(database);

        let error = GenerationService::new()
            .replace_result_image(
                workspace.path(),
                ReplaceGenerationResultImageInput {
                    task_id: "original-task".into(),
                    current_asset_id: Some("old-asset".into()),
                    displayed_asset_id: Some("unrelated-asset".into()),
                    replacement_task_id: "replacement-task".into(),
                    replacement_asset_id: "replacement-asset".into(),
                },
            )
            .expect_err("无关展示资产必须被拒绝");
        assert_eq!(
            error,
            GenerationError::Validation("当前展示资产与目标结果图不匹配。".to_string())
        );

        let original = GenerationService::new()
            .get_task_detail(workspace.path(), "original-task")
            .expect("读取未变更原任务");
        let replacement = GenerationService::new()
            .get_task_detail(workspace.path(), "replacement-task")
            .expect("读取未变更替换任务");
        assert_eq!(original.output_assets[0].asset.id, "old-asset");
        assert_eq!(replacement.output_assets[0].asset.id, "replacement-asset");
        let database = workspace.database();
        assert_eq!(asset_lifecycle(&database, "old-asset").0, "active");
        assert_eq!(asset_lifecycle(&database, "unrelated-asset").0, "active");
        assert_eq!(asset_lifecycle(&database, "replacement-asset").0, "active");
    }

    #[test]
    fn replace_result_image_rejects_replacement_from_another_image_slot() {
        let workspace = TestWorkspace::new("replace-wrong-slot");
        let database = workspace.database();
        insert_task(&database, "original-task", false);
        insert_resize_task(
            &database,
            "replacement-task",
            "original-task",
            2,
            "old-asset",
        );
        insert_asset(&database, "old-asset");
        insert_asset(&database, "replacement-asset");
        link_output(&database, "original-task", "old-asset", 0);
        link_output(&database, "replacement-task", "replacement-asset", 0);
        drop(database);

        let error = GenerationService::new()
            .replace_result_image(
                workspace.path(),
                ReplaceGenerationResultImageInput {
                    task_id: "original-task".into(),
                    current_asset_id: Some("old-asset".into()),
                    displayed_asset_id: Some("old-asset".into()),
                    replacement_task_id: "replacement-task".into(),
                    replacement_asset_id: "replacement-asset".into(),
                },
            )
            .expect_err("不同图片槽位的替换结果必须被拒绝");
        assert_eq!(
            error,
            GenerationError::Validation("替换任务与原结果图不匹配。".to_string())
        );
    }

    #[test]
    fn delete_result_image_removes_only_target_and_records_stable_image_identity() {
        let workspace = TestWorkspace::new("delete");
        let database = workspace.database();
        insert_task(&database, "task", false);
        insert_resize_task(&database, "derived-task", "task", 1, "asset-0");
        database
            .connection()
            .execute(
                "UPDATE generation_tasks SET input_json = ?1 WHERE id = 'derived-task'",
                params![json!({
                    "kind": "product-detail-image-rewrite",
                    "parentTaskId": "task",
                    "targetImageId": "task:item-1",
                    "imageNo": 1,
                    "sourceAssetId": "asset-0",
                })
                .to_string()],
            )
            .expect("设置 AI 改图派生任务输入");
        insert_asset(&database, "asset-0");
        insert_asset(&database, "asset-1");
        insert_asset(&database, "displayed-asset");
        link_output(&database, "task", "asset-0", 0);
        link_output(&database, "task", "asset-1", 1);
        link_output(&database, "derived-task", "displayed-asset", 0);
        set_task_items(
            &database,
            "task",
            json!([
                { "imageId": "task:item-1", "imageNo": 1, "sortOrder": 0 },
                { "imageId": "task:item-2", "imageNo": 2, "sortOrder": 1 },
            ]),
        );
        drop(database);

        GenerationService::new()
            .delete_result_image(
                workspace.path(),
                DeleteGenerationResultImageInput {
                    task_id: "task".into(),
                    image_id: "task:item-1".into(),
                    image_no: Some(1),
                    asset_id: Some("asset-0".into()),
                    displayed_asset_id: Some("displayed-asset".into()),
                },
            )
            .expect("删除结果图");

        let detail = GenerationService::new()
            .get_task_detail(workspace.path(), "task")
            .expect("读取任务详情");
        assert_eq!(detail.output_assets.len(), 1);
        assert_eq!(detail.output_assets[0].sort_order, 1);
        assert_eq!(detail.output_assets[0].asset.id, "asset-1");
        let event = detail.events.last().expect("删除事件");
        assert_eq!(event.event_type, "task.result-image-deleted");
        assert_eq!(
            event.detail,
            Some(json!({
                "sortOrder": 0,
                "imageId": "task:item-1",
                "imageNo": 1,
                "assetId": "asset-0",
            }))
        );

        let database = workspace.database();
        assert_eq!(asset_lifecycle(&database, "asset-0").0, "deleted");
        assert_eq!(asset_lifecycle(&database, "asset-1").0, "active");
        assert_eq!(asset_lifecycle(&database, "displayed-asset").0, "deleted");
        assert_eq!(
            output_relation_count(&database, "derived-task", "displayed-asset"),
            0
        );
    }

    #[test]
    fn delete_result_image_rejects_unrelated_displayed_assets_without_mutation() {
        for unrelated_kind in ["model", "source", "generated"] {
            let workspace = TestWorkspace::new(&format!("delete-unrelated-{unrelated_kind}"));
            let database = workspace.database();
            insert_task(&database, "task", false);
            insert_asset(&database, "target-asset");
            insert_asset(&database, "unrelated-asset");
            database
                .connection()
                .execute(
                    "UPDATE assets SET kind = ?1 WHERE id = 'unrelated-asset'",
                    [unrelated_kind],
                )
                .expect("设置无关资产类型");
            link_output(&database, "task", "target-asset", 0);
            set_task_items(
                &database,
                "task",
                json!([{ "imageId": "task:item-1", "imageNo": 1, "sortOrder": 0 }]),
            );
            drop(database);

            let error = GenerationService::new()
                .delete_result_image(
                    workspace.path(),
                    DeleteGenerationResultImageInput {
                        task_id: "task".into(),
                        image_id: "task:item-1".into(),
                        image_no: Some(1),
                        asset_id: Some("target-asset".into()),
                        displayed_asset_id: Some("unrelated-asset".into()),
                    },
                )
                .expect_err("无关展示资产必须被拒绝");
            assert_eq!(
                error,
                GenerationError::Validation("当前展示资产与目标结果图不匹配。".to_string())
            );

            let detail = GenerationService::new()
                .get_task_detail(workspace.path(), "task")
                .expect("读取未变更任务");
            assert_eq!(detail.output_assets.len(), 1);
            assert_eq!(detail.output_assets[0].asset.id, "target-asset");
            assert!(detail
                .events
                .iter()
                .all(|event| event.event_type != "task.result-image-deleted"));
            let database = workspace.database();
            assert_eq!(asset_lifecycle(&database, "target-asset").0, "active");
            assert_eq!(asset_lifecycle(&database, "unrelated-asset").0, "active");
        }
    }

    #[test]
    fn delete_result_image_rejects_generated_output_with_wrong_lineage() {
        let workspace = TestWorkspace::new("delete-wrong-displayed-lineage");
        let database = workspace.database();
        insert_task(&database, "task", false);
        insert_resize_task(
            &database,
            "unrelated-derived-task",
            "another-parent-task",
            1,
            "unrelated-asset",
        );
        insert_asset(&database, "target-asset");
        insert_asset(&database, "unrelated-asset");
        link_output(&database, "task", "target-asset", 0);
        link_output(&database, "unrelated-derived-task", "unrelated-asset", 0);
        set_task_items(
            &database,
            "task",
            json!([{ "imageId": "task:item-1", "imageNo": 1, "sortOrder": 0 }]),
        );
        drop(database);

        let error = GenerationService::new()
            .delete_result_image(
                workspace.path(),
                DeleteGenerationResultImageInput {
                    task_id: "task".into(),
                    image_id: "task:item-1".into(),
                    image_no: Some(1),
                    asset_id: Some("target-asset".into()),
                    displayed_asset_id: Some("unrelated-asset".into()),
                },
            )
            .expect_err("错误 lineage 的派生输出必须被拒绝");
        assert_eq!(
            error,
            GenerationError::Validation("当前展示资产与目标结果图不匹配。".to_string())
        );

        let database = workspace.database();
        assert_eq!(asset_lifecycle(&database, "target-asset").0, "active");
        assert_eq!(asset_lifecycle(&database, "unrelated-asset").0, "active");
        assert_eq!(
            output_relation_count(&database, "unrelated-derived-task", "unrelated-asset"),
            1
        );
    }

    #[test]
    fn delete_result_image_rolls_back_relation_and_soft_delete_when_event_insert_fails() {
        let workspace = TestWorkspace::new("delete-rollback");
        let database = workspace.database();
        insert_task(&database, "task", false);
        insert_asset(&database, "asset");
        link_output(&database, "task", "asset", 2);
        database
            .connection()
            .execute_batch(
                "
                CREATE TRIGGER reject_result_image_deleted_event
                BEFORE INSERT ON task_events
                WHEN NEW.event_type = 'task.result-image-deleted'
                BEGIN
                    SELECT RAISE(ABORT, 'reject delete event');
                END;
                ",
            )
            .expect("创建失败注入 trigger");
        drop(database);

        let error = GenerationService::new()
            .delete_result_image(
                workspace.path(),
                DeleteGenerationResultImageInput {
                    task_id: "task".into(),
                    image_id: "task:item-3".into(),
                    image_no: Some(3),
                    asset_id: Some("asset".into()),
                    displayed_asset_id: Some("asset".into()),
                },
            )
            .expect_err("事件失败必须回滚事务");
        assert!(error.to_string().contains("reject delete event"));

        let detail = GenerationService::new()
            .get_task_detail(workspace.path(), "task")
            .expect("读取回滚后的任务详情");
        assert_eq!(detail.output_assets.len(), 1);
        assert_eq!(detail.output_assets[0].asset.id, "asset");
        let database = workspace.database();
        assert_eq!(asset_lifecycle(&database, "asset").0, "active");
    }

    #[test]
    fn replace_result_image_rejects_non_succeeded_or_hidden_replacement_task_without_mutation() {
        let workspace = TestWorkspace::new("replace-task-state");
        let database = workspace.database();
        insert_task(&database, "original-task", false);
        insert_resize_task(
            &database,
            "replacement-task",
            "original-task",
            1,
            "old-asset",
        );
        insert_asset(&database, "old-asset");
        insert_asset(&database, "replacement-asset");
        link_output(&database, "original-task", "old-asset", 0);
        link_output(&database, "replacement-task", "replacement-asset", 0);
        database
            .connection()
            .execute(
                "UPDATE generation_tasks SET status = 'running', stage = 'calling-provider' WHERE id = 'replacement-task'",
                [],
            )
            .expect("设置运行中替换任务");
        drop(database);

        let service = GenerationService::new();
        let input = ReplaceGenerationResultImageInput {
            task_id: "original-task".into(),
            current_asset_id: Some("old-asset".into()),
            displayed_asset_id: Some("old-asset".into()),
            replacement_task_id: "replacement-task".into(),
            replacement_asset_id: "replacement-asset".into(),
        };
        service
            .replace_result_image(workspace.path(), input.clone())
            .expect_err("运行中替换任务必须被拒绝");

        let database = workspace.database();
        database
            .connection()
            .execute(
                "UPDATE generation_tasks SET status = 'succeeded', stage = 'completed', hidden_at = datetime('now') WHERE id = 'replacement-task'",
                [],
            )
            .expect("设置隐藏替换任务");
        drop(database);
        service
            .replace_result_image(workspace.path(), input)
            .expect_err("隐藏替换任务必须被拒绝");

        let original = service
            .get_task_detail(workspace.path(), "original-task")
            .expect("读取未变更原任务");
        let replacement = service
            .get_task_detail(workspace.path(), "replacement-task")
            .expect("读取未变更替换任务");
        assert_eq!(original.output_assets[0].asset.id, "old-asset");
        assert_eq!(replacement.output_assets[0].asset.id, "replacement-asset");
    }

    #[test]
    fn replace_result_image_rejects_non_generated_or_inactive_replacement_asset_without_mutation() {
        let workspace = TestWorkspace::new("replace-asset-state");
        let database = workspace.database();
        insert_task(&database, "original-task", false);
        insert_resize_task(
            &database,
            "replacement-task",
            "original-task",
            1,
            "old-asset",
        );
        insert_asset(&database, "old-asset");
        insert_asset(&database, "replacement-asset");
        link_output(&database, "original-task", "old-asset", 0);
        link_output(&database, "replacement-task", "replacement-asset", 0);
        database
            .connection()
            .execute(
                "UPDATE assets SET kind = 'model' WHERE id = 'replacement-asset'",
                [],
            )
            .expect("设置错误资产类型");
        drop(database);

        let service = GenerationService::new();
        let input = ReplaceGenerationResultImageInput {
            task_id: "original-task".into(),
            current_asset_id: Some("old-asset".into()),
            displayed_asset_id: Some("old-asset".into()),
            replacement_task_id: "replacement-task".into(),
            replacement_asset_id: "replacement-asset".into(),
        };
        service
            .replace_result_image(workspace.path(), input.clone())
            .expect_err("非 generated 替换资产必须被拒绝");

        let database = workspace.database();
        database
            .connection()
            .execute(
                "UPDATE assets SET kind = 'generated', lifecycle = 'staged' WHERE id = 'replacement-asset'",
                [],
            )
            .expect("设置 staged 替换资产");
        drop(database);
        service
            .replace_result_image(workspace.path(), input)
            .expect_err("非 active 替换资产必须被拒绝");

        let original = service
            .get_task_detail(workspace.path(), "original-task")
            .expect("读取未变更原任务");
        let replacement = service
            .get_task_detail(workspace.path(), "replacement-task")
            .expect("读取未变更替换任务");
        assert_eq!(original.output_assets[0].asset.id, "old-asset");
        assert_eq!(replacement.output_assets[0].asset.id, "replacement-asset");
    }

    #[test]
    fn replace_result_image_rejects_non_dedicated_or_multi_output_replacement_task() {
        let workspace = TestWorkspace::new("replace-task-contract");
        let database = workspace.database();
        insert_task(&database, "original-task", false);
        insert_resize_task(
            &database,
            "replacement-task",
            "wrong-parent",
            1,
            "old-asset",
        );
        insert_asset(&database, "old-asset");
        insert_asset(&database, "replacement-asset");
        insert_asset(&database, "extra-asset");
        link_output(&database, "original-task", "old-asset", 0);
        link_output(&database, "replacement-task", "replacement-asset", 0);
        drop(database);

        let service = GenerationService::new();
        let input = ReplaceGenerationResultImageInput {
            task_id: "original-task".into(),
            current_asset_id: Some("old-asset".into()),
            displayed_asset_id: Some("old-asset".into()),
            replacement_task_id: "replacement-task".into(),
            replacement_asset_id: "replacement-asset".into(),
        };
        let database = workspace.database();
        database
            .connection()
            .execute(
                "UPDATE generation_tasks SET kind = 'image-generation' WHERE id = 'replacement-task'",
                [],
            )
            .expect("设置错误替换任务 kind");
        drop(database);
        let error = service
            .replace_result_image(workspace.path(), input.clone())
            .expect_err("非白名单任务 kind 与 input kind 组合必须被拒绝");
        assert_eq!(
            error,
            GenerationError::Validation("替换任务与原结果图不匹配。".to_string())
        );

        let database = workspace.database();
        database
            .connection()
            .execute(
                "UPDATE generation_tasks SET kind = 'image-edit', input_json = ?1 WHERE id = 'replacement-task'",
                params![json!({
                    "kind": "product-detail-image-rewrite",
                    "parentTaskId": "original-task",
                }).to_string()],
            )
            .expect("设置错误替换任务 input kind");
        drop(database);
        let error = service
            .replace_result_image(workspace.path(), input.clone())
            .expect_err("缺少目标身份的商品微调任务必须被拒绝");
        assert_eq!(
            error,
            GenerationError::Validation("替换任务缺少目标结果图标识。".to_string())
        );

        let database = workspace.database();
        database
            .connection()
            .execute(
                "UPDATE generation_tasks SET input_json = ?1 WHERE id = 'replacement-task'",
                params![json!({
                    "kind": "result-image-resize",
                    "parentTaskId": "wrong-parent",
                })
                .to_string()],
            )
            .expect("设置错配 parentTaskId");
        drop(database);
        service
            .replace_result_image(workspace.path(), input.clone())
            .expect_err("parentTaskId 错配必须被拒绝");

        let database = workspace.database();
        database
            .connection()
            .execute(
                "UPDATE generation_tasks SET input_json = ?1 WHERE id = 'replacement-task'",
                params![json!({
                    "kind": "result-image-resize",
                    "parentTaskId": "original-task",
                })
                .to_string()],
            )
            .expect("修正替换任务输入");
        link_output(&database, "replacement-task", "extra-asset", 1);
        drop(database);
        service
            .replace_result_image(workspace.path(), input)
            .expect_err("多输出替换任务必须被拒绝");

        let original = service
            .get_task_detail(workspace.path(), "original-task")
            .expect("读取未变更原任务");
        let replacement = service
            .get_task_detail(workspace.path(), "replacement-task")
            .expect("读取未变更替换任务");
        assert_eq!(original.output_assets[0].asset.id, "old-asset");
        assert_eq!(replacement.output_assets.len(), 2);
    }

    #[test]
    fn delete_result_image_rejects_image_identity_mismatch_without_mutation() {
        let workspace = TestWorkspace::new("delete-identity");
        let database = workspace.database();
        insert_task(&database, "task", false);
        insert_asset(&database, "asset");
        link_output(&database, "task", "asset", 1);
        set_task_items(
            &database,
            "task",
            json!([
                { "imageId": "task:item-1", "imageNo": 1, "sortOrder": 0 },
                { "imageId": "task:item-2", "imageNo": 2, "sortOrder": 1 },
            ]),
        );
        drop(database);

        let service = GenerationService::new();
        for (image_id, image_no) in [
            ("", Some(2)),
            ("task:item-2", None),
            ("task:item-2", Some(0)),
            ("task:item-2", Some(1)),
            ("task:wrong-item", Some(2)),
        ] {
            service
                .delete_result_image(
                    workspace.path(),
                    DeleteGenerationResultImageInput {
                        task_id: "task".into(),
                        image_id: image_id.into(),
                        image_no,
                        asset_id: Some("asset".into()),
                        displayed_asset_id: Some("asset".into()),
                    },
                )
                .expect_err("错配图片身份必须被拒绝");
        }

        let detail = service
            .get_task_detail(workspace.path(), "task")
            .expect("读取未变更任务");
        assert_eq!(detail.output_assets.len(), 1);
        assert_eq!(detail.output_assets[0].asset.id, "asset");
        assert!(detail.events.is_empty());
        let database = workspace.database();
        assert_eq!(asset_lifecycle(&database, "asset").0, "active");
    }
}
