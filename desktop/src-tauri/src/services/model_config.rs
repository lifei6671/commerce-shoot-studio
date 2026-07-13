use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use reqwest::Url;
use rusqlite::{params, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

use crate::domain::errors::{
    normalize_provider_http_error, normalize_provider_transport_error, ProviderTransportErrorKind,
};
use crate::infrastructure::database::{DatabaseError, WorkspaceDatabase};
use crate::services::provider_connection::{
    HttpProviderConnectionTester, ProviderConnectionProbe, ProviderConnectionResult,
    ProviderConnectionTester, VOLCENGINE_SEEDREAM_5_PRO_MODEL,
};
use crate::services::secrets::{create_secret_id, secret_status_for_profile, SecretStatus};

pub const CAPABILITIES: &[ModelCapabilityDefinition] = &[
    ModelCapabilityDefinition::new(
        "listing-copy",
        "text-to-text",
        "上架文案",
        "mock-listing-copy-v1",
    ),
    ModelCapabilityDefinition::new(
        "prompt-plan",
        "text-to-text",
        "生成方案",
        "mock-prompt-plan-v1",
    ),
    ModelCapabilityDefinition::new(
        "product-selling-points",
        "image-to-text",
        "商品卖点提取",
        "mock-product-selling-points-v1",
    ),
    ModelCapabilityDefinition::new(
        "image-text-recognition",
        "image-to-text",
        "图片文字识别",
        "mock-image-text-recognition-v1",
    ),
    ModelCapabilityDefinition::new(
        "clothing-scene-planning",
        "image-to-text",
        "服饰场景动作规划",
        "mock-clothing-scene-plan-v1",
    ),
    ModelCapabilityDefinition::new(
        "scene-prompt-planning",
        "image-to-text",
        "场景图片方案规划",
        "mock-scene-prompt-plan-v1",
    ),
    ModelCapabilityDefinition::new(
        "viral-style-analysis",
        "text-to-text",
        "爆款风格分析",
        "mock-viral-style-v1",
    ),
    ModelCapabilityDefinition::new(
        "scene-image-generation",
        "image-to-image",
        "场景图生成",
        "mock-scene-image-v1",
    ),
    ModelCapabilityDefinition::new(
        "product-detail-generation",
        "text-to-image",
        "商品详情图生成",
        "mock-product-detail-v1",
    ),
    ModelCapabilityDefinition::new(
        "clothing-base-model-generation",
        "text-to-image",
        "服饰基准模特生成",
        "mock-clothing-base-model-v1",
    ),
    ModelCapabilityDefinition::new(
        "clothing-tryon-generation",
        "image-to-image",
        "服饰试穿生成",
        "mock-clothing-tryon-v1",
    ),
    ModelCapabilityDefinition::new(
        "image-edit",
        "image-to-image",
        "图片编辑",
        "mock-image-edit-v1",
    ),
];

#[derive(Debug, Clone, Copy)]
pub struct ModelCapabilityDefinition {
    pub id: &'static str,
    pub category: &'static str,
    pub display_name: &'static str,
    pub mock_model: &'static str,
}

impl ModelCapabilityDefinition {
    const fn new(
        id: &'static str,
        category: &'static str,
        display_name: &'static str,
        mock_model: &'static str,
    ) -> Self {
        Self {
            id,
            category,
            display_name,
            mock_model,
        }
    }

    pub(crate) fn max_input_assets(&self) -> i64 {
        match self.id {
            "image-text-recognition" => 1,
            "clothing-scene-planning" | "clothing-tryon-generation" => 6,
            "scene-prompt-planning" | "scene-image-generation" => 3,
            _ => match self.category {
                "text-to-text" | "text-to-image" => 0,
                "image-to-text" => 3,
                "image-to-image" => 4,
                _ => 0,
            },
        }
    }

    pub(crate) fn supported_aspect_ratios(&self) -> &'static [&'static str] {
        match self.id {
            "clothing-base-model-generation" => &["2:3"],
            "clothing-scene-planning"
            | "clothing-tryon-generation"
            | "scene-prompt-planning"
            | "scene-image-generation" => &["3:4", "1:1", "9:16"],
            _ => &["1:1", "3:4", "9:16", "16:9"],
        }
    }

    pub(crate) fn max_image_count(&self) -> i64 {
        match self.id {
            "clothing-base-model-generation" => 1,
            _ => match self.category {
                "text-to-image" | "image-to-image" => 4,
                _ => 1,
            },
        }
    }
}

pub(crate) fn capability_requires_real_provider(capability_id: &str) -> bool {
    matches!(
        capability_id,
        "image-edit"
            | "image-text-recognition"
            | "clothing-scene-planning"
            | "clothing-base-model-generation"
            | "clothing-tryon-generation"
            | "scene-prompt-planning"
            | "scene-image-generation"
    )
}

#[derive(Debug, Clone)]
pub struct ProviderProfile {
    pub id: &'static str,
    pub display_name: &'static str,
    pub provider_label: &'static str,
    pub protocol: &'static str,
    pub base_url: &'static str,
    pub default_endpoint_path: Option<&'static str>,
    pub model_list_path: Option<&'static str>,
    pub supported_categories: &'static [&'static str],
    pub supported_capabilities: &'static [&'static str],
    pub custom_enabled: bool,
    pub requires_secret: bool,
}

pub const ALL_CAPABILITY_IDS: &[&str] = &[
    "listing-copy",
    "prompt-plan",
    "product-selling-points",
    "image-text-recognition",
    "clothing-scene-planning",
    "scene-prompt-planning",
    "viral-style-analysis",
    "scene-image-generation",
    "product-detail-generation",
    "clothing-base-model-generation",
    "clothing-tryon-generation",
    "image-edit",
];

pub const ALL_CATEGORIES: &[&str] = &[
    "text-to-text",
    "text-to-image",
    "image-to-image",
    "image-to-text",
];

pub const TEXT_CAPABILITY_IDS: &[&str] = &["listing-copy", "prompt-plan", "viral-style-analysis"];
pub const TEXT_CATEGORIES: &[&str] = &["text-to-text"];
pub const OPENAI_CAPABILITY_IDS: &[&str] = &[
    "listing-copy",
    "prompt-plan",
    "product-selling-points",
    "image-text-recognition",
    "clothing-scene-planning",
    "scene-prompt-planning",
    "viral-style-analysis",
    "clothing-base-model-generation",
    "clothing-tryon-generation",
    "scene-image-generation",
    "image-edit",
];
pub const OPENAI_CATEGORIES: &[&str] = &[
    "text-to-text",
    "text-to-image",
    "image-to-image",
    "image-to-text",
];

