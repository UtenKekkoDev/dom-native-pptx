import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

const sourceFixture = "examples/10-full-business-deck/slides.html";
const evidencePaths = [
  "docs/assets/demo-html.png",
  "docs/assets/demo-powerpoint.png",
] as const;
const evidenceUrls = [
  "https://raw.githubusercontent.com/UtenKekkoDev/dom-native-pptx/v0.2.0-beta.1/docs/assets/demo-html.png",
  "https://raw.githubusercontent.com/UtenKekkoDev/dom-native-pptx/v0.2.0-beta.1/docs/assets/demo-powerpoint.png",
] as const;

interface GeneratedAssetRecord {
  path?: string;
  type?: string;
  sourceFixture?: string;
  sourceSlide?: number;
  command?: string;
  generatedAt?: string;
  width?: number;
  height?: number;
  license?: string;
  ownership?: string;
}

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

function provenanceRecords(): GeneratedAssetRecord[] {
  const registry = JSON.parse(read("docs/asset-provenance.json")) as {
    assets?: GeneratedAssetRecord[];
  };
  return registry.assets ?? [];
}

describe("README renderer evidence", () => {
  it.each(evidencePaths)("ships %s as a full-HD PNG", async (assetPath) => {
    expect(fs.existsSync(path.resolve(assetPath))).toBe(true);

    const metadata = await sharp(path.resolve(assetPath)).metadata();
    expect({
      format: metadata.format,
      width: metadata.width,
      height: metadata.height,
    }).toEqual({ format: "png", width: 1920, height: 1080 });
  });

  it("links both renderer outputs from the README through the release tag", () => {
    const readme = read("README.md");
    for (const [index, assetPath] of evidencePaths.entries()) {
      expect(readme).toContain(`](${evidenceUrls[index]})`);
      expect(readme).not.toContain(`](${assetPath})`);
    }
  });

  it("registers reproducible generated provenance for the same source slide", () => {
    const records = evidencePaths.map((assetPath) => {
      const record = provenanceRecords().find(
        (candidate) => candidate.path === assetPath,
      );
      expect(record).toBeTruthy();
      expect(record).toMatchObject({
        path: assetPath,
        type: "generated",
        sourceFixture,
        width: 1920,
        height: 1080,
        license: "MIT",
        ownership: "Copyright (c) 2026 Yuxuan Sun",
      });
      expect(record?.sourceSlide).toBeGreaterThan(0);
      expect(record?.command).toContain(sourceFixture);
      expect(record?.command).toContain(
        `slide-${String(record?.sourceSlide).padStart(3, "0")}.png`,
      );
      expect(record?.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
      return record!;
    });

    expect(records[0].sourceSlide).toBe(records[1].sourceSlide);
    expect(records[0].command).toContain("pptx:render-html");
    expect(records[1].command).toContain("pptx:render-powerpoint");
  });
});
