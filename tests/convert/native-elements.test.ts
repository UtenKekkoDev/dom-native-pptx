import { describe, expect, it } from "vitest";
import {
  cssPixelsToPoints,
  pxRectToInches,
} from "../../src/convert/unit-converter.js";
import { addNativeShape } from "../../src/convert/shape-converter.js";
import { addNativeText } from "../../src/convert/text-converter.js";
import { ConversionManifest } from "../../src/pipeline/manifest.js";
import type { DomNodeSnapshot } from "../../src/types.js";

function textNode(): DomNodeSnapshot {
  return {
    slide: 1,
    selector: "#title",
    tagName: "H1",
    id: "title",
    text: "原生标题",
    ownText: "原生标题",
    visible: true,
    attributes: { "data-pptx-text-role": "title" },
    rect: { x: 120, y: 100, width: 256, height: 90 },
    style: {
      fontFamily: '"Microsoft YaHei", sans-serif',
      fontSize: "64px",
      fontWeight: "700",
      fontStyle: "normal",
      color: "rgb(32, 21, 42)",
      textAlign: "left",
      lineHeight: "76.8px",
      letterSpacing: "0px",
      pptxTextNaturalWidth: "256px",
    },
    children: [],
  };
}

describe("native conversion primitives", () => {
  it("maps 1920x1080 pixels to a 13.333x7.5 inch slide", () => {
    expect(pxRectToInches(
      { x: 960, y: 540, width: 960, height: 540 },
      { width: 1920, height: 1080 },
    )).toEqual({
      x: 6.6665,
      y: 3.75,
      width: 6.6665,
      height: 3.75,
    });
  });

  it("uses the slide canvas scale when converting CSS pixels to points", () => {
    expect(cssPixelsToPoints("64px")).toBe(32);
    expect(cssPixelsToPoints("30px")).toBe(15);
  });

  it("refuses a successful manifest with missing native text", () => {
    const manifest = new ConversionManifest();
    manifest.expectText(1, "#title", "原生标题");
    expect(() => manifest.assertComplete()).toThrow(
      /missing native text.*slide=1.*selector=#title.*原生标题/i,
    );
  });

  it("accepts a protected string only after a native text record is present", () => {
    const manifest = new ConversionManifest();
    manifest.expectText(1, "#title", "原生标题");
    manifest.add({
      slide: 1,
      selector: "#title",
      domType: "H1",
      semanticRole: "title",
      text: "原生标题",
      pptxOutputType: "native-text",
      pptxObjectId: "slide-1-text-1",
      rasterized: false,
      rasterAuthorized: false,
      rasterReason: null,
      outputAsset: null,
      warnings: [],
    });
    expect(() => manifest.assertComplete()).not.toThrow();
  });

  it("does not count an image record as native text", () => {
    const manifest = new ConversionManifest();
    manifest.expectText(1, "#title", "原生标题");
    manifest.add({
      slide: 1,
      selector: "#title",
      domType: "H1",
      semanticRole: "title",
      text: "原生标题",
      pptxOutputType: "image",
      pptxObjectId: "slide-1-image-1",
      rasterized: true,
      rasterAuthorized: true,
      rasterReason: "explicit-whitelist",
      outputAsset: "title.png",
      warnings: [],
    });
    expect(() => manifest.assertComplete()).toThrow(/missing native text/i);
  });

  it("adds semantic content as editable PowerPoint text with mapped styles", () => {
    let call: { text: string; options: Record<string, unknown> } | undefined;
    const slide = {
      addText(text: string, options: Record<string, unknown>) {
        call = { text, options };
      },
    };
    const manifest = new ConversionManifest();
    manifest.expectText(1, "#title", "原生标题");

    addNativeText(slide, textNode(), manifest);

    expect(call?.text).toBe("原生标题");
    expect(call?.options).toMatchObject({
      fontFace: "Microsoft YaHei",
      fontSize: 32,
      bold: true,
      color: "20152A",
      margin: 0,
      valign: "top",
      w: 1.8888,
    });
    expect(() => manifest.assertComplete()).not.toThrow();
  });

  it("maps explicit CSS middle alignment to PowerPoint middle alignment", () => {
    let call: { text: string; options: Record<string, unknown> } | undefined;
    const slide = {
      addText(text: string, options: Record<string, unknown>) {
        call = { text, options };
      },
    };
    const node = textNode();
    node.style.verticalAlign = "middle";

    addNativeText(slide, node, new ConversionManifest());

    expect(call?.options.valign).toBe("mid");
  });

  it("adds a CSS background as a native PowerPoint rectangle", () => {
    let call: { shape: string; options: Record<string, unknown> } | undefined;
    const slide = {
      addShape(shape: string, options: Record<string, unknown>) {
        call = { shape, options };
      },
    };
    const manifest = new ConversionManifest();
    const node = textNode();
    node.text = "";
    node.ownText = "";
    node.tagName = "DIV";
    node.selector = "#card";
    node.style.backgroundColor = "rgb(243, 239, 248)";
    node.style.borderTopColor = "rgb(90, 50, 120)";
    node.style.borderTopWidth = "2px";
    node.style.borderRadius = "0px";

    addNativeShape(slide, node, manifest);

    expect(call?.shape).toBe("rect");
    expect(call?.options).toMatchObject({
      fill: { color: "F3EFF8", transparency: 0 },
      line: { color: "5A3278", width: 1, transparency: 0 },
    });
    expect(manifest.records[0]?.pptxOutputType).toBe("native-shape");
  });

  it("maps a circular CSS box to a native PowerPoint ellipse", () => {
    let call: { shape: string; options: Record<string, unknown> } | undefined;
    const slide = {
      addShape(shape: string, options: Record<string, unknown>) {
        call = { shape, options };
      },
    };
    const manifest = new ConversionManifest();
    const node = textNode();
    node.text = "";
    node.ownText = "";
    node.tagName = "DIV";
    node.selector = "#circle";
    node.rect = { x: 100, y: 100, width: 380, height: 380 };
    node.style.backgroundColor = "rgb(108, 77, 224)";
    node.style.borderRadius = "50%";

    addNativeShape(slide, node, manifest);

    expect(call?.shape).toBe("ellipse");
    expect(manifest.records[0]?.warnings).toEqual([]);
  });
});
