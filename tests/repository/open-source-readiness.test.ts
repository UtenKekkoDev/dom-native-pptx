import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

function readIfPresent(relativePath: string): string {
  const absolutePath = path.resolve(relativePath);
  return fs.existsSync(absolutePath)
    ? fs.readFileSync(absolutePath, "utf8")
    : "";
}

describe("open-source readiness guardrails", () => {
  it("has a public CI workflow for portable build and tests", () => {
    const workflow = read(".github/workflows/ci.yml");
    expect(workflow).toContain("npm ci");
    expect(workflow).toContain("playwright install chromium");
    expect(workflow).toContain("npm run build");
    expect(workflow).toMatch(/npm (run test:run|test -- --run)/);
  });

  it("does not require the maintainer's absolute Windows path", () => {
    expect(read("README.md")).not.toMatch(/C:\\Users\\ROG/i);
    expect(read("skills/dom-native-pptx/SKILL.md")).not.toMatch(
      /C:\\Users\\ROG/i,
    );
  });

  it("records the approved publication decisions and release gates", () => {
    const audit = read("docs/open-source-readiness.md");
    for (const decision of [
      "MIT",
      "UtenKekkoDev/dom-native-pptx",
      "0.2.0-beta.1",
      "Node.js 22",
      "macOS",
      "Linux",
      "Microsoft PowerPoint",
      "secret scan",
    ]) {
      expect(audit).toContain(decision);
    }
  });

  it("publishes version tags to GitHub Packages and GitHub Releases", () => {
    const workflow = readIfPresent(".github/workflows/release.yml");

    expect(workflow).toContain("tags:");
    expect(workflow).toContain("packages: write");
    expect(workflow).toContain("contents: write");
    expect(workflow).toContain("PUPPETEER_SKIP_DOWNLOAD");
    expect(workflow).toContain("npm run test:run");
    expect(workflow).toContain("npm run test:package");
    expect(workflow).toContain("@utenkekkodev/dom-native-pptx");
    expect(workflow).toContain("https://npm.pkg.github.com");
    expect(workflow).toContain("NODE_AUTH_TOKEN");
    expect(workflow).toContain("SHA256SUMS.txt");
    expect(workflow).toContain("gh release create");

    const prepareIndex = workflow.indexOf(
      "name: Prepare GitHub package metadata",
    );
    const packIndex = workflow.indexOf("name: Pack release asset");
    expect(prepareIndex).toBeGreaterThan(-1);
    expect(packIndex).toBeGreaterThan(prepareIndex);
  });

  it("documents the live package and release channels", () => {
    const readme = read("README.md");

    expect(readme).not.toContain(
      "Public repository and npm publication are planned",
    );
    expect(readme).toContain("@utenkekkodev/dom-native-pptx@beta");
    expect(readme).toContain(
      "https://github.com/UtenKekkoDev/dom-native-pptx/releases",
    );
  });
});
