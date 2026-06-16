use sqlx::Row;
use ulid::Ulid;

use crate::domain::prompt::{
    PromptBindingSection, PromptMode, PromptPreset, PromptPresetScenario, PromptTemplateSource,
    PromptTemplateVariable, PromptVariableControlType, SavePromptPresetRequest,
    SavePromptPresetScenarioRequest,
};
use crate::error::{AppError, AppResult};
use crate::services::prompt_templates::list_prompt_templates;
use crate::storage::sqlite::WorkspaceDatabase;

pub async fn list_prompt_presets(database: &WorkspaceDatabase) -> AppResult<Vec<PromptPreset>> {
    ensure_default_prompt_presets(database).await?;
    query_prompt_presets(database).await
}

pub async fn list_prompt_preset_scenarios(
    database: &WorkspaceDatabase,
) -> AppResult<Vec<PromptPresetScenario>> {
    ensure_default_prompt_preset_scenarios(database).await?;
    query_prompt_preset_scenarios(database).await
}

pub async fn save_prompt_preset_scenario_request(
    database: &WorkspaceDatabase,
    request: SavePromptPresetScenarioRequest,
) -> AppResult<PromptPresetScenario> {
    validate_prompt_preset_scenario_request(&request)?;

    ensure_default_prompt_preset_scenarios(database).await?;

    let id = request
        .id
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| format!("prompt_preset_scenario_{}", Ulid::new()));
    let name = request.name.trim();
    if let Some(existing) = get_prompt_preset_scenario_by_name(database, name).await? {
        if existing.id != id {
            return Err(AppError::InvalidInput(
                "prompt preset scenario name already exists".to_string(),
            ));
        }
    }

    let existing = get_prompt_preset_scenario_by_id(database, &id).await?;
    if existing
        .as_ref()
        .is_some_and(|scenario| scenario.source == PromptTemplateSource::BuiltIn)
    {
        return Err(AppError::InvalidInput(
            "built-in prompt preset scenarios cannot be edited".to_string(),
        ));
    }
    let source = existing
        .as_ref()
        .map(|scenario| scenario.source.clone())
        .unwrap_or(PromptTemplateSource::Custom);
    let sort_order = existing.as_ref().map(|scenario| scenario.sort_order);
    let old_name = existing.map(|scenario| scenario.name);

    let mut writer = database.writer().await;
    sqlx::query("BEGIN IMMEDIATE").execute(&mut *writer).await?;
    let write_result = async {
        insert_or_update_prompt_preset_scenario(&mut writer, &id, name, &source, sort_order)
            .await?;
        if let Some(old_name) = old_name {
            if old_name != name {
                sqlx::query(
                    "UPDATE prompt_presets
                     SET scenario = ?, updated_at = datetime('now')
                     WHERE scenario = ?",
                )
                .bind(name)
                .bind(old_name)
                .execute(&mut *writer)
                .await?;
            }
        }
        Ok::<(), AppError>(())
    }
    .await;
    if let Err(error) = write_result {
        let _ = sqlx::query("ROLLBACK").execute(&mut *writer).await;
        return Err(error);
    }
    sqlx::query("COMMIT").execute(&mut *writer).await?;
    drop(writer);

    get_prompt_preset_scenario_by_id(database, &id)
        .await?
        .ok_or_else(|| {
            AppError::InvalidInput("saved prompt preset scenario was not found".to_string())
        })
}

pub async fn save_prompt_preset_request(
    database: &WorkspaceDatabase,
    request: SavePromptPresetRequest,
) -> AppResult<PromptPreset> {
    validate_prompt_preset_request(&request)?;

    let id = request
        .id
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| format!("prompt_preset_{}", Ulid::new()));
    if let Some(existing_preset) = get_prompt_preset_by_id(database, &id).await? {
        if existing_preset.source == PromptTemplateSource::BuiltIn {
            return Err(AppError::InvalidInput(
                "built-in prompt presets cannot be edited".to_string(),
            ));
        }
        if existing_preset.locked {
            return Err(AppError::InvalidInput(
                "locked prompt presets cannot be edited".to_string(),
            ));
        }
    }

    ensure_default_prompt_preset_scenarios(database).await?;
    let scenario_name = request.scenario.trim();
    if get_prompt_preset_scenario_by_name(database, scenario_name)
        .await?
        .is_none()
    {
        return Err(AppError::InvalidInput(
            "prompt preset scenario does not exist".to_string(),
        ));
    }

    let source = if id.starts_with("builtin_") {
        PromptTemplateSource::BuiltIn
    } else {
        PromptTemplateSource::Custom
    };

    let mut writer = database.writer().await;
    insert_or_update_prompt_preset(&mut writer, &id, &source, &request).await?;
    drop(writer);

    get_prompt_preset_by_id(database, &id)
        .await?
        .ok_or_else(|| AppError::InvalidInput("saved prompt preset was not found".to_string()))
}

