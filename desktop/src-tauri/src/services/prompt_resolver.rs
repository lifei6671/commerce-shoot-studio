use std::collections::{BTreeMap, BTreeSet};

use serde_json::Value;
use sqlx::Row;
use ulid::Ulid;

use crate::domain::prompt::{
    PromptBinding, PromptBindingSection, PromptMode, ResolvePromptInput, ResolvedPrompt,
    SavePromptBindingRequest,
};
use crate::error::{AppError, AppResult};
use crate::storage::sqlite::WorkspaceDatabase;

pub struct PromptResolver;

const RESOLVER_VERSION: &str = "prompt-resolver-v1";

impl PromptResolver {
    pub fn resolve(input: ResolvePromptInput) -> AppResult<ResolvedPrompt> {
        let declarations = parse_declarations(&input.declarations_json)?;
        let system_body = compose_section_body(input.system_template.as_deref(), &input.binding.system);
        let user_body = compose_section_body(input.user_template.as_deref(), &input.binding.user);
        let negative_body = input
            .binding
            .negative
            .as_ref()
            .map(|section| compose_section_body(input.negative_template.as_deref(), section));
        let prompt_placeholders = collect_prompt_placeholders([
            system_body.as_str(),
            user_body.as_str(),
            negative_body.as_deref().unwrap_or_default(),
        ]);
        let warnings = unused_required_variable_warnings(&declarations, &prompt_placeholders);

        let system = resolve_optional_body(
            &system_body,
            input.system_template.as_deref(),
            &input.binding.variables_json,
            &declarations,
        )?;
        let user = resolve_required_body(
            &user_body,
            input.user_template.as_deref(),
            &input.binding.variables_json,
            &declarations,
        )?;
        let negative = match negative_body {
            Some(body) => {
                resolve_optional_body(
                    &body,
                    input.negative_template.as_deref(),
                    &input.binding.variables_json,
                    &declarations,
                )?
                .filter(|value| !value.is_empty())
            }
            None => None,
        };

        Ok(ResolvedPrompt {
            revision: input.revision,
            system,
            user,
            negative,
            warnings,
            resolver_version: RESOLVER_VERSION.to_string(),
        })
    }
}

pub async fn save_prompt_binding_request(
    database: &WorkspaceDatabase,
    request: SavePromptBindingRequest,
) -> AppResult<PromptBinding> {
    ensure_combination_exists(database, &request.combination_id).await?;
    validate_template_reference(database, request.system.base_template_id.as_deref()).await?;
    validate_template_reference(database, request.user.base_template_id.as_deref()).await?;
    if let Some(negative) = &request.negative {
        validate_template_reference(database, negative.base_template_id.as_deref()).await?;
    }

    let id = request
        .id
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| format!("prompt_binding_{}", Ulid::new()));
    let negative = request.negative.clone().unwrap_or_else(empty_negative_section);

    let mut writer = database.writer().await;
    sqlx::query(
        "INSERT INTO prompt_bindings (
            id,
            combination_id,
            template_id,
            mode,
            append_text,
            override_text,
            system_mode,
            system_base_template_id,
            system_append_text,
            system_override_text,
            user_mode,
            user_base_template_id,
            user_append_text,
            user_override_text,
            negative_mode,
            negative_base_template_id,
            negative_append_text,
            negative_override_text,
            variables_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(combination_id) DO UPDATE SET
            template_id = excluded.template_id,
            mode = excluded.mode,
            append_text = excluded.append_text,
            override_text = excluded.override_text,
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
            updated_at = datetime('now')",
    )
    .bind(&id)
    .bind(&request.combination_id)
    .bind(&request.user.base_template_id)
    .bind(request.user.mode.as_str())
    .bind(&request.user.append_text)
    .bind(&request.user.override_text)
    .bind(request.system.mode.as_str())
    .bind(&request.system.base_template_id)
    .bind(&request.system.append_text)
    .bind(&request.system.override_text)
    .bind(request.user.mode.as_str())
    .bind(&request.user.base_template_id)
    .bind(&request.user.append_text)
    .bind(&request.user.override_text)
    .bind(negative.mode.as_str())
    .bind(&negative.base_template_id)
    .bind(&negative.append_text)
    .bind(&negative.override_text)
    .bind(request.variables_json.to_string())
    .execute(&mut *writer)
    .await?;
    drop(writer);

    get_prompt_binding_for_combination(database, &request.combination_id)
        .await?
        .ok_or_else(|| AppError::InvalidInput("saved prompt binding was not found".to_string()))
}

