import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { localAiAssistPort } from "./ai-assist";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);
const listenMock = vi.mocked(listen);

describe("localAiAssistPort", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({ text: "1、产品名称：测试商品" });
    listenMock.mockReset();
    listenMock.mockResolvedValue(() => undefined);
  });

  it("calls the product selling points command with uploaded image paths", async () => {
    await localAiAssistPort.generateProductSellingPoints({
      imagePaths: ["/Users/demo/Pictures/product.png"],
    });

    expect(invokeMock).toHaveBeenCalledWith("ai_assist_product_selling_points", {
      input: {
        imagePaths: ["/Users/demo/Pictures/product.png"],
      },
    });
  });

  it("streams product selling point deltas through tauri events", async () => {
    const deltas: string[] = [];
    let eventHandler: ((event: { payload: unknown }) => void) | undefined;
    listenMock.mockImplementation(async (_eventName, handler) => {
      eventHandler = handler as (event: { payload: unknown }) => void;
      return () => undefined;
    });
    invokeMock.mockImplementation(async () => {
      eventHandler?.({
        payload: {
          eventType: "delta",
          delta: "1、产品名称：",
        },
      });
      eventHandler?.({
        payload: {
          eventType: "delta",
          delta: "测试商品",
        },
      });
      return {
        capabilityId: "product-selling-points",
        promptId: "product-selling-points",
        text: "1、产品名称：测试商品",
      };
    });

    const result = await localAiAssistPort.streamProductSellingPoints?.(
      {
        imagePaths: ["/Users/demo/Pictures/product.png"],
      },
      {
        onDelta: (delta) => deltas.push(delta),
      },
    );

    expect(listenMock).toHaveBeenCalledWith(expect.stringContaining("ai-assist-product-selling-points-ai-writing-"), expect.any(Function));
    expect(invokeMock).toHaveBeenCalledWith("ai_assist_product_selling_points_stream", {
      input: {
        imagePaths: ["/Users/demo/Pictures/product.png"],
        requestId: expect.stringContaining("ai-writing-"),
      },
    });
    expect(deltas).toEqual(["1、产品名称：", "测试商品"]);
    expect(result?.text).toBe("1、产品名称：测试商品");
  });
});
