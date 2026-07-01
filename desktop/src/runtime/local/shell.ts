import { invoke } from "@tauri-apps/api/core";
import type { ChooseDirectoryInput, ShellPort, SystemNotificationInput } from "../index";

export const localShellPort: ShellPort = {
  chooseDirectory(input?: ChooseDirectoryInput) {
    return invoke<string | null>("shell_choose_directory", { input: input ?? null });
  },
  revealPath(path: string) {
    return invoke<void>("shell_reveal_path", { path });
  },
  notify(input: SystemNotificationInput) {
    return invoke<void>("shell_notify", { input });
  },
};
