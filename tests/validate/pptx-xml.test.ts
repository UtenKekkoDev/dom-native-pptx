import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { exportDeck } from "../../src/pipeline/export-deck.js";
import { writeValidationHtml } from "../../src/report/html-report.js";
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
    expect(report.securityMode).toBe("safe");
    expect(report.warnings).toEqual([]);
    expect(report.slideCount).toBe(1);
    expect(report.nativeTexts).toEqual(
      expect.arrayContaining([
        "原生标题",
        "正文必须保持为 PowerPoint 原生文本框。",
      ]),
    );
    expect(report.missingProtectedText).toHaveLength(0);
    expect(report.undersizedTextBoxes).toEqual([]);
    expect(report.unauthorizedRasterRecords).toHaveLength(0);
    expect(report.fullSlideRasterCount).toBe(0);
    expect((await fs.stat(result.validationJsonPath)).size).toBeGreaterThan(0);
    expect(await fs.readFile(result.validationHtmlPath, "utf8")).toMatch(
      /PASS.*SAFE.*Security mode.*Native text nodes/s,
    );
  });

  it("reports actual OOXML evidence when a native text box is shorter than its font", async () => {
    const output = path.resolve(".tmp/tests/undersized-textbox.pptx");
    const result = await exportDeck({
      input: path.resolve("tests/fixtures/undersized-textbox.html"),
      output,
    });

    const report = await inspectPptx(output, result.manifestPath);

    expect(report.undersizedTextBoxes).toHaveLength(1);
    expect(report.undersizedTextBoxes[0]).toMatchObject({
      slide: 1,
      shapeName: "Text 0",
      fontSizePoints: 32,
    });
    expect(report.undersizedTextBoxes[0].heightEmu).toBeLessThan(
      report.undersizedTextBoxes[0].requiredHeightEmu,
    );
  });

  it("treats schema version 1 manifests as trusted with a warning", async () => {
    const output = path.resolve(".tmp/tests/legacy-manifest.pptx");
    const result = await exportDeck({
      input: path.resolve("tests/fixtures/basic-slide.html"),
      output,
    });
    const manifest = JSON.parse(
      await fs.readFile(result.manifestPath, "utf8"),
    ) as Record<string, unknown>;
    manifest.schemaVersion = 1;
    delete manifest.securityMode;
    const legacyManifestPath = path.resolve(
      ".tmp/tests/legacy-manifest.conversion-manifest.json",
    );
    await fs.writeFile(legacyManifestPath, JSON.stringify(manifest), "utf8");

    const report = await inspectPptx(output, legacyManifestPath);
    const htmlPath = path.resolve(".tmp/tests/legacy-manifest.validation.html");
    await writeValidationHtml(htmlPath, report);

    expect(report.securityMode).toBe("trusted");
    expect(report.warnings.join("\n")).toMatch(/version 1.*unrestricted/iu);
    expect(await fs.readFile(htmlPath, "utf8")).toMatch(
      /TRUSTED.*Security mode.*Warnings.*version 1.*unrestricted/su,
    );
  });

  it("rejects an invalid schema version 2 security mode", async () => {
    const output = path.resolve(".tmp/tests/invalid-security-mode.pptx");
    const result = await exportDeck({
      input: path.resolve("tests/fixtures/basic-slide.html"),
      output,
    });
    const manifest = JSON.parse(
      await fs.readFile(result.manifestPath, "utf8"),
    ) as Record<string, unknown>;
    manifest.securityMode = "unsafe";
    const invalidManifestPath = path.resolve(
      ".tmp/tests/invalid-security-mode.conversion-manifest.json",
    );
    await fs.writeFile(invalidManifestPath, JSON.stringify(manifest), "utf8");

    await expect(inspectPptx(output, invalidManifestPath)).rejects.toThrow(
      /schema version 2.*securityMode.*safe.*trusted/iu,
    );
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
    await fs.writeFile(tamperedManifest, JSON.stringify(manifest), "utf8");

    const report = await inspectPptx(output, tamperedManifest);

    expect(report.ok).toBe(false);
    expect(report.unauthorizedRasterRecords).toHaveLength(1);
    expect(report.errors.join("\n")).toMatch(/unauthorized raster/i);
  });
});
