import { invoke } from "@tauri-apps/api/core";
import type { ProviderTestResult, SecretPort, SecretScope, SecretStatus } from "../index";

export const localSecretPort: SecretPort = {
  getSecretStatus(scope: SecretScope) {
    return invoke<SecretStatus>("secret_get_status", { scope });
  },
  revealSecret(scope: SecretScope) {
    return invoke<string>("secret_reveal", { scope });
  },
  saveSecret(scope: SecretScope, value: string) {
    return invoke<SecretStatus>("secret_save", { scope, value });
  },
  deleteSecret(scope: SecretScope) {
    return invoke("secret_delete", { scope });
  },
  testProviderConnection(scope: SecretScope) {
    return invoke<ProviderTestResult>("secret_test_provider_connection", { scope });
  },
};