pub const PROVIDER_PROFILES: &[ProviderProfile] = &[
    ProviderProfile {
        id: "mock-local",
        display_name: "Mock Local",
        provider_label: "Mock Local",
        protocol: "openai-compatible",
        base_url: "mock://local",
        default_endpoint_path: None,
        model_list_path: None,
        supported_categories: ALL_CATEGORIES,
        supported_capabilities: ALL_CAPABILITY_IDS,
        custom_enabled: false,
        requires_secret: false,
    },
    ProviderProfile {
        id: "openai",
        display_name: "OpenAI",
        provider_label: "OpenAI",
        protocol: "openai",
        base_url: "https://api.openai.com",
        default_endpoint_path: Some("/v1/responses"),
        model_list_path: Some("/v1/models"),
        supported_categories: OPENAI_CATEGORIES,
        supported_capabilities: OPENAI_CAPABILITY_IDS,
        custom_enabled: false,
        requires_secret: true,
    },
    ProviderProfile {
        id: "deepseek",
        display_name: "DeepSeek",
        provider_label: "DeepSeek",
        protocol: "openai-compatible",
        base_url: "https://api.deepseek.com",
        default_endpoint_path: Some("/chat/completions"),
        model_list_path: Some("/models"),
        supported_categories: TEXT_CATEGORIES,
        supported_capabilities: TEXT_CAPABILITY_IDS,
        custom_enabled: false,
        requires_secret: true,
    },
    ProviderProfile {
        id: "volcengine",
        display_name: "火山引擎",
        provider_label: "火山引擎",
        protocol: "openai-compatible",
        base_url: "https://ark.cn-beijing.volces.com/api/v3",
        default_endpoint_path: Some("/chat/completions"),
        model_list_path: Some("/models"),
        supported_categories: ALL_CATEGORIES,
        supported_capabilities: ALL_CAPABILITY_IDS,
        custom_enabled: false,
        requires_secret: true,
    },
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderProfileView {
    pub id: String,
    pub display_name: String,
    pub provider_label: String,
    pub protocol: String,
    pub base_url: String,
    pub default_endpoint_path: Option<String>,
    pub supported_categories: Vec<String>,
    pub supported_capabilities: Vec<String>,
    pub custom_enabled: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalModelConfigView {
    pub id: String,
    pub capability_id: String,
    pub provider_profile_id: String,
    pub display_name: String,
    pub provider_label: String,
    pub protocol: String,
    pub execution_mode: String,
    pub model: String,
    pub base_url: String,
    pub endpoint_path: Option<String>,
    pub secret_status: SecretStatus,
    pub connection_status: String,
    pub connection_message: Option<String>,
    pub connection_tested_at: Option<String>,
    pub enabled: bool,
    pub is_default: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageSizeOption {
    pub id: String,
    pub label: String,
    pub ratio: String,
    pub width: i64,
    pub height: i64,
    pub provider_value: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelImageSizeOptions {
    pub capability_id: String,
    pub config_id: String,
    pub provider_profile_id: String,
    pub model: String,
    pub options: Vec<ImageSizeOption>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedModelConfig {
    pub provider_profile_id: String,
    pub view: LocalModelConfigView,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveLocalModelConfigInput {
    pub id: Option<String>,
    pub capability_id: String,
    pub provider_profile_id: String,
    pub display_name: String,
    pub execution_mode: String,
    pub model: String,
    #[serde(default)]
    pub base_url: Option<String>,
    pub endpoint_path: Option<String>,
    pub enabled: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetDefaultModelConfigInput {
    pub capability_id: String,
    pub config_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderTestResult {
    pub ok: bool,
    pub message: Option<String>,
    pub elapsed_ms: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ModelConfigError {
    Validation(String),
    NotFound(String),
    Database(String),
    ProviderHttp {
        status_code: i64,
        provider_error_code: Option<String>,
    },
    ProviderTransport(ProviderTransportErrorKind),
}

impl std::fmt::Display for ModelConfigError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Validation(message) | Self::Database(message) => write!(formatter, "{message}"),
            Self::NotFound(id) => write!(formatter, "模型配置不存在：{id}"),
            Self::ProviderHttp {
                status_code,
                provider_error_code,
            } => write!(
                formatter,
                "{}",
                normalize_provider_http_error(*status_code, provider_error_code.as_deref()).message
            ),
            Self::ProviderTransport(kind) => write!(
                formatter,
                "{}",
                normalize_provider_transport_error(*kind).message
            ),
        }
    }
}

impl std::error::Error for ModelConfigError {}

#[derive(Debug, Clone, Copy, Default)]
pub struct ModelConfigService;

impl ModelConfigService {
    pub fn new() -> Self {
        Self
    }

    pub fn list_provider_profiles(&self) -> Result<Vec<ProviderProfileView>, ModelConfigError> {
        Ok(PROVIDER_PROFILES.iter().map(profile_to_view).collect())
    }

    pub fn list_configs(
        &self,
        workspace_directory: &Path,
    ) -> Result<Vec<LocalModelConfigView>, ModelConfigError> {
        let database = open_database(workspace_directory)?;
        ensure_mock_default_configs(&database)?;
        list_configs(&database)
    }

    pub fn get_config(
        &self,
        workspace_directory: &Path,
        config_id: &str,
    ) -> Result<LocalModelConfigView, ModelConfigError> {
        let database = open_database(workspace_directory)?;
        ensure_mock_default_configs(&database)?;
        find_config_by_id(&database, config_id)?
            .ok_or_else(|| ModelConfigError::NotFound(config_id.to_string()))
    }

    pub fn list_image_size_options(
        &self,
        workspace_directory: &Path,
        capability_id: &str,
    ) -> Result<ModelImageSizeOptions, ModelConfigError> {
        let resolved = default_resolved_config_for_capability(workspace_directory, capability_id)?;
        let config = resolved.view;

        Ok(ModelImageSizeOptions {
            capability_id: capability_id.to_string(),
            config_id: config.id,
            provider_profile_id: resolved.provider_profile_id,
            model: config.model.clone(),
            options: image_size_options(&config.provider_profile_id, &config.model),
        })
    }

    pub fn save_config(
        &self,
        workspace_directory: &Path,
        input: SaveLocalModelConfigInput,
    ) -> Result<LocalModelConfigView, ModelConfigError> {
        validate_config_input(&input)?;
        let database = open_database(workspace_directory)?;
        ensure_mock_default_configs(&database)?;
        let profile = provider_profile(&input.provider_profile_id).ok_or_else(|| {
            ModelConfigError::Validation("provider_profile_id 不在内置 allowlist 中。".to_string())
        })?;
        let capability = capability_definition(&input.capability_id)
            .ok_or_else(|| ModelConfigError::Validation("不支持的 capabilityId。".to_string()))?;
        ensure_profile_supports_capability(profile, &input.capability_id)?;
        let id = input.id.unwrap_or_else(create_config_id);
        let should_be_default = default_config_exists(&database, &input.capability_id)? == 0;
        let base_url = resolve_base_url(profile, input.base_url.as_deref())?;
        let endpoint_path =
            resolve_endpoint_path(profile, capability.category, input.endpoint_path.as_deref());

        if should_be_default {
            clear_default_for_capability(&database, &input.capability_id)?;
        }

        database.connection().execute(
            "
            INSERT INTO model_configs (
                id, capability_id, provider_profile_id, display_name, protocol,
                execution_mode, model, base_url, endpoint_path, enabled, is_default, updated_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, datetime('now'))
            ON CONFLICT(id) DO UPDATE SET
                capability_id = excluded.capability_id,
                provider_profile_id = excluded.provider_profile_id,
                display_name = excluded.display_name,
                protocol = excluded.protocol,
                execution_mode = excluded.execution_mode,
                model = excluded.model,
                base_url = excluded.base_url,
                endpoint_path = excluded.endpoint_path,
                enabled = excluded.enabled,
                updated_at = datetime('now')
            ",
            params![
                id,
                input.capability_id,
                input.provider_profile_id,
                input.display_name,
                profile.protocol,
                input.execution_mode,
                input.model,
                base_url,
                endpoint_path,
                bool_to_i64(input.enabled),
                bool_to_i64(should_be_default),
            ],
        )?;
        if profile.requires_secret {
            ensure_related_category_secret(
                &database,
                &input.provider_profile_id,
                &input.capability_id,
                capability.category,
            )?;
        }

        find_config_by_id(&database, &id)?.ok_or(ModelConfigError::NotFound(id))
    }

    pub fn set_default_config(
        &self,
        workspace_directory: &Path,
        input: SetDefaultModelConfigInput,
    ) -> Result<LocalModelConfigView, ModelConfigError> {
        let database = open_database(workspace_directory)?;
        ensure_mock_default_configs(&database)?;
        let config = find_config_by_id(&database, &input.config_id)?
            .ok_or_else(|| ModelConfigError::NotFound(input.config_id.clone()))?;
        if config.capability_id != input.capability_id {
            return Err(ModelConfigError::Validation(
                "默认配置的 capabilityId 与配置记录不一致。".to_string(),
            ));
        }

        clear_default_for_capability(&database, &input.capability_id)?;
        database.connection().execute(
            "UPDATE model_configs SET is_default = 1, updated_at = datetime('now') WHERE id = ?1",
            params![input.config_id],
        )?;

        find_config_by_id(&database, &config.id)?.ok_or(ModelConfigError::NotFound(config.id))
    }

    pub fn delete_config(
        &self,
        workspace_directory: &Path,
        config_id: &str,
    ) -> Result<(), ModelConfigError> {
        let database = open_database(workspace_directory)?;
        ensure_mock_default_configs(&database)?;
        let deleted = database.connection().execute(
            "DELETE FROM model_configs WHERE id = ?1",
            params![config_id],
        )?;
        if deleted == 0 {
            return Err(ModelConfigError::NotFound(config_id.to_string()));
        }
        Ok(())
    }

    pub fn test_config(
        &self,
        workspace_directory: &Path,
        config_id: &str,
    ) -> Result<ProviderTestResult, ModelConfigError> {
        let tester = HttpProviderConnectionTester::new()
            .map_err(|source| ModelConfigError::Validation(source.to_string()))?;
        self.test_config_with_tester(workspace_directory, config_id, &tester)
    }

    pub fn test_config_with_tester<T: ProviderConnectionTester>(
        &self,
        workspace_directory: &Path,
        config_id: &str,
        tester: &T,
    ) -> Result<ProviderTestResult, ModelConfigError> {
        let database = open_database(workspace_directory)?;
        ensure_mock_default_configs(&database)?;
        let config = find_config_by_id(&database, config_id)?
            .ok_or_else(|| ModelConfigError::NotFound(config_id.to_string()))?;
        let profile = provider_profile(&config.provider_profile_id).ok_or_else(|| {
            ModelConfigError::Validation("provider_profile_id 不在内置 allowlist 中。".to_string())
        })?;
        let capability = capability_definition(&config.capability_id)
            .ok_or_else(|| ModelConfigError::Validation("不支持的 capabilityId。".to_string()))?;
        let result = if !config.enabled {
            ProviderConnectionResult {
                ok: false,
                message: "模型配置未启用。".to_string(),
                elapsed_ms: 0,
            }
        } else if !profile.requires_secret {
            ProviderConnectionResult {
                ok: true,
                message: "Mock Provider 可用。".to_string(),
                elapsed_ms: 0,
            }
        } else if !config.secret_status.configured {
            ProviderConnectionResult {
                ok: false,
                message: "模型配置缺少 API Key。".to_string(),
                elapsed_ms: 0,
            }
        } else {
            let secret_value = load_secret_value(
                &database,
                &config.provider_profile_id,
                &config.capability_id,
            )?
            .ok_or_else(|| ModelConfigError::Validation("模型配置缺少 API Key。".to_string()))?;
            tester
                .test_connection(ProviderConnectionProbe {
                    provider_profile_id: config.provider_profile_id.clone(),
                    base_url: config.base_url.clone(),
                    endpoint_path: resolve_endpoint_path(
                        profile,
                        capability.category,
                        config.endpoint_path.as_deref(),
                    )
                    .unwrap_or_else(|| "/chat/completions".to_string()),
                    category: capability.category.to_string(),
                    model: config.model.clone(),
                    api_key: secret_value,
                })
                .map_err(|source| ModelConfigError::Validation(source.to_string()))?
        };
        let connection_status = if result.ok {
            "available"
        } else {
            "unavailable"
        };
        update_connection_status(&database, config_id, connection_status, &result.message)?;
        update_related_connection_status(
            &database,
            &config,
            capability.category,
            connection_status,
            &result.message,
            profile.requires_secret,
        )?;

        Ok(ProviderTestResult {
            ok: result.ok,
            message: Some(result.message),
            elapsed_ms: Some(result.elapsed_ms),
        })
    }
}

fn update_connection_status(
    database: &WorkspaceDatabase,
    config_id: &str,
    connection_status: &str,
    connection_message: &str,
) -> Result<(), ModelConfigError> {
    let fingerprint = current_connection_fingerprint_for_config(database, config_id)?;
    database.connection().execute(
        "
            UPDATE model_configs
            SET connection_status = ?1,
                connection_message = ?2,
                connection_tested_at = datetime('now'),
                connection_fingerprint = ?3,
                updated_at = datetime('now')
            WHERE id = ?4
            ",
        params![
            connection_status,
            connection_message,
            fingerprint,
            config_id,
        ],
    )?;

    Ok(())
}

fn update_related_connection_status(
    database: &WorkspaceDatabase,
    tested_config: &LocalModelConfigView,
    category: &str,
    connection_status: &str,
    connection_message: &str,
    requires_secret: bool,
) -> Result<(), ModelConfigError> {
    for capability in CAPABILITIES
        .iter()
        .filter(|capability| capability.category == category)
    {
        if let Some(config_id) =
            related_default_config_id(database, tested_config, capability.id, requires_secret)?
        {
            update_connection_status(database, &config_id, connection_status, connection_message)?;
        }
    }

    Ok(())
}

fn related_default_config_id(
    database: &WorkspaceDatabase,
    tested_config: &LocalModelConfigView,
    capability_id: &str,
    requires_secret: bool,
) -> Result<Option<String>, ModelConfigError> {
    database
        .connection()
        .query_row(
            "
            SELECT config.id
            FROM model_configs config
            LEFT JOIN model_secrets secret
              ON secret.provider_profile_id = config.provider_profile_id
             AND secret.capability_id = config.capability_id
            WHERE config.capability_id = ?1
              AND config.provider_profile_id = ?2
              AND config.execution_mode = ?3
              AND config.model = ?4
              AND COALESCE(config.base_url, ?5) = ?6
              AND COALESCE(config.endpoint_path, '') = COALESCE(?7, '')
              AND config.is_default = 1
              AND config.enabled = 1
              AND (
                  ?8 = 0
                  OR EXISTS (
                      SELECT 1
                      FROM model_secrets tested_secret
                      WHERE tested_secret.provider_profile_id = config.provider_profile_id
                        AND tested_secret.capability_id = ?9
                        AND tested_secret.secret_value = secret.secret_value
                  )
              )
            ",
            params![
                capability_id,
                tested_config.provider_profile_id.as_str(),
                tested_config.execution_mode.as_str(),
                tested_config.model.as_str(),
                provider_profile(&tested_config.provider_profile_id)
                    .map(|profile| profile.base_url)
                    .unwrap_or(""),
                tested_config.base_url.as_str(),
                tested_config.endpoint_path.as_deref(),
                bool_to_i64(requires_secret),
                tested_config.capability_id.as_str(),
            ],
            |row| row.get(0),
        )
        .optional()
        .map_err(ModelConfigError::from)
}

pub fn default_config_for_capability(
    workspace_directory: &Path,
    capability_id: &str,
) -> Result<LocalModelConfigView, ModelConfigError> {
    Ok(default_resolved_config_for_capability(workspace_directory, capability_id)?.view)
}

pub fn default_resolved_config_for_capability(
    workspace_directory: &Path,
    capability_id: &str,
) -> Result<ResolvedModelConfig, ModelConfigError> {
    let database = open_database(workspace_directory)?;
    ensure_mock_default_configs(&database)?;
    let default_config = database
        .connection()
        .query_row(
            config_select_sql(
                "WHERE config.capability_id = ?1 AND config.is_default = 1 AND config.enabled = 1",
            )
            .as_str(),
            params![capability_id],
            resolved_config_from_row,
        )
        .optional()?;

    if let Some(config) = default_config {
        if config.provider_profile_id != "mock-local"
            || !capability_requires_real_provider(capability_id)
        {
            return ensure_resolved_config_supports_capability(config, capability_id);
        }
        if let Some(related_config) =
            available_real_default_config_for_same_category(&database, capability_id)?
        {
            return ensure_resolved_config_supports_capability(related_config, capability_id);
        }
        return ensure_resolved_config_supports_capability(config, capability_id);
    }

    if capability_requires_real_provider(capability_id) {
        let config = available_real_default_config_for_same_category(&database, capability_id)?
            .ok_or_else(|| ModelConfigError::NotFound(capability_id.to_string()))?;
        return ensure_resolved_config_supports_capability(config, capability_id);
    }

    Err(ModelConfigError::NotFound(capability_id.to_string()))
}

fn ensure_resolved_config_supports_capability(
    config: ResolvedModelConfig,
    capability_id: &str,
) -> Result<ResolvedModelConfig, ModelConfigError> {
    let profile = provider_profile(&config.provider_profile_id).ok_or_else(|| {
        ModelConfigError::Validation("provider_profile_id 不在内置 allowlist 中。".to_string())
    })?;
    ensure_profile_supports_capability(profile, capability_id)?;
    Ok(config)
}

fn available_real_default_config_for_same_category(
    database: &WorkspaceDatabase,
    capability_id: &str,
) -> Result<Option<ResolvedModelConfig>, ModelConfigError> {
    let category = capability_definition(capability_id)
        .ok_or_else(|| ModelConfigError::Validation("不支持的 capabilityId。".to_string()))?
        .category;
    let related_capability_ids = CAPABILITIES
        .iter()
        .filter(|capability| capability.category == category)
        .map(|capability| capability.id)
        .collect::<Vec<_>>();
    let placeholders = std::iter::repeat_n("?", related_capability_ids.len())
        .collect::<Vec<_>>()
        .join(", ");
    let sql = config_select_sql(&format!(
        "WHERE config.capability_id IN ({placeholders})
           AND config.provider_profile_id != 'mock-local'
           AND config.is_default = 1
           AND config.enabled = 1"
    ));
    let mut statement = database.connection().prepare(&sql)?;
    let rows = statement.query_map(rusqlite::params_from_iter(related_capability_ids), |row| {
        resolved_config_from_row(row)
    })?;
    for row in rows {
        let config = row?;
        let profile = provider_profile(&config.provider_profile_id).ok_or_else(|| {
            ModelConfigError::Validation("provider_profile_id 不在内置 allowlist 中。".to_string())
        })?;
        if !profile.supported_capabilities.contains(&capability_id) {
            continue;
        }
        if config.view.connection_status == "available" && config.view.secret_status.configured {
            return Ok(Some(config));
        }
    }
    Ok(None)
}

fn open_database(workspace_directory: &Path) -> Result<WorkspaceDatabase, ModelConfigError> {
    WorkspaceDatabase::open(workspace_directory).map_err(ModelConfigError::from)
}

fn ensure_mock_default_configs(database: &WorkspaceDatabase) -> Result<(), ModelConfigError> {
    for capability in CAPABILITIES {
        database.connection().execute(
            "
            INSERT OR IGNORE INTO model_configs (
                id, capability_id, provider_profile_id, display_name, protocol,
                execution_mode, model, enabled, is_default
            )
            VALUES (?1, ?2, 'mock-local', ?3, 'openai-compatible', 'sync', ?4, 1, 1)
            ",
            params![
                format!("cfg_mock_{}", capability.id.replace('-', "_")),
                capability.id,
                format!("{} Mock", capability.display_name),
                capability.mock_model,
            ],
        )?;
    }
    Ok(())
}

fn list_configs(
    database: &WorkspaceDatabase,
) -> Result<Vec<LocalModelConfigView>, ModelConfigError> {
    let sql = config_select_sql("");
    let mut statement = database.connection().prepare(&sql)?;
    let rows = statement.query_map([], config_from_row)?;
    let mut configs = Vec::new();

    for row in rows {
        configs.push(row?);
    }

    Ok(configs)
}

fn find_config_by_id(
    database: &WorkspaceDatabase,
    config_id: &str,
) -> Result<Option<LocalModelConfigView>, ModelConfigError> {
    database
        .connection()
        .query_row(
            config_select_sql("WHERE config.id = ?1").as_str(),
            params![config_id],
            config_from_row,
        )
        .optional()
        .map_err(ModelConfigError::from)
}

fn current_connection_fingerprint_for_config(
    database: &WorkspaceDatabase,
    config_id: &str,
) -> Result<String, ModelConfigError> {
    database
        .connection()
        .query_row(
            "
            SELECT config.capability_id, config.provider_profile_id, config.execution_mode,
                   config.model, config.base_url, config.endpoint_path, secret.updated_at, secret.version
            FROM model_configs config
            LEFT JOIN model_secrets secret
              ON secret.provider_profile_id = config.provider_profile_id
             AND secret.capability_id = config.capability_id
            WHERE config.id = ?1
            ",
            params![config_id],
            |row| {
                let capability_id: String = row.get(0)?;
                let provider_profile_id: String = row.get(1)?;
                let execution_mode: String = row.get(2)?;
                let model: String = row.get(3)?;
                let base_url: Option<String> = row.get(4)?;
                let endpoint_path: Option<String> = row.get(5)?;
                let secret_updated_at: Option<String> = row.get(6)?;
                let secret_version: Option<i64> = row.get(7)?;
                let fingerprint_base_url = if let Some(profile) = provider_profile(&provider_profile_id)
                {
                    resolve_base_url(profile, base_url.as_deref()).map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(
                            4,
                            rusqlite::types::Type::Text,
                            Box::new(error),
                        )
                    })?
                } else {
                    base_url.unwrap_or_default()
                };
                let fingerprint_endpoint_path = provider_profile(&provider_profile_id)
                    .and_then(|profile| {
                        resolve_endpoint_path_for_config(
                            profile,
                            &capability_id,
                            endpoint_path.as_deref(),
                        )
                    })
                    .or(endpoint_path);

                Ok(connection_fingerprint(
                    &provider_profile_id,
                    Some(fingerprint_base_url.as_str()),
                    &execution_mode,
                    &model,
                    fingerprint_endpoint_path.as_deref(),
                    secret_revision(secret_updated_at.as_deref(), secret_version).as_deref(),
                ))
            },
        )
        .map_err(ModelConfigError::from)
}

fn load_secret_value(
    database: &WorkspaceDatabase,
    provider_profile_id: &str,
    capability_id: &str,
) -> Result<Option<String>, ModelConfigError> {
    database
        .connection()
        .query_row(
            "
            SELECT secret_value
            FROM model_secrets
            WHERE provider_profile_id = ?1 AND capability_id = ?2
            ",
            params![provider_profile_id, capability_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(ModelConfigError::from)
}

fn ensure_related_category_secret(
    database: &WorkspaceDatabase,
    provider_profile_id: &str,
    capability_id: &str,
    category: &str,
) -> Result<(), ModelConfigError> {
    if load_secret_value(database, provider_profile_id, capability_id)?.is_some() {
        return Ok(());
    }

    for related_capability in CAPABILITIES
        .iter()
        .filter(|capability| capability.category == category && capability.id != capability_id)
    {
        let Some(secret_value) =
            load_secret_value(database, provider_profile_id, related_capability.id)?
        else {
            continue;
        };

        database.connection().execute(
            "
            INSERT INTO model_secrets (id, provider_profile_id, capability_id, secret_value, updated_at)
            VALUES (?1, ?2, ?3, ?4, datetime('now'))
            ON CONFLICT(provider_profile_id, capability_id) DO NOTHING
            ",
            params![
                create_secret_id(),
                provider_profile_id,
                capability_id,
                secret_value,
            ],
        )?;
        break;
    }

    Ok(())
}

fn config_select_sql(where_clause: &str) -> String {
    format!(
        "
        SELECT config.id, config.capability_id, config.provider_profile_id,
               config.display_name, config.protocol, config.execution_mode,
               config.model, config.endpoint_path, config.enabled, config.is_default,
               config.connection_status, config.connection_message,
               config.connection_tested_at, config.connection_fingerprint,
               config.updated_at, config.base_url, secret.updated_at, secret.version
        FROM model_configs config
        LEFT JOIN model_secrets secret
          ON secret.provider_profile_id = config.provider_profile_id
         AND secret.capability_id = config.capability_id
        {where_clause}
        ORDER BY config.capability_id ASC, config.is_default DESC, config.created_at ASC
        "
    )
}

fn config_from_row(row: &Row<'_>) -> Result<LocalModelConfigView, rusqlite::Error> {
    let provider_profile_id: String = row.get(2)?;
    let capability_id: String = row.get(1)?;
    let base_url: Option<String> = row.get(15)?;
    let secret_updated_at: Option<String> = row.get(16)?;
    let secret_version: Option<i64> = row.get(17)?;
    let stored_connection_status: String = row.get(10)?;
    let stored_connection_message: Option<String> = row.get(11)?;
    let stored_connection_tested_at: Option<String> = row.get(12)?;
    let stored_connection_fingerprint: Option<String> = row.get(13)?;
    let profile = provider_profile(&provider_profile_id).ok_or_else(|| {
        rusqlite::Error::FromSqlConversionFailure(
            2,
            rusqlite::types::Type::Text,
            Box::new(ModelConfigError::Validation(
                "未知 provider_profile_id".to_string(),
            )),
        )
    })?;
    let execution_mode: String = row.get(5)?;
    let model: String = row.get(6)?;
    let endpoint_path: Option<String> = row.get(7)?;
    let base_url = resolve_base_url(profile, base_url.as_deref()).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(15, rusqlite::types::Type::Text, Box::new(error))
    })?;
    let fingerprint_endpoint_path =
        resolve_endpoint_path_for_config(profile, &capability_id, endpoint_path.as_deref())
            .or(endpoint_path.clone());
    let current_connection_fingerprint = connection_fingerprint(
        &provider_profile_id,
        Some(base_url.as_str()),
        &execution_mode,
        &model,
        fingerprint_endpoint_path.as_deref(),
        secret_revision(secret_updated_at.as_deref(), secret_version).as_deref(),
    );
    let connection_is_current =
        stored_connection_fingerprint.as_deref() == Some(current_connection_fingerprint.as_str());

    Ok(LocalModelConfigView {
        id: row.get(0)?,
        capability_id: capability_id.clone(),
        provider_profile_id: provider_profile_id.clone(),
        display_name: row.get(3)?,
        provider_label: profile.provider_label.to_string(),
        protocol: row.get(4)?,
        execution_mode,
        model,
        base_url,
        endpoint_path,
        secret_status: secret_status_for_profile(
            profile,
            secret_updated_at.map(|last_updated_at| SecretStatus {
                configured: true,
                storage: "sqlite-local".to_string(),
                last_updated_at: Some(last_updated_at),
            }),
            &capability_id,
        ),
        connection_status: if connection_is_current {
            stored_connection_status
        } else if !profile.requires_secret {
            "available".to_string()
        } else {
            "untested".to_string()
        },
        connection_message: if connection_is_current {
            stored_connection_message
        } else {
            None
        },
        connection_tested_at: if connection_is_current {
            stored_connection_tested_at
        } else {
            None
        },
        enabled: row.get::<_, i64>(8)? == 1,
        is_default: row.get::<_, i64>(9)? == 1,
    })
}

fn resolved_config_from_row(row: &Row<'_>) -> Result<ResolvedModelConfig, rusqlite::Error> {
    Ok(ResolvedModelConfig {
        provider_profile_id: row.get(2)?,
        view: config_from_row(row)?,
    })
}

fn default_config_exists(
    database: &WorkspaceDatabase,
    capability_id: &str,
) -> Result<i64, ModelConfigError> {
    database
        .connection()
        .query_row(
            "SELECT COUNT(*) FROM model_configs WHERE capability_id = ?1 AND is_default = 1",
            params![capability_id],
            |row| row.get(0),
        )
        .map_err(ModelConfigError::from)
}

fn clear_default_for_capability(
    database: &WorkspaceDatabase,
    capability_id: &str,
) -> Result<(), ModelConfigError> {
    database.connection().execute(
        "UPDATE model_configs SET is_default = 0, updated_at = datetime('now') WHERE capability_id = ?1",
        params![capability_id],
    )?;
    Ok(())
}

fn validate_config_input(input: &SaveLocalModelConfigInput) -> Result<(), ModelConfigError> {
    if !CAPABILITIES
        .iter()
        .any(|capability| capability.id == input.capability_id)
    {
        return Err(ModelConfigError::Validation(
            "不支持的 capabilityId。".to_string(),
        ));
    }
    if !matches!(
        input.execution_mode.as_str(),
        "sync" | "stream" | "async-task" | "auto"
    ) {
        return Err(ModelConfigError::Validation(
            "不支持的 executionMode。".to_string(),
        ));
    }
    if input.display_name.trim().is_empty() || input.model.trim().is_empty() {
        return Err(ModelConfigError::Validation(
            "模型配置名称和 model 不能为空。".to_string(),
        ));
    }
    Ok(())
}

fn resolve_base_url(
    profile: &ProviderProfile,
    configured_base_url: Option<&str>,
) -> Result<String, ModelConfigError> {
    let base_url = configured_base_url.unwrap_or(profile.base_url).trim();
    if profile.id == "mock-local" {
        if base_url == profile.base_url {
            return Ok(base_url.to_string());
        }
        return Err(ModelConfigError::Validation(
            "Mock Local 的 Base URL 必须为 mock://local。".to_string(),
        ));
    }

    let url = Url::parse(base_url).map_err(|_| {
        ModelConfigError::Validation("Base URL 必须是有效的 https 地址。".to_string())
    })?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(ModelConfigError::Validation(
            "Base URL 必须是无凭据、无查询参数的 https 地址。".to_string(),
        ));
    }

    Ok(base_url.trim_end_matches('/').to_string())
}

fn ensure_profile_supports_capability(
    profile: &ProviderProfile,
    capability_id: &str,
) -> Result<(), ModelConfigError> {
    if profile.supported_capabilities.contains(&capability_id) {
        return Ok(());
    }
    Err(ModelConfigError::Validation(
        "provider profile 不支持该能力。".to_string(),
    ))
}

pub fn provider_profile(provider_profile_id: &str) -> Option<&'static ProviderProfile> {
    PROVIDER_PROFILES
        .iter()
        .find(|profile| profile.id == provider_profile_id)
}

fn capability_definition(capability_id: &str) -> Option<&'static ModelCapabilityDefinition> {
    CAPABILITIES
        .iter()
        .find(|capability| capability.id == capability_id)
}

pub fn image_size_options(provider: &str, model: &str) -> Vec<ImageSizeOption> {
    let values: &[(&str, &str, &str, i64, i64, &str)] = match (provider, model) {
        ("openai", "gpt-image-2" | "gpt-image-1.5" | "gpt-image-1" | "gpt-image-1-mini") => &[
            (
                "1024x1024",
                "正方形 1:1 · 1024x1024",
                "1:1",
                1024,
                1024,
                "1024x1024",
            ),
            (
                "1024x1536",
                "竖图 2:3 · 1024x1536",
                "2:3",
                1024,
                1536,
                "1024x1536",
            ),
            (
                "1536x1024",
                "横图 3:2 · 1536x1024",
                "3:2",
                1536,
                1024,
                "1536x1024",
            ),
        ],
        ("volcengine", VOLCENGINE_SEEDREAM_5_PRO_MODEL) => &[
            (
                "1024x1024",
                "正方形 1:1 · 1024x1024",
                "1:1",
                1024,
                1024,
                "1024x1024",
            ),
            (
                "1152x864",
                "横图 4:3 · 1152x864",
                "4:3",
                1152,
                864,
                "1152x864",
            ),
            (
                "864x1152",
                "竖图 3:4 · 864x1152",
                "3:4",
                864,
                1152,
                "864x1152",
            ),
            (
                "1424x800",
                "横图 16:9 · 1424x800",
                "16:9",
                1424,
                800,
                "1424x800",
            ),
            (
                "800x1424",
                "竖图 9:16 · 800x1424",
                "9:16",
                800,
                1424,
                "800x1424",
            ),
            (
                "1248x832",
                "横图 3:2 · 1248x832",
                "3:2",
                1248,
                832,
                "1248x832",
            ),
            (
                "832x1248",
                "竖图 2:3 · 832x1248",
                "2:3",
                832,
                1248,
                "832x1248",
            ),
            (
                "1568x672",
                "横图 21:9 · 1568x672",
                "21:9",
                1568,
                672,
                "1568x672",
            ),
            (
                "2048x2048",
                "正方形 1:1 · 2048x2048",
                "1:1",
                2048,
                2048,
                "2048x2048",
            ),
            (
                "2368x1776",
                "横图 4:3 · 2368x1776",
                "4:3",
                2368,
                1776,
                "2368x1776",
            ),
            (
                "1776x2368",
                "竖图 3:4 · 1776x2368",
                "3:4",
                1776,
                2368,
                "1776x2368",
            ),
            (
                "2816x1584",
                "横图 16:9 · 2816x1584",
                "16:9",
                2816,
                1584,
                "2816x1584",
            ),
            (
                "1584x2816",
                "竖图 9:16 · 1584x2816",
                "9:16",
                1584,
                2816,
                "1584x2816",
            ),
            (
                "2496x1664",
                "横图 3:2 · 2496x1664",
                "3:2",
                2496,
                1664,
                "2496x1664",
            ),
            (
                "1664x2496",
                "竖图 2:3 · 1664x2496",
                "2:3",
                1664,
                2496,
                "1664x2496",
            ),
            (
                "3136x1344",
                "横图 21:9 · 3136x1344",
                "21:9",
                3136,
                1344,
                "3136x1344",
            ),
        ],
        ("volcengine", "doubao-seedream-5-0-260128" | "doubao-seedream-5-0-lite-260128") => &[
            (
                "2048x2048",
                "正方形 1:1 · 2048x2048",
                "1:1",
                2048,
                2048,
                "2048x2048",
            ),
            (
                "1728x2304",
                "竖图 3:4 · 1728x2304",
                "3:4",
                1728,
                2304,
                "1728x2304",
            ),
            (
                "1440x2560",
                "竖图 9:16 · 1440x2560",
                "9:16",
                1440,
                2560,
                "1440x2560",
            ),
            (
                "2560x1440",
                "横图 16:9 · 2560x1440",
                "16:9",
                2560,
                1440,
                "2560x1440",
            ),
            (
                "4096x4096",
                "正方形 1:1 · 4096x4096",
                "1:1",
                4096,
                4096,
                "4096x4096",
            ),
            (
                "3072x4096",
                "竖图 3:4 · 3072x4096",
                "3:4",
                3072,
                4096,
                "3072x4096",
            ),
            (
                "2304x4096",
                "竖图 9:16 · 2304x4096",
                "9:16",
                2304,
                4096,
                "2304x4096",
            ),
            (
                "4096x2304",
                "横图 16:9 · 4096x2304",
                "16:9",
                4096,
                2304,
                "4096x2304",
            ),
        ],
        ("volcengine", "doubao-seedream-4-5-251128" | "doubao-seedream-4-0-250828") => &[
            (
                "2048x2048",
                "正方形 1:1 · 2048x2048",
                "1:1",
                2048,
                2048,
                "2048x2048",
            ),
            (
                "1536x2048",
                "竖图 3:4 · 1536x2048",
                "3:4",
                1536,
                2048,
                "1536x2048",
            ),
            (
                "1152x2048",
                "竖图 9:16 · 1152x2048",
                "9:16",
                1152,
                2048,
                "1152x2048",
            ),
            (
                "2048x1152",
                "横图 16:9 · 2048x1152",
                "16:9",
                2048,
                1152,
                "2048x1152",
            ),
            (
                "4096x4096",
                "正方形 1:1 · 4096x4096",
                "1:1",
                4096,
                4096,
                "4096x4096",
            ),
            (
                "3072x4096",
                "竖图 3:4 · 3072x4096",
                "3:4",
                3072,
                4096,
                "3072x4096",
            ),
            (
                "2304x4096",
                "竖图 9:16 · 2304x4096",
                "9:16",
                2304,
                4096,
                "2304x4096",
            ),
            (
                "4096x2304",
                "横图 16:9 · 4096x2304",
                "16:9",
                4096,
                2304,
                "4096x2304",
            ),
        ],
        _ => &[],
    };

    values
        .iter()
        .map(
            |(id, label, ratio, width, height, provider_value)| ImageSizeOption {
                id: (*id).to_string(),
                label: (*label).to_string(),
                ratio: (*ratio).to_string(),
                width: *width,
                height: *height,
                provider_value: (*provider_value).to_string(),
            },
        )
        .collect()
}

pub fn validate_image_size(
    provider: &str,
    model: &str,
    value: &str,
) -> Result<(), ModelConfigError> {
    image_size_options(provider, model)
        .iter()
        .any(|option| option.provider_value == value)
        .then_some(())
        .ok_or_else(|| ModelConfigError::Validation("当前模型不支持所选图片尺寸。".to_string()))
}

fn resolve_endpoint_path(
    profile: &ProviderProfile,
    category: &str,
    configured_endpoint_path: Option<&str>,
) -> Option<String> {
    if profile.id == "openai" && category == "text-to-image" {
        return Some("/v1/images/generations".to_string());
    }

    if profile.id == "openai" && category == "image-to-image" {
        return Some("/v1/images/edits".to_string());
    }

    if profile.id == "volcengine" && matches!(category, "text-to-image" | "image-to-image") {
        return Some("/images/generations".to_string());
    }

    if profile.id == "volcengine" && category == "image-to-text" {
        return Some("/responses".to_string());
    }

    configured_endpoint_path
        .map(str::to_string)
        .or_else(|| profile.default_endpoint_path.map(str::to_string))
}

fn resolve_endpoint_path_for_config(
    profile: &ProviderProfile,
    capability_id: &str,
    configured_endpoint_path: Option<&str>,
) -> Option<String> {
    capability_definition(capability_id).and_then(|capability| {
        resolve_endpoint_path(profile, capability.category, configured_endpoint_path)
    })
}

fn profile_to_view(profile: &ProviderProfile) -> ProviderProfileView {
    ProviderProfileView {
        id: profile.id.to_string(),
        display_name: profile.display_name.to_string(),
        provider_label: profile.provider_label.to_string(),
        protocol: profile.protocol.to_string(),
        base_url: profile.base_url.to_string(),
        default_endpoint_path: profile
            .default_endpoint_path
            .map(std::string::ToString::to_string),
        supported_categories: profile
            .supported_categories
            .iter()
            .map(|value| (*value).to_string())
            .collect(),
        supported_capabilities: profile
            .supported_capabilities
            .iter()
            .map(|value| (*value).to_string())
            .collect(),
        custom_enabled: profile.custom_enabled,
    }
}

fn create_config_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    format!("cfg_{nanos}")
}

