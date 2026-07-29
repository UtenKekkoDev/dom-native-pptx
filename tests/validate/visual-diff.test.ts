import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { renderHtmlSlides } from "../../src/validate/html-renderer.js";
import { compareImages } from "../../src/validate/visual-diff.js";

describe("visual validation", () => {
  it("reports identical images as a perfect match", async () => {
    const fixture = path.resolve(".tmp/tests/identical.png");
    const diff = path.resolve(".tmp/tests/identical-diff.png");
    await fs.mkdir(path.dirname(fixture), { recursive: true });
    await sharp({
      create: {
        width: 4,
        height: 4,
        channels: 4,
        background: { r: 80, g: 42, b: 120, alpha: 1 },
      },
    })
      .png()
      .toFile(fixture);

    const result = await compareImages(fixture, fixture, diff);

    expect(result).toEqual({
      width: 4,
      height: 4,
      differentPixels: 0,
      ratio: 0,
    });
    expect((await fs.stat(diff)).size).toBeGreaterThan(0);
  });

  it("renders each HTML slide at the authoritative 1920x1080 canvas", async () => {
    const outputDir = path.resolve(".tmp/tests/html-render");
    const result = await renderHtmlSlides(
      path.resolve("tests/fixtures/basic-slide.html"),
      outputDir,
    );

    expect(result.files).toEqual([path.join(outputDir, "slide-001.png")]);
    expect(await sharp(result.files[0]).metadata()).toMatchObject({
      width: 1920,
      height: 1080,
    });
  });

  it("renders the deprecated string selector argument", async () => {
    const outputDir = path.resolve(".tmp/tests/html-render-legacy-selector");
    const result = await renderHtmlSlides(
      path.resolve("tests/fixtures/legacy-custom-selector.html"),
      outputDir,
      ".legacy-slide",
    );

    expect(result.files).toEqual([path.join(outputDir, "slide-001.png")]);
    expect(await sharp(result.files[0]).metadata()).toMatchObject({
      width: 1920,
      height: 1080,
    });
  });
});
