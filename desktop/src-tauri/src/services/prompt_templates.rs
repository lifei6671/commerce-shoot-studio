use serde_json::{json, Map, Value};
use sqlx::Row;
use ulid::Ulid;

use crate::domain::prompt::{
    PromptTemplate, PromptTemplateSource, PromptTemplateType, PromptTemplateVariable,
    PromptVariableControlType, SavePromptTemplateRequest,
};
use crate::error::{AppError, AppResult};
use crate::storage::sqlite::WorkspaceDatabase;

const TEMPLATE_META_KEY: &str = "__meta";

pub async fn list_prompt_templates(database: &WorkspaceDatabase) -> AppResult<Vec<PromptTemplate>> {
    ensure_default_prompt_templates(database).await?;
    query_prompt_templates(database).await
}

async fn query_prompt_templates(database: &WorkspaceDatabase) -> AppResult<Vec<PromptTemplate>> {
    let rows = sqlx::query(
        "SELECT id, name, body, variables_json, created_at, updated_at
         FROM prompt_templates
         ORDER BY updated_at DESC, created_at DESC",
    )
    .fetch_all(database.pool())
    .await?;

    rows.into_iter().map(row_to_prompt_template).collect()
}

pub async fn save_prompt_template_request(
    database: &WorkspaceDatabase,
    request: SavePromptTemplateRequest,
) -> AppResult<PromptTemplate> {
    let is_create_request = request
        .id
        .as_ref()
        .map(|value| value.trim().is_empty())
        .unwrap_or(true);
    validate_prompt_template_request(&request, is_create_request)?;

    let id = request
        .id
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| format!("prompt_template_{}", Ulid::new()));
    if let Some(existing_template) = get_prompt_template_by_id(database, &id).await? {
        if existing_template.source == PromptTemplateSource::BuiltIn {
            return Err(AppError::InvalidInput(
                "built-in prompt templates cannot be edited".to_string(),
            ));
        }
        if existing_template.locked {
            return Err(AppError::InvalidInput(
                "locked prompt templates cannot be edited".to_string(),
            ));
        }
    }
    let source = if id.starts_with("builtin_") {
        PromptTemplateSource::BuiltIn
    } else {
        PromptTemplateSource::Custom
    };
    let variables_json = build_variables_json(&request, &source);

    let mut writer = database.writer().await;
    sqlx::query(
        "INSERT INTO prompt_templates (id, name, body, variables_json)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            body = excluded.body,
            variables_json = excluded.variables_json,
            updated_at = datetime('now')",
    )
    .bind(&id)
    .bind(request.name.trim())
    .bind(request.body.trim())
    .bind(variables_json.to_string())
    .execute(&mut *writer)
    .await?;
    drop(writer);

    get_prompt_template_by_id(database, &id)
        .await?
        .ok_or_else(|| AppError::InvalidInput("saved prompt template was not found".to_string()))
}

pub async fn delete_prompt_template_by_id(database: &WorkspaceDatabase, id: &str) -> AppResult<()> {
    let template = get_prompt_template_by_id(database, id)
        .await?
        .ok_or_else(|| AppError::InvalidInput("prompt template was not found".to_string()))?;
    if template.source == PromptTemplateSource::BuiltIn || template.locked {
        return Err(AppError::InvalidInput(
            "built-in or locked prompt templates cannot be deleted".to_string(),
        ));
    }
    ensure_prompt_template_not_referenced(database, id).await?;

    let mut writer = database.writer().await;
    sqlx::query("DELETE FROM prompt_templates WHERE id = ?")
        .bind(id)
        .execute(&mut *writer)
        .await?;
    Ok(())
}

async fn ensure_prompt_template_not_referenced(
    database: &WorkspaceDatabase,
    id: &str,
) -> AppResult<()> {
    let binding_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)
         FROM prompt_bindings
         WHERE template_id = ?
            OR system_base_template_id = ?
            OR user_base_template_id = ?
            OR negative_base_template_id = ?",
    )
    .bind(id)
    .bind(id)
    .bind(id)
    .bind(id)
    .fetch_one(database.pool())
    .await?;
    let preset_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)
         FROM prompt_presets
         WHERE system_base_template_id = ?
            OR user_base_template_id = ?
            OR negative_base_template_id = ?",
    )
    .bind(id)
    .bind(id)
    .bind(id)
    .fetch_one(database.pool())
    .await?;
    if binding_count > 0 || preset_count > 0 {
        return Err(AppError::InvalidInput(
            "prompt template is used by existing bindings or presets".to_string(),
        ));
    }
    Ok(())
}

