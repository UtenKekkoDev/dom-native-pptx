import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
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
});