pub async fn preview_resolved_prompt_for_combination(
    database: &WorkspaceDatabase,
    combination_id: &str,
    draft_prompt_binding: Option<SavePromptBindingRequest>,
    revision: Option<u64>,
) -> AppResult<ResolvedPrompt> {
    let binding = match draft_prompt_binding {
        Some(binding) => binding,
        None => get_prompt_binding_for_combination(database, combination_id)
            .await?
            .ok_or_else(|| AppError::InvalidInput("prompt binding was not found".to_string()))?
            .into_save_request(),
    };

    let system_template = load_template_body(database, binding.system.base_template_id.as_deref()).await?;
    let user_template = load_template_body(database, binding.user.base_template_id.as_deref()).await?;
    let negative_template = match &binding.negative {
        Some(section) => load_template_body(database, section.base_template_id.as_deref()).await?,
        None => None,
    };
    let declarations_json = load_declarations_for_binding(database, &binding).await?;

    PromptResolver::resolve(ResolvePromptInput {
        system_template,
        user_template,
        negative_template,
        binding,
        declarations_json,
        revision,
    })
}

pub async fn get_prompt_binding_save_request_for_combination(
    database: &WorkspaceDatabase,
    combination_id: &str,
) -> AppResult<Option<SavePromptBindingRequest>> {
    Ok(get_prompt_binding_for_combination(database, combination_id)
        .await?
        .map(PromptBinding::into_save_request))
}

async fn get_prompt_binding_for_combination(
    database: &WorkspaceDatabase,
    combination_id: &str,
) -> AppResult<Option<PromptBinding>> {
    let row = sqlx::query(
        "SELECT
            id,
            combination_id,
            system_mode,
            system_base_template_id,
            system_append_text,
            system_override_text,
            user_mode,
            user_base_template_id,
            user_append_text,
            user_override_text,
            negative_mode,
            negative_base_template_id,
            negative_append_text,
            negative_override_text,
            variables_json,
            created_at,
            updated_at
         FROM prompt_bindings
         WHERE combination_id = ?",
    )
    .bind(combination_id)
    .fetch_optional(database.pool())
    .await?;

    row.map(row_to_prompt_binding).transpose()
}

async fn ensure_combination_exists(
    database: &WorkspaceDatabase,
    combination_id: &str,
) -> AppResult<()> {
    let exists: Option<String> = sqlx::query_scalar("SELECT id FROM image_combinations WHERE id = ?")
        .bind(combination_id)
        .fetch_optional(database.pool())
        .await?;
    if exists.is_none() {
        return Err(AppError::InvalidInput(format!(
            "combination {combination_id} was not found"
        )));
    }
    Ok(())
}

async fn validate_template_reference(
    database: &WorkspaceDatabase,
    template_id: Option<&str>,
) -> AppResult<()> {
    let Some(template_id) = template_id else {
        return Ok(());
    };
    let exists: Option<String> = sqlx::query_scalar("SELECT id FROM prompt_templates WHERE id = ?")
        .bind(template_id)
        .fetch_optional(database.pool())
        .await?;
    if exists.is_none() {
        return Err(AppError::InvalidInput(format!(
            "prompt template {template_id} was not found"
        )));
    }
    Ok(())
}

async fn load_template_body(
    database: &WorkspaceDatabase,
    template_id: Option<&str>,
) -> AppResult<Option<String>> {
    let Some(template_id) = template_id else {
        return Ok(None);
    };
    let body = sqlx::query_scalar("SELECT body FROM prompt_templates WHERE id = ?")
        .bind(template_id)
        .fetch_optional(database.pool())
        .await?;
    Ok(body)
}

