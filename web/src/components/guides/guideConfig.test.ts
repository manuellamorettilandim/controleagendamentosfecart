import { describe, expect, it } from "vitest";
import {
  buildActivationCommand,
  buildRestoreCommand,
  configTomlForEndpoint,
  getGuideEnvironment,
  GUIDE_OS_OPTIONS,
  markerForTesting,
  manualRestoreInstructions,
} from "./guideConfig";

function utf8Base64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

describe("guideConfig", () => {
  it("derives local and online endpoints from the current page origin", () => {
    expect(getGuideEnvironment("http://localhost:10000/")).toMatchObject({
      endpoint: "http://localhost:10000/api/codex/v1",
      label: "local",
      labelText: "Ambiente local",
    });

    expect(getGuideEnvironment("https://share.example.com/")).toMatchObject({
      endpoint: "https://share.example.com/api/codex/v1",
      label: "online",
      labelText: "Ambiente online",
    });
  });

  it("generates a token-free TOML provider configuration", () => {
    const config = configTomlForEndpoint("http://localhost:10000/api/codex/v1");

    expect(config).toContain(markerForTesting());
    expect(config).toContain('base_url = "http://localhost:10000/api/codex/v1"');
    expect(config).toContain('env_key = "FECART_CODEX_TOKEN"');
    expect(config).not.toContain("share.fecart.com.br");
  });

  it.each(GUIDE_OS_OPTIONS.map((option) => option.id))("generates an activation command for %s", (os) => {
    const endpoint = "https://share.example.com/api/codex/v1";
    const command = buildActivationCommand(os, endpoint);

    expect(command).toContain("config.toml");
    expect(command).toContain("config.toml.bak");
    expect(command).toContain("FECART");
    expect(command).toContain(endpoint);
    expect(command).not.toContain("share.fecart.com.br/scripts");

    if (os === "cmd") {
      expect(command).toContain(utf8Base64(configTomlForEndpoint(endpoint)));
    } else {
      expect(command).toContain(`base_url = \"${endpoint}\"`);
    }
    expect(command).not.toMatch(/access_token|refresh_token|session_token|test-token/);
  });

  it.each(GUIDE_OS_OPTIONS.map((option) => option.id))("generates a safe restore command for %s", (os) => {
    const command = buildRestoreCommand(os);

    expect(command).toContain("config.toml.bak");
    expect(command).toContain("FECART_MANAGED_CONFIG");
    expect(command).not.toContain("share.fecart.com.br/scripts");
  });

  it("describes manual restoration for Windows and POSIX systems", () => {
    expect(manualRestoreInstructions("powershell")).toContain("renomeie config.toml.bak");
    expect(manualRestoreInstructions("linux")).toContain("renomeie config.toml.bak");
  });
});