pub async fn restore_default_prompt_templates(
    database: &WorkspaceDatabase,
) -> AppResult<Vec<PromptTemplate>> {
    let mut writer = database.writer().await;
    for request in default_prompt_template_requests() {
        let variables_json = build_variables_json(&request, &PromptTemplateSource::BuiltIn);
        sqlx::query(
            "INSERT INTO prompt_templates (id, name, body, variables_json)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                body = excluded.body,
                variables_json = excluded.variables_json,
                updated_at = datetime('now')",
        )
        .bind(request.id.as_deref().unwrap_or_default())
        .bind(request.name.trim())
        .bind(request.body.trim())
        .bind(variables_json.to_string())
        .execute(&mut *writer)
        .await?;
    }
    drop(writer);

    query_prompt_templates(database).await
}

async fn ensure_default_prompt_templates(database: &WorkspaceDatabase) -> AppResult<()> {
    let mut writer = database.writer().await;
    for request in default_prompt_template_requests() {
        let variables_json = build_variables_json(&request, &PromptTemplateSource::BuiltIn);
        sqlx::query(
            "INSERT OR IGNORE INTO prompt_templates (id, name, body, variables_json)
             VALUES (?, ?, ?, ?)",
        )
        .bind(request.id.as_deref().unwrap_or_default())
        .bind(request.name.trim())
        .bind(request.body.trim())
        .bind(variables_json.to_string())
        .execute(&mut *writer)
        .await?;
    }
    Ok(())
}

async fn get_prompt_template_by_id(
    database: &WorkspaceDatabase,
    id: &str,
) -> AppResult<Option<PromptTemplate>> {
    sqlx::query(
        "SELECT id, name, body, variables_json, created_at, updated_at
         FROM prompt_templates
         WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(database.pool())
    .await?
    .map(row_to_prompt_template)
    .transpose()
}

fn validate_prompt_template_request(
    request: &SavePromptTemplateRequest,
    allow_empty_body: bool,
) -> AppResult<()> {
    if request.name.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "prompt template name is required".to_string(),
        ));
    }
    if request.name.chars().count() > 50 {
        return Err(AppError::InvalidInput(
            "prompt template name cannot exceed 50 characters".to_string(),
        ));
    }
    if request.description.chars().count() > 200 {
        return Err(AppError::InvalidInput(
            "prompt template description cannot exceed 200 characters".to_string(),
        ));
    }
    if !allow_empty_body && request.body.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "prompt template body is required".to_string(),
        ));
    }
    if request.body.chars().count() > 4000 {
        return Err(AppError::InvalidInput(
            "prompt template body cannot exceed 4000 characters".to_string(),
        ));
    }
    if request.tags.len() > 5 {
        return Err(AppError::InvalidInput(
            "prompt template tags cannot exceed 5 items".to_string(),
        ));
    }
    for variable in &request.variables {
        if variable.name.trim().is_empty() {
            return Err(AppError::InvalidInput(
                "prompt template variable name is required".to_string(),
            ));
        }
        if variable.name.starts_with("__") {
            return Err(AppError::InvalidInput(
                "prompt template variable name cannot start with __".to_string(),
            ));
        }
        if variable.control_type == PromptVariableControlType::Select && variable.options.is_empty()
        {
            return Err(AppError::InvalidInput(
                "prompt template select variable options are required".to_string(),
            ));
        }
    }
    Ok(())
}

fn build_variables_json(
    request: &SavePromptTemplateRequest,
    source: &PromptTemplateSource,
) -> Value {
    let mut object = Map::new();
    for variable in &request.variables {
        object.insert(
            variable.name.trim().to_string(),
            json!({
                "displayName": variable.display_name,
                "description": variable.description,
                "exampleValue": variable.example_value,
                "required": variable.required,
                "defaultValue": variable.default_value,
                "controlType": &variable.control_type,
                "options": &variable.options,
            }),
        );
    }
    object.insert(
        TEMPLATE_META_KEY.to_string(),
        json!({
            "templateType": request.template_type.as_str(),
            "source": source.as_str(),
            "description": request.description,
            "tags": request.tags,
            "isDefault": request.is_default,
            "locked": request.locked,
        }),
    );
    Value::Object(object)
}

