import { describe, expect, it } from "vitest";
import { decodeScenePlanningOutput } from "./sceneImagePlan";

const heroDefinitions: Array<[string, string]> = [
  ["H1", "hero-image"],
  ["H2", "infographic"],
  ["H3", "lifestyle-scene"],
  ["H4", "before-after"],
  ["H5", "poster-banner"],
];

function createPlanningOutput(definitions = heroDefinitions) {
  return {
    campaignStyleLock: "统一使用暖白色背景与中性棚拍光。",
    conversionDriver: "visual",
    items: definitions.map(([code, templateId], index) => ({
      code,
      imageId: `scene-${code.toLowerCase()}`,
      imageNo: index + 1,
      negativeConstraints: "禁止新增或篡改 Logo，禁止虚构参数。",
      prompt: `生成 ${code} 图片。`,
      promptSummary: `${code} 的场景与构图摘要。`,
      purpose: `${code} 的用途`,
      ratio: "1:1",
      sortOrder: index,
      templateId,
      title: `${code} 标题`,
      variantId: "minimal",
    })),
    templateCatalogVersion: "v5",
  };
}

describe("decodeScenePlanningOutput", () => {
  it.each([
    { inputTitle: "H1 标题", expectedTitle: "H1 标题" },
    { inputTitle: "标题", expectedTitle: "H1 标题" },
  ])("keeps exactly one code prefix when the input title is $inputTitle", ({ inputTitle, expectedTitle }) => {
    const output = createPlanningOutput();
    output.items[0].title = inputTitle;
    const result = decodeScenePlanningOutput(output, "hero-pack");

    expect(result.templateCatalogVersion).toBe("v5");
    expect(result.items).toHaveLength(5);
    expect(result.items[0]).toMatchObject({
      code: "H1",
      id: "scene-h1",
      imageNo: 1,
      sortOrder: 0,
      templateId: "hero-image",
      title: expectedTitle,
      variantId: "minimal",
    });
    expect(result.items[0].promptSummary).toBe("H1 的场景与构图摘要。");
  });

  it("rejects an incomplete package before the UI consumes it", () => {
    const output = createPlanningOutput(heroDefinitions.slice(0, 4));

    expect(() => decodeScenePlanningOutput(output, "hero-pack")).toThrow("应返回 5 张图片");
  });

  it("rejects wrong order, unknown templates, duplicate IDs, and unresolved placeholders", () => {
    const wrongOrder = createPlanningOutput();
    wrongOrder.items[1].code = "H3";
    expect(() => decodeScenePlanningOutput(wrongOrder, "hero-pack")).toThrow("顺序与 H2 合同不一致");

    const unknownTemplate = createPlanningOutput();
    unknownTemplate.items[0].templateId = "unknown-template";
    expect(() => decodeScenePlanningOutput(unknownTemplate, "hero-pack")).toThrow("未知模板");

    const duplicateId = createPlanningOutput();
    duplicateId.items[1].imageId = duplicateId.items[0].imageId;
    expect(() => decodeScenePlanningOutput(duplicateId, "hero-pack")).toThrow("重复图片 ID");

    const unresolvedPlaceholder = createPlanningOutput();
    unresolvedPlaceholder.items[0].prompt = "生成 {{product}} 图片。";
    expect(() => decodeScenePlanningOutput(unresolvedPlaceholder, "hero-pack")).toThrow("未替换占位符");
  });
});
