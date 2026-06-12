use serde::{Deserialize, Serialize};
use serde_json::Value;

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
    pub fn minimal_for_test(
        combination_id: &str,
        mode: PromptMode,
        variables_json: Value,
    ) -> Self {
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
