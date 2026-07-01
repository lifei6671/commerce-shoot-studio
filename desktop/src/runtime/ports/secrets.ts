import type { ProviderTestResult, SecretScope, SecretStatus } from "../types";

export interface SecretPort {
  getSecretStatus(scope: SecretScope): Promise<SecretStatus>;
  revealSecret(scope: SecretScope): Promise<string>;
  saveSecret(scope: SecretScope, value: string): Promise<SecretStatus>;
  deleteSecret(scope: SecretScope): Promise<void>;
  testProviderConnection(scope: SecretScope): Promise<ProviderTestResult>;
}