async fn query_prompt_preset_scenarios(
    database: &WorkspaceDatabase,
) -> AppResult<Vec<PromptPresetScenario>> {
    let rows = sqlx::query(
        "SELECT id, name, source, sort_order, created_at, updated_at
         FROM prompt_preset_scenarios
         ORDER BY sort_order ASC, created_at ASC",
    )
    .fetch_all(database.pool())
    .await?;

    rows.into_iter()
        .map(row_to_prompt_preset_scenario)
        .collect()
}

async fn get_prompt_preset_scenario_by_id(
    database: &WorkspaceDatabase,
    id: &str,
) -> AppResult<Option<PromptPresetScenario>> {
    let row = sqlx::query(
        "SELECT id, name, source, sort_order, created_at, updated_at
         FROM prompt_preset_scenarios
         WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(database.pool())
    .await?;

    row.map(row_to_prompt_preset_scenario).transpose()
}

async fn get_prompt_preset_scenario_by_name(
    database: &WorkspaceDatabase,
    name: &str,
) -> AppResult<Option<PromptPresetScenario>> {
    let row = sqlx::query(
        "SELECT id, name, source, sort_order, created_at, updated_at
         FROM prompt_preset_scenarios
         WHERE name = ?",
    )
    .bind(name)
    .fetch_optional(database.pool())
    .await?;

    row.map(row_to_prompt_preset_scenario).transpose()
}

async fn query_prompt_presets(database: &WorkspaceDatabase) -> AppResult<Vec<PromptPreset>> {
    let rows = sqlx::query(
        "SELECT id, name, scenario, description, source,
            system_mode, system_base_template_id, system_append_text, system_override_text,
            user_mode, user_base_template_id, user_append_text, user_override_text,
            negative_mode, negative_base_template_id, negative_append_text, negative_override_text,
            variables_json, is_default, locked, created_at, updated_at
         FROM prompt_presets
         ORDER BY is_default DESC, source ASC, updated_at DESC, created_at DESC",
    )
    .fetch_all(database.pool())
    .await?;

    rows.into_iter().map(row_to_prompt_preset).collect()
}

async fn get_prompt_preset_by_id(
    database: &WorkspaceDatabase,
    id: &str,
) -> AppResult<Option<PromptPreset>> {
    let row = sqlx::query(
        "SELECT id, name, scenario, description, source,
            system_mode, system_base_template_id, system_append_text, system_override_text,
            user_mode, user_base_template_id, user_append_text, user_override_text,
            negative_mode, negative_base_template_id, negative_append_text, negative_override_text,
            variables_json, is_default, locked, created_at, updated_at
         FROM prompt_presets
         WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(database.pool())
    .await?;

    row.map(row_to_prompt_preset).transpose()
}

async fn ensure_default_prompt_presets(database: &WorkspaceDatabase) -> AppResult<()> {
    list_prompt_templates(database).await?;
    ensure_default_prompt_preset_scenarios(database).await?;

    let mut writer = database.writer().await;
    for request in default_prompt_preset_requests() {
        let id = request
            .id
            .clone()
            .expect("built-in prompt preset must have stable id");
        let source = PromptTemplateSource::BuiltIn;
        insert_or_ignore_prompt_preset(&mut writer, &id, &source, &request).await?;
    }
    Ok(())
}

async fn ensure_default_prompt_preset_scenarios(database: &WorkspaceDatabase) -> AppResult<()> {
    let mut writer = database.writer().await;
    for (id, name, sort_order) in default_prompt_preset_scenarios() {
        sqlx::query(
            "INSERT OR IGNORE INTO prompt_preset_scenarios (
                id, name, source, sort_order
             ) VALUES (?, ?, 'built_in', ?)",
        )
        .bind(id)
        .bind(name)
        .bind(sort_order)
        .execute(&mut *writer)
        .await?;
    }
    Ok(())
}

async fn insert_or_ignore_prompt_preset(
    writer: &mut sqlx::SqliteConnection,
    id: &str,
    source: &PromptTemplateSource,
    request: &SavePromptPresetRequest,
) -> AppResult<()> {
    sqlx::query(
        "INSERT OR IGNORE INTO prompt_presets (
            id, name, scenario, description, source,
            system_mode, system_base_template_id, system_append_text, system_override_text,
            user_mode, user_base_template_id, user_append_text, user_override_text,
            negative_mode, negative_base_template_id, negative_append_text, negative_override_text,
            variables_json, is_default, locked
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(id)
    .bind(request.name.trim())
    .bind(request.scenario.trim())
    .bind(request.description.trim())
    .bind(source.as_str())
    .bind(request.system.mode.as_str())
    .bind(request.system.base_template_id.as_deref())
    .bind(request.system.append_text.trim())
    .bind(request.system.override_text.trim())
    .bind(request.user.mode.as_str())
    .bind(request.user.base_template_id.as_deref())
    .bind(request.user.append_text.trim())
    .bind(request.user.override_text.trim())
    .bind(
        request
            .negative
            .as_ref()
            .map(|section| section.mode.as_str()),
    )
    .bind(
        request
            .negative
            .as_ref()
            .and_then(|section| section.base_template_id.as_deref()),
    )
    .bind(
        request
            .negative
            .as_ref()
            .map(|section| section.append_text.trim())
            .unwrap_or(""),
    )
    .bind(
        request
            .negative
            .as_ref()
            .map(|section| section.override_text.trim())
            .unwrap_or(""),
    )
    .bind(serialize_variables(&request.variables)?)
    .bind(request.is_default)
    .bind(request.locked)
    .execute(&mut *writer)
    .await?;
    Ok(())
}

async fn insert_or_update_prompt_preset_scenario(
    writer: &mut sqlx::SqliteConnection,
    id: &str,
    name: &str,
    source: &PromptTemplateSource,
    sort_order: Option<i64>,
) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO prompt_preset_scenarios (
            id, name, source, sort_order
         ) VALUES (?, ?, ?, COALESCE(?, (
            SELECT COALESCE(MAX(sort_order), 0) + 10
            FROM prompt_preset_scenarios
         )))
         ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            updated_at = datetime('now')",
    )
    .bind(id)
    .bind(name)
    .bind(source.as_str())
    .bind(sort_order)
    .execute(&mut *writer)
    .await?;
    Ok(())
}

