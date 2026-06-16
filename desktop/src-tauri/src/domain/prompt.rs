use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PromptTemplateType {
    System,
    User,
    Negative,
}

impl PromptTemplateType {
    pub fn as_str(&self) -> &'static str {
        match self {
            PromptTemplateType::System => "system",
            PromptTemplateType::User => "user",
            PromptTemplateType::Negative => "negative",
        }
    }

    pub fn from_db(value: &str) -> Self {
        match value {
            "user" => PromptTemplateType::User,
            "negative" => PromptTemplateType::Negative,
            _ => PromptTemplateType::System,
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PromptTemplateSource {
    BuiltIn,
    Custom,
}

impl PromptTemplateSource {
    pub fn as_str(&self) -> &'static str {
        match self {
            PromptTemplateSource::BuiltIn => "built_in",
            PromptTemplateSource::Custom => "custom",
        }
    }

    pub fn from_db(value: &str) -> Self {
        match value {
            "custom" => PromptTemplateSource::Custom,
            _ => PromptTemplateSource::BuiltIn,
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptTemplateVariable {
    pub name: String,
    #[serde(default)]
    pub display_name: Option<String>,
    pub description: String,
    pub example_value: String,
    pub required: bool,
    pub default_value: Option<String>,
    #[serde(default)]
    pub control_type: PromptVariableControlType,
    #[serde(default)]
    pub options: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum PromptVariableControlType {
    #[default]
    Input,
    Select,
    Combobox,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavePromptTemplateRequest {
    pub id: Option<String>,
    pub name: String,
    pub template_type: PromptTemplateType,
    pub body: String,
    pub variables: Vec<PromptTemplateVariable>,
    pub description: String,
    pub tags: Vec<String>,
    pub is_default: bool,
    pub locked: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptTemplate {
    pub id: String,
    pub name: String,
    pub template_type: PromptTemplateType,
    pub source: PromptTemplateSource,
    pub body: String,
    pub variables: Vec<PromptTemplateVariable>,
    pub description: String,
    pub tags: Vec<String>,
    pub is_default: bool,
    pub locked: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PromptMode {
    Default,
    Append,
    Override,
}

impl PromptMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            PromptMode::Default => "default",
            PromptMode::Append => "append",
            PromptMode::Override => "override",
        }
    }

    pub fn from_db(value: &str) -> Option<Self> {
        match value {
            "default" => Some(PromptMode::Default),
            "append" => Some(PromptMode::Append),
            "override" => Some(PromptMode::Override),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptBindingSection {
    pub mode: PromptMode,
    pub base_template_id: Option<String>,
    pub append_text: String,
    pub override_text: String,
}

impl PromptBindingSection {
    pub fn default_with_template(template_id: &str) -> Self {
        Self {
            mode: PromptMode::Default,
            base_template_id: Some(template_id.to_string()),
            append_text: String::new(),
            override_text: String::new(),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavePromptBindingRequest {
    pub id: Option<String>,
    pub combination_id: String,
    pub system: PromptBindingSection,
    pub user: PromptBindingSection,
    pub negative: Option<PromptBindingSection>,
    pub variables_json: Value,
}

impl SavePromptBindingRequest {
    #[cfg(test)]
    pub fn minimal_for_test(combination_id: &str, mode: PromptMode, variables_json: Value) -> Self {
        Self {
            id: None,
            combination_id: combination_id.to_string(),
            system: PromptBindingSection {
                mode: PromptMode::Default,
                base_template_id: None,
                append_text: String::new(),
                override_text: String::new(),
            },
            user: PromptBindingSection {
                mode,
                base_template_id: None,
                append_text: String::new(),
                override_text: String::new(),
            },
            negative: None,
            variables_json,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptBinding {
    pub id: String,
    pub combination_id: String,
    pub system: PromptBindingSection,
    pub user: PromptBindingSection,
    pub negative: Option<PromptBindingSection>,
    pub variables_json: Value,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavePromptPresetRequest {
    pub id: Option<String>,
    pub name: String,
    pub scenario: String,
    pub description: String,
    pub system: PromptBindingSection,
    pub user: PromptBindingSection,
    pub negative: Option<PromptBindingSection>,
    pub variables: Vec<PromptTemplateVariable>,
    pub is_default: bool,
    pub locked: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptPreset {
    pub id: String,
    pub name: String,
    pub scenario: String,
    pub description: String,
    pub source: PromptTemplateSource,
    pub system: PromptBindingSection,
    pub user: PromptBindingSection,
    pub negative: Option<PromptBindingSection>,
    pub variables: Vec<PromptTemplateVariable>,
    pub is_default: bool,
    pub locked: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavePromptPresetScenarioRequest {
    pub id: Option<String>,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptPresetScenario {
    pub id: String,
    pub name: String,
    pub source: PromptTemplateSource,
    pub sort_order: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct ResolvePromptInput {
    pub system_template: Option<String>,
    pub user_template: Option<String>,
    pub negative_template: Option<String>,
    pub binding: SavePromptBindingRequest,
    pub declarations_json: Value,
    pub revision: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedPrompt {
    pub revision: Option<u64>,
    pub system: Option<String>,
    pub user: String,
    pub negative: Option<String>,
    pub warnings: Vec<String>,
    pub resolver_version: String,
}
