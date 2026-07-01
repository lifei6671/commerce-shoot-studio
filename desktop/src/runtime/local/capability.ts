import { invoke } from "@tauri-apps/api/core";
import type { CapabilityPort, ModelCapability } from "../index";

export const localCapabilityPort: CapabilityPort = {
  listCapabilities() {
    return invoke<ModelCapability[]>("capability_list_capabilities");
  },
  getCapability(capabilityId: ModelCapability["id"]) {
    return invoke<ModelCapability>("capability_get_capability", { capabilityId });
  },
};