async fn insert_or_update_prompt_preset(
    writer: &mut sqlx::SqliteConnection,
    id: &str,
    source: &PromptTemplateSource,
    request: &SavePromptPresetRequest,
) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO prompt_presets (
            id, name, scenario, description, source,
            system_mode, system_base_template_id, system_append_text, system_override_text,
            user_mode, user_base_template_id, user_append_text, user_override_text,
            negative_mode, negative_base_template_id, negative_append_text, negative_override_text,
            variables_json, is_default, locked
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            scenario = excluded.scenario,
            description = excluded.description,
            system_mode = excluded.system_mode,
            system_base_template_id = excluded.system_base_template_id,
            system_append_text = excluded.system_append_text,
            system_override_text = excluded.system_override_text,
            user_mode = excluded.user_mode,
            user_base_template_id = excluded.user_base_template_id,
            user_append_text = excluded.user_append_text,
            user_override_text = excluded.user_override_text,
            negative_mode = excluded.negative_mode,
            negative_base_template_id = excluded.negative_base_template_id,
            negative_append_text = excluded.negative_append_text,
            negative_override_text = excluded.negative_override_text,
            variables_json = excluded.variables_json,
            is_default = excluded.is_default,
            locked = excluded.locked,
            updated_at = datetime('now')",
    )
    .bind(id)
    .bind(request.name.trim())
    .bind(request.scenario.trim())
    .bind(request.description.trim())
    .bind(source.as_str())
    .bind(request.system.mode.as_str())
    .bind(request.system.base_template_id.as_deref())
    .bind(request.system.append_text.trim())
    .bind(request.system.override_text.trim())
    .bind(request.user.mode.as_str())
    .bind(request.user.base_template_id.as_deref())
    .bind(request.user.append_text.trim())
    .bind(request.user.override_text.trim())
    .bind(
        request
            .negative
            .as_ref()
            .map(|section| section.mode.as_str()),
    )
    .bind(
        request
            .negative
            .as_ref()
            .and_then(|section| section.base_template_id.as_deref()),
    )
    .bind(
        request
            .negative
            .as_ref()
            .map(|section| section.append_text.trim())
            .unwrap_or(""),
    )
    .bind(
        request
            .negative
            .as_ref()
            .map(|section| section.override_text.trim())
            .unwrap_or(""),
    )
    .bind(serialize_variables(&request.variables)?)
    .bind(request.is_default)
    .bind(request.locked)
    .execute(&mut *writer)
    .await?;
    Ok(())
}

