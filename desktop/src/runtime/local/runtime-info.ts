import { invoke } from "@tauri-apps/api/core";
import type { RuntimeInfo, RuntimeInfoPort } from "../index";

export const localRuntimeInfoPort: RuntimeInfoPort = {
  getRuntimeInfo() {
    return invoke<RuntimeInfo>("runtime_info");
  },
};
