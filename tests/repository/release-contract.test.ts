import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const workflowPath = ".github/workflows/release-check.yml";
const builderPath = "scripts/build-prerelease.ps1";

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

describe("GitHub prerelease contract", () => {
  it("provides a workflow-dispatch-only non-publishing release check", () => {
    expect(fs.existsSync(workflowPath)).toBe(true);
    const workflow = read(workflowPath);

    expect(workflow).toMatch(/^on:\s*\n\s+workflow_dispatch:\s*$/mu);
    expect(workflow).not.toMatch(/^\s+(push|pull_request|schedule):/mu);
    expect(workflow).toMatch(/permissions:\r?\n {2}contents: read/u);
    expect(workflow).toContain("actions/checkout@v7");
    expect(workflow).toContain("actions/setup-node@v7");
    expect(workflow).toContain("actions/upload-artifact@v7");
    expect(workflow).toContain("npm run test:run");
    expect(workflow).toContain("npm run test:coverage");
    expect(workflow).toContain("npm run test:package");
    expect(workflow).toContain("npm run audit:licenses");
    expect(workflow).toContain("npm pack --dry-run --json --ignore-scripts");
    expect(workflow).toContain(".tmp/release-check/");
    expect(workflow).not.toMatch(
      /npm publish|NODE_AUTH_TOKEN|id-token:\s*write|packages:\s*write/iu,
    );
  });

  it("builds named safe-mode evidence and checksums without publishing", () => {
    expect(fs.existsSync(builderPath)).toBe(true);
    const script = read(builderPath);

    for (const required of [
      "0.2.0-beta.1",
      "examples/10-full-business-deck/slides.html",
      "dom-native-pptx-v0.2.0-beta.1-demo.pptx",
      "demo.conversion-manifest.json",
      "demo.validation.json",
      "demo.validation.html",
      "stress-scorecard.json",
      "npm-pack-dry-run.json",
      "RELEASE_NOTES.md",
      "SHA256SUMS.txt",
      "Get-FileHash",
      "run-stress-suite.ps1",
      "powerpoint-validator.ps1",
    ]) {
      expect(script).toContain(required);
    }

    expect(script).not.toMatch(/npm publish|NODE_AUTH_TOKEN/iu);
  });

  it("is valid PowerShell syntax", () => {
    expect(fs.existsSync(builderPath)).toBe(true);
    const result = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `$errors = $null; [System.Management.Automation.Language.Parser]::ParseFile('${path
          .resolve(builderPath)
          .replaceAll(
            "'",
            "''",
          )}', [ref]$null, [ref]$errors) | Out-Null; if ($errors.Count) { $errors | ForEach-Object { Write-Error $_ }; exit 1 }`,
      ],
      { encoding: "utf8" },
    );

    expect(result.status, result.stderr || result.stdout).toBe(0);
  });
});