fn row_to_prompt_preset_scenario(row: sqlx::sqlite::SqliteRow) -> AppResult<PromptPresetScenario> {
    Ok(PromptPresetScenario {
        id: row.get("id"),
        name: row.get("name"),
        source: PromptTemplateSource::from_db(row.get::<String, _>("source").as_str()),
        sort_order: row.get("sort_order"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    })
}

fn row_to_prompt_preset(row: sqlx::sqlite::SqliteRow) -> AppResult<PromptPreset> {
    let variables_json: String = row.get("variables_json");
    let variables =
        serde_json::from_str::<Vec<PromptTemplateVariable>>(&variables_json).map_err(|err| {
            AppError::PromptTemplateInvalid(format!("preset variables_json is invalid: {err}"))
        })?;
    let negative_mode: Option<String> = row.get("negative_mode");

    Ok(PromptPreset {
        id: row.get("id"),
        name: row.get("name"),
        scenario: row.get("scenario"),
        description: row.get("description"),
        source: PromptTemplateSource::from_db(row.get::<String, _>("source").as_str()),
        system: row_to_section(&row, "system")?,
        user: row_to_section(&row, "user")?,
        negative: if negative_mode.is_some() {
            Some(row_to_section(&row, "negative")?)
        } else {
            None
        },
        variables,
        is_default: row.get("is_default"),
        locked: row.get("locked"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    })
}

fn row_to_section(row: &sqlx::sqlite::SqliteRow, prefix: &str) -> AppResult<PromptBindingSection> {
    let mode: String = row.get(format!("{prefix}_mode").as_str());
    Ok(PromptBindingSection {
        mode: PromptMode::from_db(&mode).ok_or_else(|| {
            AppError::PromptTemplateInvalid(format!("invalid prompt preset mode: {mode}"))
        })?,
        base_template_id: row.get(format!("{prefix}_base_template_id").as_str()),
        append_text: row.get(format!("{prefix}_append_text").as_str()),
        override_text: row.get(format!("{prefix}_override_text").as_str()),
    })
}

fn validate_prompt_preset_request(request: &SavePromptPresetRequest) -> AppResult<()> {
    if request.name.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "prompt preset name is required".to_string(),
        ));
    }
    if request.scenario.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "prompt preset scenario is required".to_string(),
        ));
    }
    if request
        .user
        .base_template_id
        .as_deref()
        .unwrap_or("")
        .trim()
        .is_empty()
    {
        return Err(AppError::InvalidInput(
            "prompt preset user template is required".to_string(),
        ));
    }
    Ok(())
}

fn validate_prompt_preset_scenario_request(
    request: &SavePromptPresetScenarioRequest,
) -> AppResult<()> {
    if request.name.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "prompt preset scenario name is required".to_string(),
        ));
    }
    Ok(())
}

fn serialize_variables(variables: &[PromptTemplateVariable]) -> AppResult<String> {
    serde_json::to_string(variables).map_err(|err| {
        AppError::PromptTemplateInvalid(format!("preset variables_json is invalid: {err}"))
    })
}

fn default_prompt_preset_scenarios() -> Vec<(&'static str, &'static str, i64)> {
    vec![
        ("builtin_scenario_white_background", "白底主图", 10),
        ("builtin_scenario_model_display", "模特展示", 20),
        ("builtin_scenario_detail_display", "细节展示", 30),
        ("builtin_scenario_social_style", "社媒风格", 40),
    ]
}

