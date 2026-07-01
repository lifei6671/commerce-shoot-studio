import type { ChooseDirectoryInput, SystemNotificationInput } from "../types";

export interface ShellPort {
  chooseDirectory(input?: ChooseDirectoryInput): Promise<string | null>;
  revealPath(path: string): Promise<void>;
  notify(input: SystemNotificationInput): Promise<void>;
}
