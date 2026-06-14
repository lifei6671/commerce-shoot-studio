import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildWorkbenchAutoSavePlan,
  buildWorkbenchAutoSaveSignature,
} from "../src/features/workflow/components/workbenchAutoSave.ts";

const promptBinding = {
  combinationId: "combo-1",
  system: {
    mode: "default",
    baseTemplateId: "system-a",
    appendText: "",
    overrideText: "",
  },
  user: {
    mode: "append",
    baseTemplateId: "user-a",
    appendText: "追加描述",
    overrideText: "",
  },
  negative: null,
  variablesJson: {
    style: "写实电商展示",
    outputCount: "1",
  },
};

const modelConfig = {
  id: "model-config-1",
  provider: "openai",
  modelId: "gpt-image-1",
  paramsJson: {
    outputCount: 1,
    size: "1024x1024",
  },
};

test("workbench auto save is skipped until an existing combination is complete", () => {
  const plan = buildWorkbenchAutoSavePlan({
    combinationId: "combo-1",
    combinationName: "试穿组合",
    personAssetId: "person-a",
    personAssetIds: ["person-a"],
    garmentAssetIds: [],
    promptBinding,
    modelConfig,
  });

  assert.equal(plan, null);
});

test("workbench auto save builds combination, prompt, and model payloads", () => {
  const plan = buildWorkbenchAutoSavePlan({
    combinationId: "combo-1",
    combinationName: "试穿组合",
    personAssetId: "person-a",
    personAssetIds: ["person-b", "person-a"],
    garmentAssetIds: ["garment-a"],
    promptBinding,
    modelConfig,
  });

  assert.deepEqual(plan?.combination, {
    id: "combo-1",
    name: "试穿组合",
    personAssetId: "person-a",
    personAssetIds: ["person-b", "person-a"],
    garmentAssetIds: ["garment-a"],
  });
  assert.equal(plan?.promptBinding, promptBinding);
  assert.equal(plan?.modelConfig, modelConfig);
});

test("workbench auto save signature changes when prompt or model details change", () => {
  const firstSignature = buildWorkbenchAutoSaveSignature({
    combinationId: "combo-1",
    combinationName: "试穿组合",
    personAssetId: "person-a",
    personAssetIds: ["person-a"],
    garmentAssetIds: ["garment-a"],
    promptBinding,
    modelConfig,
  });
  const secondSignature = buildWorkbenchAutoSaveSignature({
    combinationId: "combo-1",
    combinationName: "试穿组合",
    personAssetId: "person-a",
    personAssetIds: ["person-a"],
    garmentAssetIds: ["garment-a"],
    promptBinding: {
      ...promptBinding,
      user: {
        ...promptBinding.user,
        appendText: "新的追加描述",
      },
    },
    modelConfig: {
      ...modelConfig,
      paramsJson: {
        ...modelConfig.paramsJson,
        outputCount: 2,
      },
    },
  });

  assert.notEqual(firstSignature, secondSignature);
});
