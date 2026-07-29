import fs from "node:fs";
import { describe, expect, it } from "vitest";

const readme = fs.readFileSync("README.md", "utf8");

function section(start: string, end: string): string {
  const from = readme.indexOf(start);
  const to = readme.indexOf(end, from + start.length);
  expect(from, `README must contain ${start}`).toBeGreaterThanOrEqual(0);
  expect(to, `README must contain ${end} after ${start}`).toBeGreaterThan(from);
  return readme.slice(from, to);
}

describe("README Agent prompt contract", () => {
  it("publishes English and Chinese copyable prompts", () => {
    const english = section(
      "### English Agent prompt",
      "### 中文 Agent 提示词",
    );
    const chinese = section("### 中文 Agent 提示词", "## Security modes");

    expect(english).toContain("```text");
    expect(chinese).toContain("```text");
    expect(english).toContain("ROLE:");
    expect(chinese).toContain("角色：");
  });

  it("keeps protected content native and forbids silent raster fallback", () => {
    const prompts = [
      section("### English Agent prompt", "### 中文 Agent 提示词"),
      section("### 中文 Agent 提示词", "## Security modes"),
    ];

    for (const prompt of prompts) {
      expect(prompt).toMatch(/body text|正文/u);
      expect(prompt).toMatch(/native editable|原生可编辑/u);
      expect(prompt).toMatch(/full-slide screenshot|整页截图/u);
      expect(prompt).toMatch(/silent fallback|静默降级/u);
      expect(prompt).toMatch(/safe mode|安全模式/u);
      expect(prompt).toMatch(/logo|Logo/u);
      expect(prompt).toMatch(/verify|验证/u);
    }
  });

  it("states the GitHub beta and npm status truthfully", () => {
    expect(readme).toContain("v0.2.0-beta.2");
    expect(readme).toContain("npm package has not been published");
    expect(readme).not.toMatch(/npm package is (live|published)/iu);
  });

  it("uses portable placeholders instead of private machine paths", () => {
    const prompts = section(
      "## Use with an AI coding agent",
      "## Security modes",
    );

    expect(prompts).toContain("<INPUT_HTML>");
    expect(prompts).toContain("<OUTPUT_PPTX>");
    expect(prompts).not.toMatch(/C:\\Users\\/iu);
  });
});