fn default_prompt_preset_requests() -> Vec<SavePromptPresetRequest> {
    vec![
        default_prompt_preset_request(
            "builtin_ecommerce_white_background",
            "电商白底主图",
            "白底主图",
            "用于电商平台白底主图，突出服装主体。",
            "builtin_user_tryon_general",
            default_variables("写实电商展示", "纯白背景", "3:4", "连衣裙", "1"),
            true,
        ),
        default_prompt_preset_request(
            "builtin_model_display",
            "模特展示图",
            "模特展示",
            "保留人物自然状态，呈现完整服装上身效果。",
            "builtin_user_tryon_general",
            default_variables("自然写实", "室内场景", "3:4", "连衣裙", "1"),
            false,
        ),
        default_prompt_preset_request(
            "builtin_detail_display",
            "细节展示图",
            "细节展示",
            "强调面料、剪裁与局部细节质感。",
            "builtin_user_luxury_detail",
            default_variables("高级质感", "纯色背景", "4:5", "外套", "1"),
            false,
        ),
        default_prompt_preset_request(
            "builtin_social_style",
            "社媒风格图",
            "社媒风格",
            "适合社媒内容流的自然场景展示。",
            "builtin_user_luxury_detail",
            default_variables("社媒自然风", "自然光棚", "9:16", "套装", "1"),
            false,
        ),
    ]
}

fn default_prompt_preset_request(
    id: &str,
    name: &str,
    scenario: &str,
    description: &str,
    user_template_id: &str,
    variables: Vec<PromptTemplateVariable>,
    is_default: bool,
) -> SavePromptPresetRequest {
    SavePromptPresetRequest {
        id: Some(id.to_string()),
        name: name.to_string(),
        scenario: scenario.to_string(),
        description: description.to_string(),
        system: PromptBindingSection::default_with_template("builtin_system_commerce_display"),
        user: PromptBindingSection::default_with_template(user_template_id),
        negative: Some(PromptBindingSection::default_with_template(
            "builtin_negative_clean_background",
        )),
        variables,
        is_default,
        locked: true,
    }
}

fn default_variables(
    style: &str,
    background: &str,
    aspect_ratio: &str,
    garment_category: &str,
    output_count: &str,
) -> Vec<PromptTemplateVariable> {
    vec![
        default_variable("style", "风格", "休闲、商务、复古", style),
        default_variable(
            "background",
            "背景",
            "纯白背景、室内场景、自然光棚",
            background,
        ),
        default_variable(
            "aspectRatio",
            "画面比例",
            "1:1、3:4、4:5、9:16",
            aspect_ratio,
        ),
        default_variable(
            "garmentCategory",
            "服装类别",
            "连衣裙、上衣、外套、裤子",
            garment_category,
        ),
        default_variable("outputCount", "生成数量", "1、2、3、4", output_count),
    ]
}

