use serde_json::{json, Value};
use sqlx::Row;
use ulid::Ulid;

use crate::domain::model::{
    ModelConfig, ModelDefinition, ModelInputLimits, ModelOutputSchema, ModelParamKind,
    ModelParamSchema, SaveModelConfigRequest, ValidateModelConfigInput, ValidatedModelConfig,
};
use crate::domain::combination::{
    EffectiveModel, EffectiveValidationLimits, ValidateCombinationRequest,
    ValidateCombinationResponse, ValidationReason, ValidationReasonCode, ValidationWarning,
};
use crate::domain::prompt::ResolvePromptInput;
use crate::error::{AppError, AppResult};
use crate::services::prompt_resolver::PromptResolver;
use crate::storage::sqlite::WorkspaceDatabase;

pub fn list_model_definitions(advanced_models: bool) -> Vec<ModelDefinition> {
    fixed_model_definitions()
        .into_iter()
        .filter(|definition| advanced_models || !definition.advanced)
        .collect()
}

pub fn validate_model_config(input: ValidateModelConfigInput) -> AppResult<ValidatedModelConfig> {
    let definition = fixed_model_definitions()
        .into_iter()
        .find(|definition| {
            definition.provider == input.request.provider
                && definition.model_id == input.request.model_id
        })
        .ok_or_else(|| {
            AppError::ModelConfigInvalid(format!(
                "model {}:{} is not supported",
                input.request.provider, input.request.model_id
            ))
        })?;

    if definition.advanced && !input.advanced_models {
        return Err(AppError::ModelConfigInvalid(format!(
            "model {} is not available in this phase",
            definition.model_id
        )));
    }

    let normalized_output_count = normalize_output_count(&definition, &input.request.params_json)?;
    validate_required_params(&definition, &input.request.params_json)?;

    Ok(ValidatedModelConfig {
        input_limits: definition.input_limits.clone(),
        normalized_output_count,
        normalized_params_json: input.request.params_json,
        definition,
    })
}

pub fn normalize_output_count(definition: &ModelDefinition, params_json: &Value) -> AppResult<u32> {
    let value = params_json
        .get(&definition.output.count_param_key)
        .and_then(Value::as_u64)
        .unwrap_or(u64::from(definition.output.min_count));
    let count = u32::try_from(value).map_err(|_| {
        AppError::ModelConfigInvalid(format!(
            "{} must be between {} and {}",
            definition.output.count_param_key, definition.output.min_count, definition.output.max_count
        ))
    })?;

    if count < definition.output.min_count || count > definition.output.max_count {
        return Err(AppError::ModelConfigInvalid(format!(
            "{} must be between {} and {}",
            definition.output.count_param_key, definition.output.min_count, definition.output.max_count
        )));
    }
    Ok(count)
}

pub async fn save_model_config_request(
    database: &WorkspaceDatabase,
    request: SaveModelConfigRequest,
    advanced_models: bool,
) -> AppResult<ModelConfig> {
    let validated = validate_model_config(ValidateModelConfigInput {
        request: request.clone(),
        advanced_models,
    })?;
    let id = request
        .id
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| format!("model_config_{}", Ulid::new()));

    let mut writer = database.writer().await;
    sqlx::query(
        "INSERT INTO model_configs (id, provider, model_id, params_json)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           provider = excluded.provider,
           model_id = excluded.model_id,
           params_json = excluded.params_json,
           updated_at = datetime('now')",
    )
    .bind(&id)
    .bind(&validated.definition.provider)
    .bind(&validated.definition.model_id)
    .bind(validated.normalized_params_json.to_string())
    .execute(&mut *writer)
    .await?;
    drop(writer);

    get_model_config_by_id(database, &id)
        .await?
        .ok_or_else(|| AppError::ModelConfigInvalid("saved model config was not found".to_string()))
}

