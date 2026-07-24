import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const skillRoot = path.resolve("skills/dom-native-pptx");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(skillRoot, relativePath), "utf8");
}

describe("dom-native-pptx skill contract", () => {
  it("routes complex CSS and raster-backdrop failures to dedicated guidance", () => {
    const skill = read("SKILL.md");
    expect(skill).toContain("references/complex-effects.md");
    expect(skill).toMatch(/gradient|clip-path|filter/i);
    expect(skill).toMatch(/backing plate|backdrop/i);
  });

  it("documents fail-closed decisions without allowing semantic text rasterization", () => {
    const guidance = read("references/complex-effects.md");
    expect(guidance).toContain("UNSUPPORTED_VISUAL_REQUIRES_RASTER");
    expect(guidance).toContain("NEGATIVE_Z_INDEX_UNSUPPORTED");
    expect(guidance).toMatch(/semantic text.*outside/i);
    expect(guidance).toMatch(/alpha.*zero/i);
    expect(guidance).toMatch(/overlapping sibling|hide.*non-target/i);
  });

  it("requires the repeatable PowerPoint stress suite before delivery", () => {
    const checklist = read("references/qa-checklist.md");
    expect(checklist).toContain("npm run test:stress");
    expect(checklist).toMatch(/full[- ]size/i);
    expect(checklist).toMatch(/transparent corners|corner alpha/i);
  });
});