async fn load_declarations_for_binding(
    database: &WorkspaceDatabase,
    binding: &SavePromptBindingRequest,
) -> AppResult<Value> {
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
            let value: Value = serde_json::from_str(&declarations).map_err(|err| {
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
    Ok(Value::Object(merged))
}

fn resolve_required_body(
    body: &str,
    template: Option<&str>,
    variables_json: &Value,
    declarations: &BTreeMap<String, VariableDeclaration>,
) -> AppResult<String> {
    let resolved = resolve_optional_body(body, template, variables_json, declarations)?
        .unwrap_or_default();
    if resolved.is_empty() {
        return Err(AppError::InvalidInput("resolved user prompt is empty".to_string()));
    }
    Ok(resolved)
}

fn resolve_optional_body(
    body: &str,
    template: Option<&str>,
    variables_json: &Value,
    declarations: &BTreeMap<String, VariableDeclaration>,
) -> AppResult<Option<String>> {
    let _ = template;
    let resolved = render_template(body, variables_json, declarations)?;
    let trimmed = resolved.trim().to_string();
    Ok((!trimmed.is_empty()).then_some(trimmed))
}

fn compose_section_body(template: Option<&str>, section: &PromptBindingSection) -> String {
    let base = template.unwrap_or_default();
    match section.mode {
        PromptMode::Default => base.to_string(),
        PromptMode::Append => {
            let append_text = section.append_text.trim();
            if base.trim().is_empty() {
                append_text.to_string()
            } else if append_text.is_empty() {
                base.to_string()
            } else {
                format!("{}\n\n{}", base.trim(), append_text)
            }
        }
        PromptMode::Override => section.override_text.clone(),
    }
}

fn render_template(
    template: &str,
    variables_json: &Value,
    declarations: &BTreeMap<String, VariableDeclaration>,
) -> AppResult<String> {
    let placeholders = extract_placeholders(template);
    for placeholder in &placeholders {
        if !declarations.contains_key(placeholder) {
            return Err(AppError::PromptTemplateInvalid(format!(
                "variable {placeholder} is used but not declared"
            )));
        }
    }

    let mut output = template.to_string();
    for placeholder in placeholders {
        let declaration = declarations.get(&placeholder).ok_or_else(|| {
            AppError::PromptTemplateInvalid(format!(
                "variable {placeholder} is used but not declared"
            ))
        })?;
        let value = variable_value(variables_json, &placeholder)
            .or_else(|| declaration.default_value.clone())
            .unwrap_or_default();
        if declaration.required && value.trim().is_empty() {
            return Err(AppError::PromptRequiredVariableMissing(placeholder));
        }
        output = output.replace(&format!("{{{{{placeholder}}}}}"), &value);
    }

    Ok(output.trim().to_string())
}

fn collect_prompt_placeholders<'a>(bodies: impl IntoIterator<Item = &'a str>) -> BTreeSet<String> {
    let mut placeholders = BTreeSet::new();
    for body in bodies {
        placeholders.extend(extract_placeholders(body));
    }
    placeholders
}

fn unused_required_variable_warnings(
    declarations: &BTreeMap<String, VariableDeclaration>,
    placeholders: &BTreeSet<String>,
) -> Vec<String> {
    declarations
        .iter()
        .filter_map(|(name, declaration)| {
            (declaration.required && !placeholders.contains(name))
                .then(|| format!("required variable {name} is declared but not used"))
        })
        .collect()
}

fn extract_placeholders(template: &str) -> BTreeSet<String> {
    let mut placeholders = BTreeSet::new();
    let mut rest = template;
    while let Some(start) = rest.find("{{") {
        let after_start = &rest[start + 2..];
        let Some(end) = after_start.find("}}") else {
            break;
        };
        let name = after_start[..end].trim();
        if !name.is_empty() {
            placeholders.insert(name.to_string());
        }
        rest = &after_start[end + 2..];
    }
    placeholders
}

fn parse_declarations(value: &Value) -> AppResult<BTreeMap<String, VariableDeclaration>> {
    let object = value.as_object().ok_or_else(|| {
        AppError::PromptTemplateInvalid("variables_json must be an object".to_string())
    })?;

    let mut declarations = BTreeMap::new();
    for (name, declaration) in object {
        let required = declaration
            .get("required")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let default_value = declaration
            .get("defaultValue")
            .or_else(|| declaration.get("default_value"))
            .and_then(value_to_string);
        declarations.insert(
            name.clone(),
            VariableDeclaration {
                required,
                default_value,
            },
        );
    }
    Ok(declarations)
}

fn variable_value(variables_json: &Value, name: &str) -> Option<String> {
    let value = variables_json.get(name)?;
    value_to_string(value)
}

fn value_to_string(value: &Value) -> Option<String> {
    match value {
        Value::String(value) => Some(value.clone()),
        Value::Number(value) => Some(value.to_string()),
        Value::Bool(value) => Some(value.to_string()),
        Value::Object(object) => object.get("value").and_then(value_to_string),
        _ => None,
    }
}

fn row_to_prompt_binding(row: sqlx::sqlite::SqliteRow) -> AppResult<PromptBinding> {
    let negative_mode: Option<String> = row.get("negative_mode");
    let negative = negative_mode
        .as_deref()
        .and_then(PromptMode::from_db)
        .map(|mode| PromptBindingSection {
            mode,
            base_template_id: row.get("negative_base_template_id"),
            append_text: row.get("negative_append_text"),
            override_text: row.get("negative_override_text"),
        });

    Ok(PromptBinding {
        id: row.get("id"),
        combination_id: row.get("combination_id"),
        system: PromptBindingSection {
            mode: PromptMode::from_db(row.get::<String, _>("system_mode").as_str())
                .ok_or_else(|| AppError::InvalidInput("invalid system prompt mode".to_string()))?,
            base_template_id: row.get("system_base_template_id"),
            append_text: row.get("system_append_text"),
            override_text: row.get("system_override_text"),
        },
        user: PromptBindingSection {
            mode: PromptMode::from_db(row.get::<String, _>("user_mode").as_str())
                .ok_or_else(|| AppError::InvalidInput("invalid user prompt mode".to_string()))?,
            base_template_id: row.get("user_base_template_id"),
            append_text: row.get("user_append_text"),
            override_text: row.get("user_override_text"),
        },
        negative,
        variables_json: serde_json::from_str(row.get::<String, _>("variables_json").as_str())
            .map_err(|err| AppError::InvalidInput(format!("variables_json is invalid: {err}")))?,
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    })
}

fn empty_negative_section() -> PromptBindingSection {
    PromptBindingSection {
        mode: PromptMode::Default,
        base_template_id: None,
        append_text: String::new(),
        override_text: String::new(),
    }
}

#[derive(Debug, Clone)]
struct VariableDeclaration {
    required: bool,
    default_value: Option<String>,
}

impl PromptBinding {
    fn into_save_request(self) -> SavePromptBindingRequest {
        SavePromptBindingRequest {
            id: Some(self.id),
            combination_id: self.combination_id,
            system: self.system,
            user: self.user,
            negative: self.negative,
            variables_json: self.variables_json,
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::storage::file_store::WorkspacePaths;
    use crate::storage::migrations::run_workspace_migrations;

    #[test]
    fn resolver_supports_default_append_and_override_modes() {
        let resolved = PromptResolver::resolve(ResolvePromptInput {
            system_template: Some("system {{tone}}".to_string()),
            user_template: Some("wear {{garment}}".to_string()),
            negative_template: Some("blur".to_string()),
            binding: SavePromptBindingRequest {
                id: None,
                combination_id: "combination_1".to_string(),
                system: PromptBindingSection {
                    mode: PromptMode::Default,
                    base_template_id: None,
                    append_text: "".to_string(),
                    override_text: "".to_string(),
                },
                user: PromptBindingSection {
                    mode: PromptMode::Append,
                    base_template_id: None,
                    append_text: "studio lighting".to_string(),
                    override_text: "".to_string(),
                },
                negative: Some(PromptBindingSection {
                    mode: PromptMode::Override,
                    base_template_id: None,
                    append_text: "".to_string(),
                    override_text: "low quality".to_string(),
                }),
                variables_json: json!({
                    "tone": "premium",
                    "garment": "linen dress"
                }),
            },
            declarations_json: json!({
                "tone": {"required": true},
                "garment": {"required": true}
            }),
            revision: Some(7),
        })
        .expect("resolve prompt");

        assert_eq!(resolved.revision, Some(7));
        assert_eq!(resolved.system.as_deref(), Some("system premium"));
        assert_eq!(resolved.user, "wear linen dress\n\nstudio lighting");
        assert_eq!(resolved.negative.as_deref(), Some("low quality"));
        assert!(resolved.warnings.is_empty());
    }

    #[test]
    fn resolver_rejects_template_placeholders_not_declared_in_variables_json() {
        let result = PromptResolver::resolve(ResolvePromptInput {
            system_template: None,
            user_template: Some("wear {{garment}} in {{scene}}".to_string()),
            negative_template: None,
            binding: SavePromptBindingRequest::minimal_for_test(
                "combination_1",
                PromptMode::Default,
                json!({"garment": "linen dress"}),
            ),
            declarations_json: json!({
                "garment": {"required": true}
            }),
            revision: None,
        });

        assert!(matches!(result, Err(AppError::PromptTemplateInvalid(_))));
    }

    #[test]
    fn resolver_rejects_missing_required_variable_without_default_value() {
        let result = PromptResolver::resolve(ResolvePromptInput {
            system_template: None,
            user_template: Some("wear {{garment}}".to_string()),
            negative_template: None,
            binding: SavePromptBindingRequest::minimal_for_test(
                "combination_1",
                PromptMode::Default,
                json!({}),
            ),
            declarations_json: json!({
                "garment": {"required": true}
            }),
            revision: None,
        });

        assert!(matches!(
            result,
            Err(AppError::PromptRequiredVariableMissing(_))
        ));
    }

    #[test]
    fn resolver_warns_when_required_variable_is_declared_but_unused() {
        let resolved = PromptResolver::resolve(ResolvePromptInput {
            system_template: None,
            user_template: Some("plain product photo".to_string()),
            negative_template: None,
            binding: SavePromptBindingRequest::minimal_for_test(
                "combination_1",
                PromptMode::Default,
                json!({"garment": "linen dress"}),
            ),
            declarations_json: json!({
                "garment": {"required": true}
            }),
            revision: None,
        })
        .expect("resolve prompt");

        assert_eq!(
            resolved.warnings,
            vec!["required variable garment is declared but not used"]
        );
    }

    #[tokio::test]
    async fn save_and_preview_prompt_binding_uses_database_templates_and_resolver() {
        let (_temp_dir, database) = test_database().await;
        seed_combination_and_template(&database).await;

        let binding = save_prompt_binding_request(
            &database,
            SavePromptBindingRequest {
                id: None,
                combination_id: "combination_1".to_string(),
                system: PromptBindingSection::default_with_template("template_system"),
                user: PromptBindingSection {
                    mode: PromptMode::Append,
                    base_template_id: Some("template_user".to_string()),
                    append_text: "soft shadows".to_string(),
                    override_text: "".to_string(),
                },
                negative: None,
                variables_json: json!({
                    "garment": "linen dress",
                    "tone": "premium"
                }),
            },
        )
        .await
        .expect("save binding");

        let preview =
            preview_resolved_prompt_for_combination(&database, "combination_1", None, Some(9))
                .await
                .expect("preview");

        assert_eq!(binding.combination_id, "combination_1");
        assert_eq!(preview.revision, Some(9));
        assert_eq!(preview.system.as_deref(), Some("system premium"));
        assert_eq!(preview.user, "wear linen dress\n\nsoft shadows");
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

    async fn seed_combination_and_template(database: &WorkspaceDatabase) {
        let mut writer = database.writer().await;
        sqlx::query(
            "INSERT INTO assets (
                id, asset_type, original_name, relative_path, thumb_relative_path,
                mime_type, sha256, width, height
            ) VALUES
              ('person_1', 'person', 'person.png', 'assets/person/person_1.png', 'assets/cache/thumbs/person_1.jpg', 'image/png', 'p1', 10, 10)",
        )
        .execute(&mut *writer)
        .await
        .expect("seed person");
        sqlx::query(
            "INSERT INTO image_combinations (id, name, person_asset_id)
             VALUES ('combination_1', 'look', 'person_1')",
        )
        .execute(&mut *writer)
        .await
        .expect("seed combination");
        sqlx::query(
            "INSERT INTO prompt_templates (id, name, body, variables_json)
             VALUES
             ('template_system', 'System', 'system {{tone}}', '{\"tone\":{\"required\":true}}'),
             ('template_user', 'User', 'wear {{garment}}', '{\"garment\":{\"required\":true}}')",
        )
        .execute(&mut *writer)
        .await
        .expect("seed templates");
    }
}
