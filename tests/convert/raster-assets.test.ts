import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  assertRasterCaptureAllowed,
  captureAuthorizedRaster,
} from "../../src/convert/allowed-rasterizer.js";
import { addImageAsset } from "../../src/convert/image-converter.js";
import { ConversionManifest } from "../../src/pipeline/manifest.js";
import type { DomNodeSnapshot } from "../../src/types.js";

function asset(text: string, role: string): DomNodeSnapshot {
  return {
    slide: 1,
    selector: "#asset",
    tagName: "DIV",
    id: "asset",
    text,
    ownText: text,
    visible: true,
    attributes: {
      "data-pptx-raster": "allowed",
      "data-pptx-raster-role": role,
    },
    rect: { x: 0, y: 0, width: 400, height: 200 },
    style: {},
    children: [],
  };
}

describe("authorized raster capture", () => {
  it("allows a logo", () => {
    expect(assertRasterCaptureAllowed(asset("", "logo")).role).toBe("logo");
  });

  it("rejects body text disguised as a photo", () => {
    const node = asset("季度收入同比增长 42%", "photo");
    node.attributes["data-pptx-text-role"] = "body";
    expect(() => assertRasterCaptureAllowed(node)).toThrow(/protected text/i);
  });

  it("captures only the selected authorized element", async () => {
    let captured:
      { selector: string; options: Record<string, unknown> } | undefined;
    const page = {
      locator(selector: string) {
        return {
          async screenshot(options: Record<string, unknown>) {
            captured = { selector, options };
            await sharp({
              create: {
                width: 2,
                height: 2,
                channels: 4,
                background: { r: 60, g: 10, b: 80, alpha: 0.1 },
              },
            })
              .png()
              .toFile(options.path as string);
          },
        };
      },
    };
    const output = path.resolve(".tmp/tests/raster-assets");

    const result = await captureAuthorizedRaster(
      page,
      asset("", "logo"),
      output,
    );

    expect(captured?.selector).toBe("#asset");
    expect(captured?.options).toMatchObject({
      path: path.join(output, "slide-1-asset.png"),
      omitBackground: true,
    });
    expect(result.decision.role).toBe("logo");
  });

  it("inserts the captured asset as one authorized image record", () => {
    let call: Record<string, unknown> | undefined;
    const slide = {
      addImage(options: Record<string, unknown>) {
        call = options;
      },
    };
    const manifest = new ConversionManifest();
    const node = asset("", "logo");
    const decision = assertRasterCaptureAllowed(node);
    const sourcePath = path.resolve(".tmp/tests/logo.png");

    addImageAsset(slide, node, sourcePath, decision, manifest);

    expect(call).toMatchObject({
      path: sourcePath,
      x: 0,
      y: 0,
    });
    expect(manifest.records[0]).toMatchObject({
      semanticRole: "logo",
      pptxOutputType: "image",
      rasterized: true,
      rasterAuthorized: true,
      rasterReason: "explicit-whitelist",
      outputAsset: sourcePath,
    });
  });
});
