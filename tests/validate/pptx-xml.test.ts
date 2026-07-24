import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { exportDeck } from "../../src/pipeline/export-deck.js";
import { inspectPptx } from "../../src/validate/pptx-xml.js";

describe("PPTX structural validation", () => {
  it("finds every protected string in native slide XML", async () => {
    const output = path.resolve(".tmp/tests/validated-basic.pptx");
    const result = await exportDeck({
      input: path.resolve("tests/fixtures/basic-slide.html"),
      output,
    });

    const report = await inspectPptx(output, result.manifestPath);

    expect(report.ok).toBe(true);
    expect(report.slideCount).toBe(1);
    expect(report.nativeTexts).toEqual(expect.arrayContaining([
      "原生标题",
      "正文必须保持为 PowerPoint 原生文本框。",
    ]));
    expect(report.missingProtectedText).toHaveLength(0);
    expect(report.unauthorizedRasterRecords).toHaveLength(0);
    expect(report.fullSlideRasterCount).toBe(0);
    expect((await fs.stat(result.validationJsonPath)).size).toBeGreaterThan(0);
    expect((await fs.readFile(result.validationHtmlPath, "utf8")))
      .toMatch(/PASS.*Native text nodes/s);
  });

  it("fails when the manifest contains an unauthorized raster record", async () => {
    const output = path.resolve(".tmp/tests/unauthorized-record.pptx");
    const result = await exportDeck({
      input: path.resolve("tests/fixtures/basic-slide.html"),
      output,
    });
    const manifest = JSON.parse(
      await fs.readFile(result.manifestPath, "utf8"),
    ) as { records: unknown[] };
    manifest.records.push({
      slide: 1,
      selector: "#bad",
      text: "正文截图",
      pptxOutputType: "image",
      rasterized: true,
      rasterAuthorized: false,
    });
    const tamperedManifest = path.resolve(
      ".tmp/tests/unauthorized-record.manifest.json",
    );
    await fs.writeFile(
      tamperedManifest,
      JSON.stringify(manifest),
      "utf8",
    );

    const report = await inspectPptx(output, tamperedManifest);

    expect(report.ok).toBe(false);
    expect(report.unauthorizedRasterRecords).toHaveLength(1);
    expect(report.errors.join("\n")).toMatch(/unauthorized raster/i);
  });
});