fn default_variable(
    name: &str,
    description: &str,
    example_value: &str,
    default_value: &str,
) -> PromptTemplateVariable {
    PromptTemplateVariable {
        name: name.to_string(),
        display_name: Some(description.to_string()),
        description: description.to_string(),
        example_value: example_value.to_string(),
        required: true,
        default_value: Some(default_value.to_string()),
        control_type: PromptVariableControlType::Input,
        options: vec![],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::prompt::{
        PromptMode, PromptTemplateSource, PromptTemplateVariable, SavePromptPresetRequest,
        SavePromptPresetScenarioRequest,
    };
    use crate::storage::{file_store::WorkspacePaths, sqlite::WorkspaceDatabase};

    #[tokio::test]
    async fn prompt_presets_load_builtin_defaults() {
        let (_temp_dir, database) = test_database().await;

        let presets = list_prompt_presets(&database).await.expect("list presets");

        let default_preset = presets
            .iter()
            .find(|preset| preset.id == "builtin_ecommerce_white_background")
            .expect("builtin preset");
        assert_eq!(default_preset.name, "电商白底主图");
        assert_eq!(default_preset.source, PromptTemplateSource::BuiltIn);
        assert_eq!(
            default_preset.user.base_template_id.as_deref(),
            Some("builtin_user_tryon_general")
        );
        assert_eq!(default_preset.variables[0].name, "style");
        assert_eq!(
            default_preset.variables[0].default_value.as_deref(),
            Some("写实电商展示"),
        );
    }

    #[tokio::test]
    async fn prompt_presets_save_custom_and_reject_builtin_update() {
        let (_temp_dir, database) = test_database().await;
        let presets = list_prompt_presets(&database).await.expect("list presets");
        let builtin = presets
            .iter()
            .find(|preset| preset.id == "builtin_ecommerce_white_background")
            .expect("builtin preset");

        let saved = save_prompt_preset_request(
            &database,
            SavePromptPresetRequest {
                id: None,
                name: "我的白底主图".to_string(),
                scenario: "白底主图".to_string(),
                description: "自定义电商白底方案".to_string(),
                system: builtin.system.clone(),
                user: builtin.user.clone(),
                negative: builtin.negative.clone(),
                variables: vec![PromptTemplateVariable {
                    name: "style".to_string(),
                    display_name: Some("风格".to_string()),
                    description: "风格".to_string(),
                    example_value: "极简电商".to_string(),
                    required: true,
                    default_value: Some("极简电商".to_string()),
                    control_type: PromptVariableControlType::Input,
                    options: vec![],
                }],
                is_default: true,
                locked: false,
            },
        )
        .await
        .expect("save custom preset");
        assert!(saved.id.starts_with("prompt_preset_"));
        assert_eq!(saved.source, PromptTemplateSource::Custom);
        assert_eq!(saved.user.mode, PromptMode::Default);

        let loaded = list_prompt_presets(&database)
            .await
            .expect("reload presets");
        assert!(loaded.iter().any(|preset| preset.id == saved.id));

        let error = save_prompt_preset_request(
            &database,
            SavePromptPresetRequest {
                id: Some("builtin_ecommerce_white_background".to_string()),
                name: "覆盖内置".to_string(),
                scenario: "白底主图".to_string(),
                description: String::new(),
                system: builtin.system.clone(),
                user: builtin.user.clone(),
                negative: builtin.negative.clone(),
                variables: vec![],
                is_default: false,
                locked: false,
            },
        )
        .await
        .expect_err("builtin preset update should fail");
        assert!(error
            .to_string()
            .contains("built-in prompt presets cannot be edited"));
    }

    #[tokio::test]
    async fn prompt_preset_scenarios_can_be_added_and_renamed() {
        let (_temp_dir, database) = test_database().await;

        let scenarios = list_prompt_preset_scenarios(&database)
            .await
            .expect("list default scenarios");
        assert!(scenarios.iter().any(|scenario| scenario.name == "白底主图"));

        let saved = save_prompt_preset_scenario_request(
            &database,
            SavePromptPresetScenarioRequest {
                id: None,
                name: "直播带货".to_string(),
            },
        )
        .await
        .expect("save scenario");
        assert!(saved.id.starts_with("prompt_preset_scenario_"));
        assert_eq!(saved.name, "直播带货");

        let renamed = save_prompt_preset_scenario_request(
            &database,
            SavePromptPresetScenarioRequest {
                id: Some(saved.id.clone()),
                name: "直播货架".to_string(),
            },
        )
        .await
        .expect("rename scenario");
        assert_eq!(renamed.name, "直播货架");

        let scenarios = list_prompt_preset_scenarios(&database)
            .await
            .expect("reload scenarios");
        assert!(scenarios.iter().any(|scenario| scenario.name == "直播货架"));
        assert!(!scenarios.iter().any(|scenario| scenario.name == "直播带货"));
    }

    #[tokio::test]
    async fn built_in_prompt_preset_scenarios_cannot_be_renamed() {
        let (_temp_dir, database) = test_database().await;
        let scenarios = list_prompt_preset_scenarios(&database)
            .await
            .expect("list default scenarios");
        let builtin = scenarios
            .iter()
            .find(|scenario| scenario.id == "builtin_scenario_white_background")
            .expect("builtin scenario");

        let error = save_prompt_preset_scenario_request(
            &database,
            SavePromptPresetScenarioRequest {
                id: Some(builtin.id.clone()),
                name: "已修改白底主图".to_string(),
            },
        )
        .await
        .expect_err("built-in scenario rename should fail");

        assert!(error
            .to_string()
            .contains("built-in prompt preset scenarios cannot be edited"));
    }

    #[tokio::test]
    async fn prompt_preset_scenario_rename_updates_existing_presets() {
        let (_temp_dir, database) = test_database().await;
        let presets = list_prompt_presets(&database).await.expect("list presets");
        let builtin = presets
            .iter()
            .find(|preset| preset.id == "builtin_ecommerce_white_background")
            .expect("builtin preset");

        let saved_scenario = save_prompt_preset_scenario_request(
            &database,
            SavePromptPresetScenarioRequest {
                id: None,
                name: "直播带货".to_string(),
            },
        )
        .await
        .expect("save scenario");

        let saved_preset = save_prompt_preset_request(
            &database,
            SavePromptPresetRequest {
                id: None,
                name: "直播主图".to_string(),
                scenario: "直播带货".to_string(),
                description: String::new(),
                system: builtin.system.clone(),
                user: builtin.user.clone(),
                negative: builtin.negative.clone(),
                variables: vec![],
                is_default: false,
                locked: false,
            },
        )
        .await
        .expect("save preset");

        save_prompt_preset_scenario_request(
            &database,
            SavePromptPresetScenarioRequest {
                id: Some(saved_scenario.id),
                name: "直播货架".to_string(),
            },
        )
        .await
        .expect("rename scenario");

        let presets = list_prompt_presets(&database)
            .await
            .expect("reload presets");
        let reloaded = presets
            .iter()
            .find(|preset| preset.id == saved_preset.id)
            .expect("custom preset");
        assert_eq!(reloaded.scenario, "直播货架");
    }

    #[tokio::test]
    async fn prompt_preset_save_rejects_unknown_scenario() {
        let (_temp_dir, database) = test_database().await;
        let presets = list_prompt_presets(&database).await.expect("list presets");
        let builtin = presets
            .iter()
            .find(|preset| preset.id == "builtin_ecommerce_white_background")
            .expect("builtin preset");

        let error = save_prompt_preset_request(
            &database,
            SavePromptPresetRequest {
                id: None,
                name: "孤儿场景方案".to_string(),
                scenario: "未登记场景".to_string(),
                description: String::new(),
                system: builtin.system.clone(),
                user: builtin.user.clone(),
                negative: builtin.negative.clone(),
                variables: vec![],
                is_default: false,
                locked: false,
            },
        )
        .await
        .expect_err("unknown scenario should be rejected");

        assert!(error
            .to_string()
            .contains("prompt preset scenario does not exist"));
    }

    #[tokio::test]
    async fn prompt_preset_scenario_rename_rolls_back_when_preset_sync_fails() {
        let (_temp_dir, database) = test_database().await;
        let presets = list_prompt_presets(&database).await.expect("list presets");
        let builtin = presets
            .iter()
            .find(|preset| preset.id == "builtin_ecommerce_white_background")
            .expect("builtin preset");

        let saved_scenario = save_prompt_preset_scenario_request(
            &database,
            SavePromptPresetScenarioRequest {
                id: None,
                name: "直播带货".to_string(),
            },
        )
        .await
        .expect("save scenario");
        save_prompt_preset_request(
            &database,
            SavePromptPresetRequest {
                id: None,
                name: "直播主图".to_string(),
                scenario: "直播带货".to_string(),
                description: String::new(),
                system: builtin.system.clone(),
                user: builtin.user.clone(),
                negative: builtin.negative.clone(),
                variables: vec![],
                is_default: false,
                locked: false,
            },
        )
        .await
        .expect("save preset");

        {
            let mut writer = database.writer().await;
            sqlx::query(
                "CREATE TRIGGER fail_prompt_preset_scenario_sync
                 BEFORE UPDATE OF scenario ON prompt_presets
                 BEGIN
                   SELECT RAISE(FAIL, 'scenario sync failed');
                 END",
            )
            .execute(&mut *writer)
            .await
            .expect("create failure trigger");
        }

        save_prompt_preset_scenario_request(
            &database,
            SavePromptPresetScenarioRequest {
                id: Some(saved_scenario.id),
                name: "直播货架".to_string(),
            },
        )
        .await
        .expect_err("rename should fail");

        let scenarios = list_prompt_preset_scenarios(&database)
            .await
            .expect("reload scenarios");
        assert!(scenarios.iter().any(|scenario| scenario.name == "直播带货"));
        assert!(!scenarios.iter().any(|scenario| scenario.name == "直播货架"));
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