pub async fn get_model_config_by_id(
    database: &WorkspaceDatabase,
    id: &str,
) -> AppResult<Option<ModelConfig>> {
    let row = sqlx::query(
        "SELECT id, provider, model_id, params_json, created_at, updated_at
         FROM model_configs
         WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(database.pool())
    .await?;

    row.map(row_to_model_config).transpose()
}

pub async fn validate_combination_request(
    database: &WorkspaceDatabase,
    request: ValidateCombinationRequest,
) -> AppResult<ValidateCombinationResponse> {
    let mut reasons = Vec::new();
    let mut warnings = Vec::new();
    let mut effective_limits = EffectiveValidationLimits::default();
    let mut resolved_prompt = None;
    let mut effective_model = None;

    match request.draft_combination.person_asset_id.as_deref() {
        Some(person_asset_id) => {
            if !asset_exists_with_type(database, person_asset_id, "person").await? {
                reasons.push(reason(
                    ValidationReasonCode::AssetNotFound,
                    format!("person asset {person_asset_id} was not found"),
                    Some("draftCombination.personAssetId"),
                ));
            }
        }
        None => reasons.push(reason(
            ValidationReasonCode::PersonAssetRequired,
            "person asset is required",
            Some("draftCombination.personAssetId"),
        )),
    }

    for garment_asset_id in &request.draft_combination.garment_asset_ids {
        if !asset_exists_with_type(database, garment_asset_id, "garment").await? {
            reasons.push(reason(
                ValidationReasonCode::AssetNotFound,
                format!("garment asset {garment_asset_id} was not found"),
                Some("draftCombination.garmentAssetIds"),
            ));
        }
    }

    if let Some(model_config) = request.draft_model_config.clone() {
        match validate_model_config(ValidateModelConfigInput {
            request: model_config.clone(),
            advanced_models: false,
        }) {
            Ok(validated) => {
                effective_limits = EffectiveValidationLimits {
                    min_garments: validated.input_limits.min_garments,
                    max_garments: validated.input_limits.max_garments,
                    normalized_output_count: validated.normalized_output_count,
                };
                effective_model = Some(EffectiveModel {
                    provider: validated.definition.provider,
                    model_id: validated.definition.model_id,
                    advanced: validated.definition.advanced,
                    params_json: validated.normalized_params_json,
                });
            }
            Err(AppError::ModelConfigInvalid(message)) => reasons.push(reason(
                ValidationReasonCode::ModelParamInvalid,
                message,
                Some("draftModelConfig"),
            )),
            Err(err) => return Err(err),
        }
    } else {
        reasons.push(reason(
            ValidationReasonCode::ModelConfigRequired,
            "model config is required",
            Some("draftModelConfig"),
        ));
    }

    let garment_count = request.draft_combination.garment_asset_ids.len() as u32;
    if garment_count < effective_limits.min_garments {
        reasons.push(reason(
            ValidationReasonCode::GarmentCountBelowMin,
            format!(
                "at least {} garment assets are required",
                effective_limits.min_garments
            ),
            Some("draftCombination.garmentAssetIds"),
        ));
    }
    if garment_count > effective_limits.max_garments {
        reasons.push(reason(
            ValidationReasonCode::GarmentCountAboveMax,
            format!(
                "at most {} garment assets are allowed",
                effective_limits.max_garments
            ),
            Some("draftCombination.garmentAssetIds"),
        ));
    }

    if let Some(prompt_binding) = request.draft_prompt_binding.clone() {
        let declarations_json = load_prompt_declarations_for_draft(database, &prompt_binding).await?;
        let system_template =
            load_prompt_template_body(database, prompt_binding.system.base_template_id.as_deref())
                .await?;
        let user_template =
            load_prompt_template_body(database, prompt_binding.user.base_template_id.as_deref())
                .await?;
        let negative_template = match &prompt_binding.negative {
            Some(section) => {
                load_prompt_template_body(database, section.base_template_id.as_deref()).await?
            }
            None => None,
        };

        match PromptResolver::resolve(ResolvePromptInput {
            system_template,
            user_template,
            negative_template,
            binding: prompt_binding,
            declarations_json,
            revision: Some(request.revision),
        }) {
            Ok(prompt) => {
                warnings.extend(prompt.warnings.iter().map(|message| ValidationWarning {
                    code: "PROMPT_WARNING".to_string(),
                    message: message.clone(),
                }));
                resolved_prompt = Some(prompt);
            }
            Err(AppError::PromptRequiredVariableMissing(message)) => reasons.push(reason(
                ValidationReasonCode::PromptRequiredVariableMissing,
                message,
                Some("draftPromptBinding.variablesJson"),
            )),
            Err(AppError::PromptTemplateInvalid(message)) => reasons.push(reason(
                ValidationReasonCode::PromptTemplateInvalid,
                message,
                Some("draftPromptBinding"),
            )),
            Err(err) => return Err(err),
        }
    } else {
        reasons.push(reason(
            ValidationReasonCode::PromptBindingRequired,
            "prompt binding is required",
            Some("draftPromptBinding"),
        ));
    }

    Ok(ValidateCombinationResponse {
        revision: request.revision,
        executable: reasons.is_empty(),
        reasons,
        warnings,
        effective_limits,
        resolved_prompt,
        effective_model,
    })
}

async fn asset_exists_with_type(
    database: &WorkspaceDatabase,
    asset_id: &str,
    asset_type: &str,
) -> AppResult<bool> {
    let exists: Option<String> =
        sqlx::query_scalar("SELECT id FROM assets WHERE id = ? AND asset_type = ?")
            .bind(asset_id)
            .bind(asset_type)
            .fetch_optional(database.pool())
            .await?;
    Ok(exists.is_some())
}

async fn load_prompt_template_body(
    database: &WorkspaceDatabase,
    template_id: Option<&str>,
) -> AppResult<Option<String>> {
    let Some(template_id) = template_id else {
        return Ok(None);
    };
    Ok(sqlx::query_scalar("SELECT body FROM prompt_templates WHERE id = ?")
        .bind(template_id)
        .fetch_optional(database.pool())
        .await?)
}

async fn load_prompt_declarations_for_draft(
    database: &WorkspaceDatabase,
    binding: &crate::domain::prompt::SavePromptBindingRequest,
) -> AppResult<serde_json::Value> {
    let mut merged = serde_json::Map::new();
    for template_id in [
        binding.system.base_template_id.as_deref(),
        binding.user.base_template_id.as_deref(),
        binding
            .negative
            .as_ref()
            .and_then(|section| section.base_template_id.as_deref()),
    ]
    .into_iter()
    .flatten()
    {
        let declarations: Option<String> =
            sqlx::query_scalar("SELECT variables_json FROM prompt_templates WHERE id = ?")
                .bind(template_id)
                .fetch_optional(database.pool())
                .await?;
        if let Some(declarations) = declarations {
            let value: serde_json::Value = serde_json::from_str(&declarations).map_err(|err| {
                AppError::PromptTemplateInvalid(format!(
                    "template {template_id} variables_json is invalid: {err}"
                ))
            })?;
            if let Some(object) = value.as_object() {
                for (name, declaration) in object {
                    merged.insert(name.clone(), declaration.clone());
                }
            }
        }
    }
    Ok(serde_json::Value::Object(merged))
}

fn reason(
    code: ValidationReasonCode,
    message: impl Into<String>,
    field: Option<&str>,
) -> ValidationReason {
    ValidationReason {
        code,
        message: message.into(),
        field: field.map(str::to_string),
    }
}

fn row_to_model_config(row: sqlx::sqlite::SqliteRow) -> AppResult<ModelConfig> {
    let request = SaveModelConfigRequest {
        id: Some(row.get("id")),
        provider: row.get("provider"),
        model_id: row.get("model_id"),
        params_json: serde_json::from_str(row.get::<String, _>("params_json").as_str())
            .map_err(|err| AppError::ModelConfigInvalid(format!("params_json is invalid: {err}")))?,
    };
    let validated = validate_model_config(ValidateModelConfigInput {
        request: request.clone(),
        advanced_models: true,
    })?;

    Ok(ModelConfig {
        id: request.id.unwrap_or_default(),
        provider: request.provider,
        model_id: request.model_id,
        params_json: request.params_json,
        input_limits: validated.input_limits,
        normalized_output_count: validated.normalized_output_count,
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    })
}

fn validate_required_params(definition: &ModelDefinition, params_json: &Value) -> AppResult<()> {
    for schema in &definition.params_schema {
        if schema.required && params_json.get(&schema.key).is_none() {
            return Err(AppError::ModelConfigInvalid(format!(
                "model param {} is required",
                schema.key
            )));
        }
        if let Some(value) = params_json.get(&schema.key) {
            validate_param_value(schema, value)?;
        }
    }
    Ok(())
}

fn validate_param_value(schema: &ModelParamSchema, value: &Value) -> AppResult<()> {
    match schema.kind {
        ModelParamKind::Integer => {
            let number = value.as_i64().ok_or_else(|| {
                AppError::ModelConfigInvalid(format!("model param {} must be an integer", schema.key))
            })?;
            if let Some(min) = schema.min {
                if number < min {
                    return Err(AppError::ModelConfigInvalid(format!(
                        "model param {} must be at least {}",
                        schema.key, min
                    )));
                }
            }
            if let Some(max) = schema.max {
                if number > max {
                    return Err(AppError::ModelConfigInvalid(format!(
                        "model param {} must be at most {}",
                        schema.key, max
                    )));
                }
            }
        }
        ModelParamKind::Select => {
            if !schema.options.iter().any(|option| option == value) {
                return Err(AppError::ModelConfigInvalid(format!(
                    "model param {} has unsupported option",
                    schema.key
                )));
            }
        }
        ModelParamKind::Text => {
            if !value.is_string() {
                return Err(AppError::ModelConfigInvalid(format!(
                    "model param {} must be text",
                    schema.key
                )));
            }
        }
    }
    Ok(())
}

fn fixed_model_definitions() -> Vec<ModelDefinition> {
    vec![
        ModelDefinition {
            provider: "openai".to_string(),
            model_id: "gpt-image-1".to_string(),
            display_name: "GPT Image 1".to_string(),
            advanced: false,
            input_limits: ModelInputLimits {
                min_garments: 1,
                max_garments: 4,
            },
            params_schema: vec![
                ModelParamSchema {
                    key: "outputCount".to_string(),
                    label: "Output count".to_string(),
                    kind: ModelParamKind::Integer,
                    required: true,
                    default_value: json!(1),
                    min: Some(1),
                    max: Some(4),
                    options: Vec::new(),
                },
                ModelParamSchema {
                    key: "size".to_string(),
                    label: "Size".to_string(),
                    kind: ModelParamKind::Select,
                    required: true,
                    default_value: json!("1024x1024"),
                    min: None,
                    max: None,
                    options: vec![json!("1024x1024"), json!("1024x1536"), json!("1536x1024")],
                },
            ],
            output: ModelOutputSchema {
                count_param_key: "outputCount".to_string(),
                min_count: 1,
                max_count: 4,
            },
            provider_base_url: None,
        },
        ModelDefinition {
            provider: "openai".to_string(),
            model_id: "gpt-image-1-fast".to_string(),
            display_name: "GPT Image 1 Fast".to_string(),
            advanced: false,
            input_limits: ModelInputLimits {
                min_garments: 1,
                max_garments: 2,
            },
            params_schema: vec![ModelParamSchema {
                key: "outputCount".to_string(),
                label: "Output count".to_string(),
                kind: ModelParamKind::Integer,
                required: true,
                default_value: json!(1),
                min: Some(1),
                max: Some(2),
                options: Vec::new(),
            }],
            output: ModelOutputSchema {
                count_param_key: "outputCount".to_string(),
                min_count: 1,
                max_count: 2,
            },
            provider_base_url: None,
        },
        ModelDefinition {
            provider: "openai".to_string(),
            model_id: "gpt-image-1-pro".to_string(),
            display_name: "GPT Image 1 Pro".to_string(),
            advanced: true,
            input_limits: ModelInputLimits {
                min_garments: 1,
                max_garments: 8,
            },
            params_schema: vec![ModelParamSchema {
                key: "outputCount".to_string(),
                label: "Output count".to_string(),
                kind: ModelParamKind::Integer,
                required: true,
                default_value: json!(1),
                min: Some(1),
                max: Some(8),
                options: Vec::new(),
            }],
            output: ModelOutputSchema {
                count_param_key: "outputCount".to_string(),
                min_count: 1,
                max_count: 8,
            },
            provider_base_url: None,
        },
    ]
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::storage::file_store::WorkspacePaths;
    use crate::storage::migrations::run_workspace_migrations;
    use crate::domain::combination::{DraftImageCombination, ValidationReasonCode};
    use crate::domain::prompt::{PromptBindingSection, PromptMode, SavePromptBindingRequest};

    #[test]
    fn list_model_definitions_filters_advanced_models_when_disabled() {
        let public_defs = list_model_definitions(false);
        assert!(public_defs.iter().all(|definition| !definition.advanced));

        let all_defs = list_model_definitions(true);
        assert!(all_defs.iter().any(|definition| definition.advanced));
        assert!(all_defs
            .iter()
            .all(|definition| definition.provider_base_url.is_none()));
    }

    #[test]
    fn validate_model_config_derives_limits_and_normalized_output_count() {
        let validated = validate_model_config(ValidateModelConfigInput {
            request: SaveModelConfigRequest {
                id: None,
                provider: "openai".to_string(),
                model_id: "gpt-image-1".to_string(),
                params_json: json!({
                    "outputCount": 3,
                    "size": "1024x1024"
                }),
            },
            advanced_models: false,
        })
        .expect("validate model");

        assert_eq!(validated.input_limits.min_garments, 1);
        assert_eq!(validated.input_limits.max_garments, 4);
        assert_eq!(validated.normalized_output_count, 3);
    }

    #[test]
    fn validate_model_config_rejects_advanced_models_when_disabled() {
        let result = validate_model_config(ValidateModelConfigInput {
            request: SaveModelConfigRequest {
                id: None,
                provider: "openai".to_string(),
                model_id: "gpt-image-1-pro".to_string(),
                params_json: json!({"outputCount": 1}),
            },
            advanced_models: false,
        });

        assert!(matches!(result, Err(AppError::ModelConfigInvalid(_))));
    }

    #[test]
    fn normalize_output_count_uses_count_param_key_and_bounds() {
        let definition = list_model_definitions(true)
            .into_iter()
            .find(|definition| definition.model_id == "gpt-image-1")
            .expect("definition");

        assert_eq!(
            normalize_output_count(&definition, &json!({"outputCount": 2})).unwrap(),
            2
        );
        assert!(normalize_output_count(&definition, &json!({"outputCount": 0})).is_err());
        assert!(normalize_output_count(&definition, &json!({"outputCount": 9})).is_err());
    }

    #[tokio::test]
    async fn save_model_config_persists_and_reads_model_config() {
        let (_temp_dir, database) = test_database().await;

        let saved = save_model_config_request(
            &database,
            SaveModelConfigRequest {
                id: None,
                provider: "openai".to_string(),
                model_id: "gpt-image-1".to_string(),
                params_json: json!({
                    "outputCount": 2,
                    "size": "1024x1024"
                }),
            },
            false,
        )
        .await
        .expect("save config");

        let reloaded = get_model_config_by_id(&database, &saved.id)
            .await
            .expect("read config")
            .expect("config exists");

        assert_eq!(reloaded.provider, "openai");
        assert_eq!(reloaded.model_id, "gpt-image-1");
        assert_eq!(reloaded.normalized_output_count, 2);
        assert_eq!(reloaded.input_limits.max_garments, 4);
    }

    #[tokio::test]
    async fn validate_combination_uses_revision_and_draft_model_limits() {
        let (_temp_dir, database) = test_database().await;
        seed_assets_and_prompt_template(&database).await;

        let response = validate_combination_request(
            &database,
            ValidateCombinationRequest {
                revision: 42,
                draft_combination: DraftImageCombination {
                    id: None,
                    name: Some("look".to_string()),
                    person_asset_id: Some("person_1".to_string()),
                    garment_asset_ids: vec![
                        "garment_1".to_string(),
                        "garment_2".to_string(),
                        "garment_3".to_string(),
                    ],
                },
                draft_prompt_binding: Some(test_prompt_binding(json!({"garment": "linen dress"}))),
                draft_model_config: Some(SaveModelConfigRequest {
                    id: None,
                    provider: "openai".to_string(),
                    model_id: "gpt-image-1-fast".to_string(),
                    params_json: json!({"outputCount": 2}),
                }),
            },
        )
        .await
        .expect("validate");

        assert_eq!(response.revision, 42);
        assert!(!response.executable);
        assert_eq!(response.effective_limits.max_garments, 2);
        assert_eq!(response.effective_limits.normalized_output_count, 2);
        assert!(response
            .reasons
            .iter()
            .any(|reason| reason.code == ValidationReasonCode::GarmentCountAboveMax));
    }

    #[tokio::test]
    async fn validate_combination_maps_prompt_required_variable_to_reason() {
        let (_temp_dir, database) = test_database().await;
        seed_assets_and_prompt_template(&database).await;

        let response = validate_combination_request(
            &database,
            ValidateCombinationRequest {
                revision: 7,
                draft_combination: DraftImageCombination {
                    id: None,
                    name: Some("look".to_string()),
                    person_asset_id: Some("person_1".to_string()),
                    garment_asset_ids: vec!["garment_1".to_string()],
                },
                draft_prompt_binding: Some(test_prompt_binding(json!({}))),
                draft_model_config: Some(SaveModelConfigRequest {
                    id: None,
                    provider: "openai".to_string(),
                    model_id: "gpt-image-1".to_string(),
                    params_json: json!({"outputCount": 1, "size": "1024x1024"}),
                }),
            },
        )
        .await
        .expect("validate");

        assert!(!response.executable);
        assert!(response.resolved_prompt.is_none());
        assert!(response
            .reasons
            .iter()
            .any(|reason| reason.code == ValidationReasonCode::PromptRequiredVariableMissing));
    }

    #[tokio::test]
    async fn validate_combination_returns_executable_for_valid_draft() {
        let (_temp_dir, database) = test_database().await;
        seed_assets_and_prompt_template(&database).await;

        let response = validate_combination_request(
            &database,
            ValidateCombinationRequest {
                revision: 8,
                draft_combination: DraftImageCombination {
                    id: None,
                    name: Some("look".to_string()),
                    person_asset_id: Some("person_1".to_string()),
                    garment_asset_ids: vec!["garment_1".to_string()],
                },
                draft_prompt_binding: Some(test_prompt_binding(json!({"garment": "linen dress"}))),
                draft_model_config: Some(SaveModelConfigRequest {
                    id: None,
                    provider: "openai".to_string(),
                    model_id: "gpt-image-1".to_string(),
                    params_json: json!({"outputCount": 1, "size": "1024x1024"}),
                }),
            },
        )
        .await
        .expect("validate");

        assert!(response.executable);
        assert!(response.reasons.is_empty());
        assert_eq!(response.resolved_prompt.expect("prompt").user, "wear linen dress");
        assert_eq!(response.effective_model.expect("model").model_id, "gpt-image-1");
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

    async fn seed_assets_and_prompt_template(database: &WorkspaceDatabase) {
        let mut writer = database.writer().await;
        for (id, asset_type) in [
            ("person_1", "person"),
            ("garment_1", "garment"),
            ("garment_2", "garment"),
            ("garment_3", "garment"),
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
        sqlx::query(
            "INSERT INTO prompt_templates (id, name, body, variables_json)
             VALUES ('template_user', 'User', 'wear {{garment}}', '{\"garment\":{\"required\":true}}')",
        )
        .execute(&mut *writer)
        .await
        .expect("seed prompt template");
    }

    fn test_prompt_binding(variables_json: serde_json::Value) -> SavePromptBindingRequest {
        SavePromptBindingRequest {
            id: None,
            combination_id: "draft".to_string(),
            system: PromptBindingSection {
                mode: PromptMode::Default,
                base_template_id: None,
                append_text: String::new(),
                override_text: String::new(),
            },
            user: PromptBindingSection {
                mode: PromptMode::Default,
                base_template_id: Some("template_user".to_string()),
                append_text: String::new(),
                override_text: String::new(),
            },
            negative: None,
            variables_json,
        }
    }
}
