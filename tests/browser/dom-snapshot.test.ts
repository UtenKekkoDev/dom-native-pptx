import path from "node:path";
import { describe, expect, it } from "vitest";
import { snapshotDeck } from "../../src/browser/dom-snapshot.js";

describe("DOM snapshot", () => {
  it("captures rendered positions, styles, own text, and semantic attributes", async () => {
    const file = path.resolve("tests/fixtures/basic-slide.html");
    const slides = await snapshotDeck(file);

    expect(slides).toHaveLength(1);
    const background = slides[0].find(
      (item) => item.tagName === "PPTX-SLIDE-BACKGROUND",
    );
    expect(background?.style.backgroundColor).toBe("rgb(255, 255, 255)");
    expect(background?.rect).toEqual({
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
    });
    const title = slides[0].find((item) => item.id === "title");
    expect(title?.text).toBe("原生标题");
    expect(title?.ownText).toBe("原生标题");
    expect(title?.attributes["data-pptx-text-role"]).toBe("title");
    expect(title?.rect.x).toBeCloseTo(120, 0);
    expect(title?.rect.y).toBeCloseTo(100, 0);
    expect(title?.style.fontFamily).toContain("Microsoft YaHei");
    expect(title?.style.fontSize).toBe("64px");
    expect(title?.style.color).toBe("rgb(32, 21, 42)");
    expect(Number.parseFloat(title?.style.pptxTextNaturalWidth ?? "0"))
      .toBeGreaterThan(250);
  });

  it("rejects a source that has no slide-safe canvas", async () => {
    const file = path.resolve("tests/fixtures/no-slide.html");
    await expect(snapshotDeck(file)).rejects.toThrow(/no \.pptx-slide/i);
  });

  it("preserves explicit HTML line breaks in native text content", async () => {
    const slides = await snapshotDeck(
      path.resolve("tests/fixtures/line-break-slide.html"),
    );
    const title = slides[0].find((item) => item.id === "multiline");
    expect(title?.text).toBe("第一行\n第二行");
  });

  it("anchors generated selectors to the slide root", async () => {
    const slides = await snapshotDeck(
      path.resolve("tests/fixtures/ambiguous-raster-selector.html"),
    );
    const raster = slides[0].find(
      (item) => item.attributes["data-pptx-raster"] === "allowed",
    );

    expect(raster?.selector).toBe(":scope > div:nth-of-type(2)");
  });
});
