import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("Tauri config", () => {
  it("allows Tauri asset URLs for local image previews", () => {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const configPath = resolve(currentDir, "../../src-tauri/tauri.conf.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));

    expect(config.app.security.assetProtocol).toMatchObject({
      enable: true,
      scope: {
        allow: expect.arrayContaining([
          "$HOME/**",
          "$TEMP/**",
          "/private/var/folders/**",
          "/var/folders/**",
        ]),
      },
    });
    expect(config.app.security.csp).toContain("asset:");
    expect(config.app.security.csp).toContain("http://asset.localhost");
  });

  it("allows resolving the system pictures directory for the image picker", () => {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const capabilityPath = resolve(currentDir, "../../src-tauri/capabilities/default.json");
    const capability = JSON.parse(readFileSync(capabilityPath, "utf8"));

    expect(capability.permissions).toContain("core:path:allow-resolve-directory");
  });
});
