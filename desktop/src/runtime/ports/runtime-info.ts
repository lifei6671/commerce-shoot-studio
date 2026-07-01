import type { RuntimeInfo } from "../types";

export interface RuntimeInfoPort {
  getRuntimeInfo(): Promise<RuntimeInfo>;
}
