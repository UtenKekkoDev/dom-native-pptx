import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { exportDeck } from "../../src/pipeline/export-deck.js";

describe("deck export pipeline", () => {
  it("exports protected content as native text and writes a manifest", async () => {
    const output = path.resolve(".tmp/tests/basic.pptx");
    const result = await exportDeck({
      input: path.resolve("tests/fixtures/basic-slide.html"),
      output,
    });

    expect((await fs.stat(output)).size).toBeGreaterThan(0);
    expect((await fs.stat(result.manifestPath)).size).toBeGreaterThan(0);
    expect(result.manifest.records).toEqual(expect.arrayContaining([
      expect.objectContaining({
        selector: "#title",
        text: "原生标题",
        pptxOutputType: "native-text",
        rasterized: false,
      }),
      expect.objectContaining({
        selector: "#body",
        text: "正文必须保持为 PowerPoint 原生文本框。",
        pptxOutputType: "native-text",
        rasterized: false,
      }),
    ]));
    expect(result.manifest.records.some((record) =>
      record.rasterized && !record.rasterAuthorized)).toBe(false);
  });

  it("fails before writing a deck when a raster container includes body text", async () => {
    const output = path.resolve(".tmp/tests/forbidden-raster.pptx");
    await fs.rm(output, { force: true });

    await expect(exportDeck({
      input: path.resolve("tests/fixtures/forbidden-raster.html"),
      output,
    })).rejects.toThrow(/protected text.*p.*这段正文绝对不能转换成图片/u);
    await expect(fs.stat(output)).rejects.toThrow();
  });
});
