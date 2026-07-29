import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

describe("public security documentation", () => {
  it("documents the supported safe default and explicit trusted escape hatch", () => {
    const security = read("SECURITY.md");
    const readme = read("README.md");

    expect(security).toContain("trusted HTML");
    expect(security).toMatch(/safe mode.*default/i);
    expect(security).toMatch(/user-authored or audited HTML/i);
    expect(readme).toContain("--trusted");
    expect(readme).toContain("safe mode");
  });

  it("documents the local-directory boundary and fail-closed security errors", () => {
    const security = read("SECURITY.md");

    expect(security).toMatch(/vendored beside the input/i);
    expect(security).toMatch(/stop conversion/i);
    for (const code of [
      "SECURITY_REMOTE_RESOURCE_BLOCKED",
      "SECURITY_LOCAL_PATH_ESCAPE",
      "SECURITY_IFRAME_BLOCKED",
      "SECURITY_DATA_URL_BLOCKED",
      "SECURITY_TRUSTED_MODE_REQUIRED",
      "SECURITY_RESOURCE_TIMEOUT",
    ]) {
      expect(security).toContain(code);
    }
    expect(security).toMatch(/CLI caller/i);
    expect(security).toMatch(/library caller/i);
  });
});