fn row_to_prompt_template(row: sqlx::sqlite::SqliteRow) -> AppResult<PromptTemplate> {
    let variables_json: String = row.get("variables_json");
    let variables_value: Value = serde_json::from_str(&variables_json).map_err(|err| {
        AppError::PromptTemplateInvalid(format!("template variables_json is invalid: {err}"))
    })?;
    let meta = variables_value.get(TEMPLATE_META_KEY);
    let template_type = meta
        .and_then(|value| value.get("templateType"))
        .and_then(Value::as_str)
        .map(PromptTemplateType::from_db)
        .unwrap_or(PromptTemplateType::User);
    let source = meta
        .and_then(|value| value.get("source"))
        .and_then(Value::as_str)
        .map(PromptTemplateSource::from_db)
        .unwrap_or(PromptTemplateSource::Custom);
    let description = meta
        .and_then(|value| value.get("description"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let tags = meta
        .and_then(|value| value.get("tags"))
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(ToString::to_string)
                .collect()
        })
        .unwrap_or_default();
    let is_default = meta
        .and_then(|value| value.get("isDefault"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let locked = meta
        .and_then(|value| value.get("locked"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let variables: Vec<PromptTemplateVariable> = variables_value
        .as_object()
        .map(|object| {
            object
                .iter()
                .filter_map(|(name, declaration)| {
                    (!name.starts_with("__")).then(|| PromptTemplateVariable {
                        name: name.clone(),
                        display_name: declaration
                            .get("displayName")
                            .or_else(|| declaration.get("display_name"))
                            .and_then(Value::as_str)
                            .map(ToString::to_string)
                            .or_else(|| {
                                declaration
                                    .get("description")
                                    .and_then(Value::as_str)
                                    .map(ToString::to_string)
                            }),
                        description: declaration
                            .get("description")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string(),
                        example_value: declaration
                            .get("exampleValue")
                            .or_else(|| declaration.get("example_value"))
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string(),
                        required: declaration
                            .get("required")
                            .and_then(Value::as_bool)
                            .unwrap_or(false),
                        default_value: declaration
                            .get("defaultValue")
                            .or_else(|| declaration.get("default_value"))
                            .and_then(Value::as_str)
                            .map(ToString::to_string),
                        control_type: declaration
                            .get("controlType")
                            .or_else(|| declaration.get("control_type"))
                            .and_then(Value::as_str)
                            .map(|value| match value {
                                "select" => PromptVariableControlType::Select,
                                "combobox" => PromptVariableControlType::Combobox,
                                _ => PromptVariableControlType::Input,
                            })
                            .unwrap_or_default(),
                        options: declaration
                            .get("options")
                            .and_then(Value::as_array)
                            .map(|items| {
                                items
                                    .iter()
                                    .filter_map(Value::as_str)
                                    .map(ToString::to_string)
                                    .collect()
                            })
                            .unwrap_or_default(),
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    let variables = if source == PromptTemplateSource::BuiltIn {
        variables
            .into_iter()
            .map(normalize_builtin_prompt_template_variable)
            .collect()
    } else {
        variables
    };

    Ok(PromptTemplate {
        id: row.get("id"),
        name: row.get("name"),
        template_type,
        source,
        body: row.get("body"),
        variables,
        description,
        tags,
        is_default,
        locked,
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    })
}

fn default_prompt_template_requests() -> Vec<SavePromptTemplateRequest> {
    let variables = default_variables();
    vec![
        SavePromptTemplateRequest {
            id: Some("builtin_system_commerce_display".to_string()),
            name: "电商服装展示系统规则".to_string(),
            template_type: PromptTemplateType::System,
            body: "你是专业的服装摄影与电商视觉生成助手。\n请基于以下参数生成高质量、真实感的服装展示图，适用于电商平台。\n风格：{{style}}。\n背景：{{background}}。\n画幅比例：{{aspectRatio}}。\n服装品类：{{garmentCategory}}。\n生成数量：{{outputCount}} 张。\n要求：光线自然、细节清晰、色彩真实、构图简洁，突出服装主体。".to_string(),
            variables: variables.clone(),
            description: "服装展示图的系统指令模板".to_string(),
            tags: vec!["commerce".to_string(), "system".to_string()],
            is_default: true,
            locked: false,
        },
        SavePromptTemplateRequest {
            id: Some("builtin_user_tryon_general".to_string()),
            name: "通用试穿细节描述".to_string(),
            template_type: PromptTemplateType::User,
            body: "画幅比例：{{aspectRatio}}。\n服装品类：{{garmentCategory}}。\n生成数量：{{outputCount}} 张。\n要求：光线自然、细节清晰、色彩真实、构图简洁，突出服装主体。".to_string(),
            variables: variables.clone(),
            description: "通用服装试穿用户提示词".to_string(),
            tags: vec!["tryon".to_string(), "user".to_string()],
            is_default: true,
            locked: false,
        },
        SavePromptTemplateRequest {
            id: Some("builtin_negative_clean_background".to_string()),
            name: "纯色背景避坑描述".to_string(),
            template_type: PromptTemplateType::Negative,
            body: "模糊、低清晰度、噪点、畸形、拉伸、变形、过曝、过暗、色偏、文字、水印、logo、边框。".to_string(),
            variables: Vec::new(),
            description: "常用负面提示词".to_string(),
            tags: vec!["negative".to_string()],
            is_default: true,
            locked: false,
        },
        SavePromptTemplateRequest {
            id: Some("builtin_user_luxury_detail".to_string()),
            name: "高级质感增强细节描述".to_string(),
            template_type: PromptTemplateType::User,
            body: "强化面料质感与剪裁细节，保持真实比例。\n风格：{{style}}。\n背景：{{background}}。\n输出 {{outputCount}} 张高质量结果。".to_string(),
            variables: variables.clone(),
            description: "强调质感与细节的用户提示词".to_string(),
            tags: vec!["detail".to_string()],
            is_default: false,
            locked: false,
        },
        SavePromptTemplateRequest {
            id: Some("builtin_system_extreme_style".to_string()),
            name: "极简风格系统规则".to_string(),
            template_type: PromptTemplateType::System,
            body: "生成极简、干净、商业摄影风格的服装展示图。\n背景保持{{background}}，画面比例为{{aspectRatio}}。".to_string(),
            variables: variables.clone(),
            description: "极简商业摄影系统提示词".to_string(),
            tags: vec!["minimal".to_string()],
            is_default: false,
            locked: false,
        },
        SavePromptTemplateRequest {
            id: Some("builtin_negative_detail_clean".to_string()),
            name: "细节优化避坑描述".to_string(),
            template_type: PromptTemplateType::Negative,
            body: "手部错误、面部扭曲、服装纹理错乱、布料断裂、不自然阴影、低质感、错误反射。".to_string(),
            variables: Vec::new(),
            description: "细节修正负面提示词".to_string(),
            tags: vec!["negative".to_string(), "detail".to_string()],
            is_default: false,
            locked: false,
        },
    ]
}

fn normalize_builtin_prompt_template_variable(
    mut variable: PromptTemplateVariable,
) -> PromptTemplateVariable {
    variable.control_type = PromptVariableControlType::Combobox;
    if variable.display_name.is_none() {
        variable.display_name = Some(variable.description.clone());
    }
    variable
}

fn default_variables() -> Vec<PromptTemplateVariable> {
    vec![
        PromptTemplateVariable {
            name: "style".to_string(),
            display_name: Some("风格".to_string()),
            description: "服装风格".to_string(),
            example_value: "极简、日系、欧美、复古".to_string(),
            required: true,
            default_value: Some("法式优雅".to_string()),
            control_type: PromptVariableControlType::Combobox,
            options: vec![
                "法式优雅".to_string(),
                "极简".to_string(),
                "日系".to_string(),
                "欧美".to_string(),
                "复古".to_string(),
            ],
        },
        PromptTemplateVariable {
            name: "background".to_string(),
            display_name: Some("背景".to_string()),
            description: "背景场景".to_string(),
            example_value: "纯色背景、室内场景、自然光棚".to_string(),
            required: true,
            default_value: Some("纯色背景".to_string()),
            control_type: PromptVariableControlType::Combobox,
            options: vec![
                "纯色背景".to_string(),
                "室内场景".to_string(),
                "自然光棚".to_string(),
            ],
        },
        PromptTemplateVariable {
            name: "aspectRatio".to_string(),
            display_name: Some("画面比例".to_string()),
            description: "画幅比例".to_string(),
            example_value: "1:1、3:4、4:5、9:16、16:9".to_string(),
            required: true,
            default_value: Some("3:4".to_string()),
            control_type: PromptVariableControlType::Combobox,
            options: vec![
                "1:1".to_string(),
                "3:4".to_string(),
                "4:5".to_string(),
                "9:16".to_string(),
                "16:9".to_string(),
            ],
        },
        PromptTemplateVariable {
            name: "garmentCategory".to_string(),
            display_name: Some("服装类别".to_string()),
            description: "服装品类".to_string(),
            example_value: "连衣裙、衬衫、牛仔裤、外套".to_string(),
            required: true,
            default_value: Some("连衣裙".to_string()),
            control_type: PromptVariableControlType::Combobox,
            options: vec![
                "连衣裙".to_string(),
                "衬衫".to_string(),
                "牛仔裤".to_string(),
                "外套".to_string(),
            ],
        },
        PromptTemplateVariable {
            name: "outputCount".to_string(),
            display_name: Some("生成数量".to_string()),
            description: "生成数量".to_string(),
            example_value: "1、2、3、4、6、8".to_string(),
            required: true,
            default_value: Some("3".to_string()),
            control_type: PromptVariableControlType::Combobox,
            options: vec![
                "1".to_string(),
                "2".to_string(),
                "3".to_string(),
                "4".to_string(),
                "6".to_string(),
                "8".to_string(),
            ],
        },
    ]
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::storage::{file_store::WorkspacePaths, sqlite::WorkspaceDatabase};

    #[tokio::test]
    async fn prompt_template_crud_round_trips_metadata() {
        let (_temp_dir, database) = test_database().await;
        let template = save_prompt_template_request(
            &database,
            SavePromptTemplateRequest {
                id: None,
                name: "Custom".to_string(),
                template_type: PromptTemplateType::User,
                body: "wear {{garment}}".to_string(),
                variables: vec![PromptTemplateVariable {
                    name: "garment".to_string(),
                    display_name: Some("服装".to_string()),
                    description: "服装".to_string(),
                    example_value: "连衣裙".to_string(),
                    required: true,
                    default_value: Some("连衣裙".to_string()),
                    control_type: PromptVariableControlType::Input,
                    options: vec![],
                }],
                description: "desc".to_string(),
                tags: vec!["tag".to_string()],
                is_default: true,
                locked: true,
            },
        )
        .await
        .expect("save template");

        let templates = list_prompt_templates(&database)
            .await
            .expect("list templates");
        let saved = templates
            .into_iter()
            .find(|item| item.id == template.id)
            .expect("saved template");
        assert_eq!(saved.template_type, PromptTemplateType::User);
        assert_eq!(saved.source, PromptTemplateSource::Custom);
        assert_eq!(saved.description, "desc");
        assert_eq!(saved.tags, vec!["tag"]);
        assert!(saved.is_default);
        assert!(saved.locked);
        assert_eq!(saved.variables[0].name, "garment");
    }

    #[tokio::test]
    async fn prompt_template_create_allows_empty_body_for_basic_info_flow() {
        let (_temp_dir, database) = test_database().await;
        let template = save_prompt_template_request(
            &database,
            SavePromptTemplateRequest {
                id: None,
                name: "Draft Template".to_string(),
                template_type: PromptTemplateType::User,
                body: String::new(),
                variables: vec![],
                description: String::new(),
                tags: vec![],
                is_default: false,
                locked: false,
            },
        )
        .await
        .expect("create template with basic info only");

        assert_eq!(template.name, "Draft Template");
        assert_eq!(template.body, "");
        assert_eq!(template.source, PromptTemplateSource::Custom);
    }

    #[tokio::test]
    async fn prompt_template_defaults_restore_builtin_templates() {
        let (_temp_dir, database) = test_database().await;
        let templates = restore_default_prompt_templates(&database)
            .await
            .expect("restore defaults");

        assert!(templates
            .iter()
            .any(|item| item.name == "电商服装展示系统规则"));
        assert!(templates
            .iter()
            .any(|item| item.template_type == PromptTemplateType::Negative));

        let raw: String = sqlx::query_scalar(
            "SELECT variables_json FROM prompt_templates WHERE id = 'builtin_system_commerce_display'",
        )
        .fetch_one(database.pool())
        .await
        .expect("default variables");
        let value: Value = serde_json::from_str(&raw).expect("json");
        assert_eq!(value["__meta"]["source"], json!("built_in"));
    }

    #[tokio::test]
    async fn prompt_template_list_backfills_missing_builtin_templates() {
        let (_temp_dir, database) = test_database().await;
        sqlx::query(
            "INSERT INTO prompt_templates (id, name, body, variables_json)
             VALUES ('custom_existing', 'Custom Existing', 'custom body', '{}')",
        )
        .execute(database.pool())
        .await
        .expect("insert custom template");

        let templates = list_prompt_templates(&database)
            .await
            .expect("list templates");

        assert!(templates.iter().any(|item| item.id == "custom_existing"));
        assert!(templates
            .iter()
            .any(|item| item.id == "builtin_system_commerce_display"));
        assert!(templates
            .iter()
            .any(|item| item.id == "builtin_user_tryon_general"));
        assert!(templates
            .iter()
            .any(|item| item.id == "builtin_negative_clean_background"));
    }

    #[tokio::test]
    async fn prompt_template_save_rejects_builtin_template_updates() {
        let (_temp_dir, database) = test_database().await;
        restore_default_prompt_templates(&database)
            .await
            .expect("restore defaults");

        let error = save_prompt_template_request(
            &database,
            SavePromptTemplateRequest {
                id: Some("builtin_system_commerce_display".to_string()),
                name: "Edited Builtin".to_string(),
                template_type: PromptTemplateType::System,
                body: "edited".to_string(),
                variables: vec![],
                description: String::new(),
                tags: vec![],
                is_default: true,
                locked: false,
            },
        )
        .await
        .expect_err("builtin update should fail");

        assert!(error
            .to_string()
            .contains("built-in prompt templates cannot be edited"));
    }

    #[tokio::test]
    async fn prompt_template_delete_rejects_template_used_by_binding() {
        let (_temp_dir, database) = test_database().await;
        let template = save_prompt_template_request(
            &database,
            SavePromptTemplateRequest {
                id: None,
                name: "Used Template".to_string(),
                template_type: PromptTemplateType::User,
                body: "used body".to_string(),
                variables: vec![],
                description: String::new(),
                tags: vec![],
                is_default: false,
                locked: false,
            },
        )
        .await
        .expect("save template");
        sqlx::query(
            "INSERT INTO assets (
                id, asset_type, original_name, relative_path, thumb_relative_path,
                mime_type, sha256, width, height
             ) VALUES ('person_1', 'person', 'person.png', 'assets/person/person.png',
                'assets/cache/thumbs/person.jpg', 'image/png', 'sha-person', 10, 10)",
        )
        .execute(database.pool())
        .await
        .expect("insert person");
        sqlx::query(
            "INSERT INTO image_combinations (id, name, person_asset_id)
             VALUES ('combination_1', 'Look', 'person_1')",
        )
        .execute(database.pool())
        .await
        .expect("insert combination");
        sqlx::query(
            "INSERT INTO prompt_bindings (
                id, combination_id, template_id, mode, variables_json, append_text, override_text,
                user_mode, user_base_template_id, user_append_text, user_override_text,
                system_mode, system_append_text, system_override_text
             ) VALUES (
                'binding_1', 'combination_1', ?, 'default', '{}', '', '',
                'default', ?, '', '',
                'default', '', ''
             )",
        )
        .bind(&template.id)
        .bind(&template.id)
        .execute(database.pool())
        .await
        .expect("insert binding");

        let error = delete_prompt_template_by_id(&database, &template.id)
            .await
            .expect_err("referenced template should not be deleted");

        assert!(error
            .to_string()
            .contains("prompt template is used by existing bindings or presets"));
    }

    #[tokio::test]
    async fn prompt_template_delete_rejects_template_used_by_preset() {
        let (_temp_dir, database) = test_database().await;
        let template = save_prompt_template_request(
            &database,
            SavePromptTemplateRequest {
                id: None,
                name: "Preset Template".to_string(),
                template_type: PromptTemplateType::User,
                body: "preset body".to_string(),
                variables: vec![],
                description: String::new(),
                tags: vec![],
                is_default: false,
                locked: false,
            },
        )
        .await
        .expect("save template");
        sqlx::query(
            "INSERT INTO prompt_presets (
                id, name, scenario, description, source,
                user_mode, user_base_template_id
             ) VALUES (
                'preset_1', 'Preset', '场景', '', 'custom',
                'default', ?
             )",
        )
        .bind(&template.id)
        .execute(database.pool())
        .await
        .expect("insert preset");

        let error = delete_prompt_template_by_id(&database, &template.id)
            .await
            .expect_err("referenced template should not be deleted");

        assert!(error
            .to_string()
            .contains("prompt template is used by existing bindings or presets"));
    }

    async fn test_database() -> (tempfile::TempDir, WorkspaceDatabase) {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let paths = WorkspacePaths::new(temp_dir.path().join("workspace"));
        paths.ensure().expect("workspace");
        let database = WorkspaceDatabase::connect(&paths.database_path())
            .await
            .expect("connect");
        crate::storage::migrations::run_workspace_migrations(&paths, &database)
            .await
            .expect("migrate");
        (temp_dir, database)
    }
}
