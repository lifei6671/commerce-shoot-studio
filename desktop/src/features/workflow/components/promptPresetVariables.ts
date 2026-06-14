import type {
  PromptBindingSection,
  PromptTemplate,
  PromptTemplateVariable,
} from "../../prompt/model/promptTypes";

export function buildPromptPresetVariablesForSections({
  fallbackVariables = [],
  sections,
  templates,
  existingVariables,
}: {
  fallbackVariables?: PromptTemplateVariable[];
  sections: Array<PromptBindingSection | null | undefined>;
  templates: PromptTemplate[];
  existingVariables: PromptTemplateVariable[];
}): PromptTemplateVariable[] {
  const templatesById = new Map(templates.map((template) => [template.id, template]));
  const existingByName = new Map(existingVariables.map((variable) => [variable.name, variable]));
  const seenNames = new Set<string>();
  const variables: PromptTemplateVariable[] = [];

  for (const section of sections) {
    if (!section?.baseTemplateId) {
      continue;
    }
    const template = templatesById.get(section.baseTemplateId);
    if (!template) {
      continue;
    }
    for (const variable of template.variables) {
      if (seenNames.has(variable.name)) {
        continue;
      }
      seenNames.add(variable.name);
      const existingVariable = existingByName.get(variable.name);
      variables.push({
        ...variable,
        defaultValue:
          existingVariable?.defaultValue ?? variable.defaultValue ?? variable.exampleValue,
      });
    }
  }

  for (const variable of fallbackVariables) {
    if (seenNames.has(variable.name)) {
      continue;
    }
    seenNames.add(variable.name);
    const existingVariable = existingByName.get(variable.name);
    variables.push({
      ...variable,
      defaultValue:
        existingVariable?.defaultValue ?? variable.defaultValue ?? variable.exampleValue,
    });
  }

  return variables;
}
