import type { ModelCapability } from "../types";

export interface CapabilityPort {
  listCapabilities(): Promise<ModelCapability[]>;
  getCapability(capabilityId: ModelCapability["id"]): Promise<ModelCapability>;
}