fn bool_to_i64(value: bool) -> i64 {
    if value {
        1
    } else {
        0
    }
}

fn connection_fingerprint(
    provider_profile_id: &str,
    base_url: Option<&str>,
    execution_mode: &str,
    model: &str,
    endpoint_path: Option<&str>,
    secret_updated_at: Option<&str>,
) -> String {
    // 连接测试只在这些执行参数未变化时继续有效。
    // API Key 明文本身不参与指纹，使用 secret 更新时间避免泄漏。
    format!(
        "{}|{}|{}|{}|{}|{}",
        provider_profile_id,
        base_url.unwrap_or(""),
        execution_mode,
        model,
        endpoint_path.unwrap_or(""),
        secret_updated_at.unwrap_or("")
    )
}

fn secret_revision(secret_updated_at: Option<&str>, secret_version: Option<i64>) -> Option<String> {
    secret_updated_at.map(|updated_at| format!("{}:{}", updated_at, secret_version.unwrap_or(0)))
}

impl From<DatabaseError> for ModelConfigError {
    fn from(source: DatabaseError) -> Self {
        Self::Database(source.to_string())
    }
}

impl From<rusqlite::Error> for ModelConfigError {
    fn from(source: rusqlite::Error) -> Self {
        Self::Database(DatabaseError::from(source).to_string())
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    use crate::infrastructure::filesystem::WorkspaceFileSystem;
    use crate::services::workspace::{InitializeWorkspaceInput, WorkspaceService};

    use super::{
        capability_requires_real_provider, image_size_options, validate_image_size,
        ModelConfigService, SaveLocalModelConfigInput, SetDefaultModelConfigInput,
    };

    fn label_has_expected_direction(width: i64, height: i64, label: &str) -> bool {
        match width.cmp(&height) {
            std::cmp::Ordering::Equal => label.contains("正方形"),
            std::cmp::Ordering::Less => label.contains("竖图"),
            std::cmp::Ordering::Greater => label.contains("横图"),
        }
    }

    #[test]
    fn image_edit_requires_a_real_provider() {
        assert!(capability_requires_real_provider("image-edit"));
    }

    #[test]
    fn resolves_openai_sizes_with_unique_exact_ids_and_pixel_labels() {
        let options = image_size_options("openai", "gpt-image-1");

        assert_eq!(
            options
                .iter()
                .map(|option| option.provider_value.as_str())
                .collect::<Vec<_>>(),
            vec!["1024x1024", "1024x1536", "1536x1024"]
        );
        assert_eq!(
            options
                .iter()
                .map(|option| option.id.as_str())
                .collect::<HashSet<_>>()
                .len(),
            options.len()
        );
        assert!(options.iter().all(|option| {
            option.id == option.provider_value
                && option.label.contains(&option.ratio)
                && option.label.contains(&option.provider_value)
                && label_has_expected_direction(option.width, option.height, &option.label)
        }));
    }

    #[test]
    fn resolves_seedream_5_models_with_official_2k_and_4k_sizes() {
        let models = [
            "doubao-seedream-5-0-260128",
            "doubao-seedream-5-0-lite-260128",
        ];
        let expected_values = [
            "2048x2048",
            "1728x2304",
            "1440x2560",
            "2560x1440",
            "4096x4096",
            "3072x4096",
            "2304x4096",
            "4096x2304",
        ];

        for model in models {
            let options = image_size_options("volcengine", model);
            let ids = options
                .iter()
                .map(|option| option.id.as_str())
                .collect::<HashSet<_>>();

            assert_eq!(options.len(), expected_values.len(), "model={model}");
            assert_eq!(ids.len(), options.len(), "model={model}");
            assert_eq!(
                options
                    .iter()
                    .map(|option| option.provider_value.as_str())
                    .collect::<Vec<_>>(),
                expected_values,
                "model={model}"
            );
            assert!(options.iter().all(|option| {
                option.id == option.provider_value
                    && option.label.contains(&option.ratio)
                    && option.label.contains(&option.provider_value)
                    && label_has_expected_direction(option.width, option.height, &option.label)
            }));
        }
    }

    #[test]
    fn keeps_seedream_4_models_on_their_registered_2k_and_4k_sizes() {
        let models = ["doubao-seedream-4-5-251128", "doubao-seedream-4-0-250828"];
        let expected_values = [
            "2048x2048",
            "1536x2048",
            "1152x2048",
            "2048x1152",
            "4096x4096",
            "3072x4096",
            "2304x4096",
            "4096x2304",
        ];

        for model in models {
            let options = image_size_options("volcengine", model);
            assert_eq!(
                options
                    .iter()
                    .map(|option| option.provider_value.as_str())
                    .collect::<Vec<_>>(),
                expected_values,
                "model={model}"
            );
        }
    }

    #[test]
    fn resolves_seedream_5_pro_with_only_official_1k_and_2k_sizes() {
        let options = image_size_options("volcengine", "doubao-seedream-5-0-pro-260628");
        let expected_values = [
            "1024x1024",
            "1152x864",
            "864x1152",
            "1424x800",
            "800x1424",
            "1248x832",
            "832x1248",
            "1568x672",
            "2048x2048",
            "2368x1776",
            "1776x2368",
            "2816x1584",
            "1584x2816",
            "2496x1664",
            "1664x2496",
            "3136x1344",
        ];
        let ids = options
            .iter()
            .map(|option| option.id.as_str())
            .collect::<HashSet<_>>();

        assert_eq!(options.len(), expected_values.len());
        assert_eq!(ids.len(), options.len());
        assert_eq!(
            options
                .iter()
                .map(|option| option.provider_value.as_str())
                .collect::<Vec<_>>(),
            expected_values
        );
        assert!(options.iter().all(|option| {
            option.id == option.provider_value
                && option.label.contains(&option.ratio)
                && option.label.contains(&option.provider_value)
                && label_has_expected_direction(option.width, option.height, &option.label)
        }));
    }

    #[test]
    fn returns_no_sizes_for_unknown_provider_or_model() {
        assert!(image_size_options("unknown-provider", "gpt-image-1").is_empty());
        assert!(image_size_options("openai", "unknown-model").is_empty());
        assert!(image_size_options("volcengine", "unknown-model").is_empty());
    }

    #[test]
    fn lists_image_sizes_from_the_capability_default_config() {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time before epoch")
            .as_nanos();
        let workspace_directory =
            std::env::temp_dir().join(format!("commerce-shoot-studio-image-sizes-{nanos}"));
        WorkspaceService::new(WorkspaceFileSystem::new())
            .initialize_workspace(InitializeWorkspaceInput {
                workspace_directory: workspace_directory.clone(),
            })
            .expect("workspace should initialize");
        let service = ModelConfigService::new();
        let config = service
            .save_config(
                &workspace_directory,
                SaveLocalModelConfigInput {
                    id: Some("cfg-image-edit-openai".to_string()),
                    capability_id: "image-edit".to_string(),
                    provider_profile_id: "openai".to_string(),
                    display_name: "OpenAI 图片编辑".to_string(),
                    execution_mode: "sync".to_string(),
                    model: "gpt-image-1".to_string(),
                    base_url: None,
                    endpoint_path: None,
                    enabled: true,
                },
            )
            .expect("image-edit config should save");
        service
            .set_default_config(
                &workspace_directory,
                SetDefaultModelConfigInput {
                    capability_id: "image-edit".to_string(),
                    config_id: config.id.clone(),
                },
            )
            .expect("image-edit config should become default");

        let result = service
            .list_image_size_options(&workspace_directory, "image-edit")
            .expect("default image-edit sizes should list");

        assert_eq!(result.capability_id, "image-edit");
        assert_eq!(result.config_id, config.id);
        assert_eq!(result.provider_profile_id, "openai");
        assert_eq!(result.model, "gpt-image-1");
        assert_eq!(
            result
                .options
                .iter()
                .map(|option| option.provider_value.as_str())
                .collect::<Vec<_>>(),
            vec!["1024x1024", "1024x1536", "1536x1024"]
        );

        fs::remove_dir_all(workspace_directory).expect("temporary workspace should clean up");
    }

    #[test]
    fn rejects_image_size_not_registered_for_model() {
        let error = validate_image_size("openai", "gpt-image-1", "1152x2048")
            .expect_err("OpenAI 模型不应接受火山引擎尺寸值");

        assert_eq!(error.to_string(), "当前模型不支持所选图片尺寸。");
        assert!(
            validate_image_size("volcengine", "doubao-seedream-4-0-250828", "2304x4096").is_ok()
        );
    }
}
