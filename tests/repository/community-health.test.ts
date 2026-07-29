import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

function expectFile(relativePath: string): string {
  expect(fs.existsSync(path.resolve(relativePath)), relativePath).toBe(true);
  return read(relativePath);
}

describe("public community health and security automation", () => {
  it("provides every public governance document and GitHub entry point", () => {
    for (const file of [
      "CONTRIBUTING.md",
      "CODE_OF_CONDUCT.md",
      "CHANGELOG.md",
      ".github/dependabot.yml",
      ".github/ISSUE_TEMPLATE/bug-report.yml",
      ".github/ISSUE_TEMPLATE/config.yml",
      ".github/pull_request_template.md",
      ".github/workflows/codeql.yml",
    ]) {
      expectFile(file);
    }
  });

  it("sets safe, reproducible contribution and release expectations", () => {
    const contributing = expectFile("CONTRIBUTING.md");

    expect(contributing).toMatch(/Node(?:\.js)?\s+22\+/i);
    expect(contributing).toMatch(/playwright install chromium/i);
    expect(contributing).toMatch(/RED/i);
    expect(contributing).toMatch(/GREEN/i);
    expect(contributing).toMatch(/safe mode/i);
    expect(contributing).toMatch(/trusted mode/i);
    expect(contributing).toMatch(/PowerPoint.*render|render.*PowerPoint/i);
    expect(contributing).toMatch(/release.*QA|QA.*release/i);
    expect(contributing).toMatch(/customer.*private|private.*customer/i);
    expect(contributing).toMatch(
      /(?:never|do not|must not).*?(?:add|include|attach).*?fixtures?/i,
    );
  });

  it("adopts Contributor Covenant version 2.1 without a shortened substitute", () => {
    const conduct = expectFile("CODE_OF_CONDUCT.md");

    expect(conduct).toMatch(/Contributor Covenant Code of Conduct/i);
    expect(conduct).toMatch(/Version 2\.1/i);
    expect(conduct).toMatch(/Our Pledge/i);
    expect(conduct).toMatch(/Enforcement Guidelines/i);
    expect(conduct).toMatch(
      /https:\/\/www\.contributor-covenant\.org\/version\/2\/1\/code_of_conduct\.html/i,
    );
  });

  it("starts a beta changelog with an Unreleased section", () => {
    const changelog = expectFile("CHANGELOG.md");

    expect(changelog).toMatch(/^#\s+Changelog/im);
    expect(changelog).toMatch(/^##\s+\[?Unreleased\]?/im);
    expect(changelog).toMatch(/^##\s+\[?0\.2\.0-beta\.1\]?/im);
  });

  it("configures Dependabot for weekly grouped npm and GitHub Actions updates", () => {
    const dependabot = expectFile(".github/dependabot.yml");

    expect(dependabot).toMatch(/^version:\s*2\s*$/m);
    expect(dependabot).toMatch(/package-ecosystem:\s*["']?npm["']?/i);
    expect(dependabot).toMatch(
      /package-ecosystem:\s*["']?github-actions["']?/i,
    );
    expect(dependabot).toMatch(/interval:\s*["']?weekly["']?/i);
    expect(dependabot).toMatch(/open-pull-requests-limit:\s*5\b/i);
    expect(dependabot).toMatch(/groups:\s*$/im);
    expect(dependabot).toMatch(/update-types:[\s\S]*?minor/i);
    expect(dependabot).toMatch(/update-types:[\s\S]*?patch/i);
  });

  it("collects minimized, non-private bug reports with conversion evidence", () => {
    const bugReport = expectFile(".github/ISSUE_TEMPLATE/bug-report.yml");
    const issueConfig = expectFile(".github/ISSUE_TEMPLATE/config.yml");
    const normalizedBugReport = bugReport.toLowerCase();

    for (const field of [
      "source HTML",
      "minimi",
      "OS",
      "Node",
      "PowerPoint",
      "security mode",
      "browser render",
      "PowerPoint render",
      "manifest",
      "validation report",
    ]) {
      expect(normalizedBugReport).toContain(field.toLowerCase());
    }
    expect(bugReport).toMatch(/no private data|private data.*not attached/i);
    expect(bugReport).toMatch(/confirm/i);
    expect(issueConfig).toMatch(/blank_issues_enabled:\s*false/i);
  });

  it("requires PR evidence for tests, safety, raster policy, and public assets", () => {
    const template = expectFile(".github/pull_request_template.md");

    expect(template).toMatch(/tests?/i);
    expect(template).toMatch(/safe(?:-mode| mode)/i);
    expect(template).toMatch(/raster(?:-policy| policy)/i);
    expect(template).toMatch(
      /public[- ]asset.*provenance|provenance.*public[- ]asset/i,
    );
  });

  it("runs least-privilege CodeQL for JavaScript and TypeScript on main changes", () => {
    const codeql = expectFile(".github/workflows/codeql.yml");

    expect(codeql).toMatch(/push:[\s\S]*?branches:[\s\S]*?-\s*main/i);
    expect(codeql).toMatch(/pull_request:[\s\S]*?branches:[\s\S]*?-\s*main/i);
    expect(codeql).toMatch(/security-events:\s*write/i);
    expect(codeql).toMatch(/contents:\s*read/i);
    expect(codeql).toMatch(/javascript-typescript/i);
    expect(codeql).toMatch(/github\/codeql-action\/init@v4/i);
    expect(codeql).toMatch(/github\/codeql-action\/analyze@v4/i);
  });
});
