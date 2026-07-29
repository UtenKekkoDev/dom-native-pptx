import type { DomNodeSnapshot } from "../types.js";
import type { ConversionManifest } from "../pipeline/manifest.js";
import { visualEffectWarnings } from "../policy/visual-effect-policy.js";
import { cssColorToPptx } from "./css-values.js";
import {
  cssPixelsToPoints,
  HTML_CANVAS,
  pxRectToInches,
} from "./unit-converter.js";

export interface ShapeSlideTarget {
  addShape(shape: string, options: Record<string, unknown>): unknown;
}

export function addNativeShape(
  slide: ShapeSlideTarget,
  node: DomNodeSnapshot,
  manifest: ConversionManifest,
): void {
  if (!node.visible) return;
  const rect = pxRectToInches(node.rect, HTML_CANVAS);
  const fill = cssColorToPptx(node.style.backgroundColor, "FFFFFF");
  const border = cssColorToPptx(node.style.borderTopColor, "000000");
  const borderWidth = cssPixelsToPoints(node.style.borderTopWidth || "0px", 0);
  const borderRadius = node.style.borderRadius?.trim() ?? "";
  const radiusValue = Number.parseFloat(borderRadius);
  const isCircle =
    Math.abs(node.rect.width - node.rect.height) <= 1 &&
    ((borderRadius.endsWith("%") && radiusValue >= 50) ||
      (borderRadius.endsWith("px") &&
        radiusValue >= Math.min(node.rect.width, node.rect.height) / 2));

  slide.addShape(isCircle ? "ellipse" : "rect", {
    x: rect.x,
    y: rect.y,
    w: rect.width,
    h: rect.height,
    fill,
    line: {
      color: border.color,
      transparency: borderWidth > 0 ? border.transparency : 100,
      width: borderWidth,
    },
  });

  const warnings = visualEffectWarnings(node);
  if (borderRadius && borderRadius !== "0px" && !isCircle) {
    warnings.push("border-radius is currently approximated as a rectangle");
  }

  manifest.add({
    slide: node.slide,
    selector: node.selector,
    domType: node.tagName,
    semanticRole: null,
    text: "",
    pptxOutputType: "native-shape",
    pptxObjectId: `slide-${node.slide}-shape-${manifest.records.length + 1}`,
    rasterized: false,
    rasterAuthorized: false,
    rasterReason: null,
    outputAsset: null,
    warnings,
  });
}
