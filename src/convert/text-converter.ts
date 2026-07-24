import type { DomNodeSnapshot } from "../types.js";
import { classifyTextRole } from "../policy/text-policy.js";
import { visualEffectWarnings } from "../policy/visual-effect-policy.js";
import type { ConversionManifest } from "../pipeline/manifest.js";
import { cssColorToPptx, firstFontFamily } from "./css-values.js";
import {
  cssPixelsToPoints,
  HTML_CANVAS,
  pxRectToInches,
} from "./unit-converter.js";

export interface TextSlideTarget {
  addText(text: string, options: Record<string, unknown>): unknown;
}

function horizontalAlign(value: string | undefined): "left" | "center" | "right" | "justify" {
  if (value === "center" || value === "right" || value === "justify") return value;
  return "left";
}

function verticalAlign(value: string | undefined): "top" | "mid" | "bottom" {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "middle") return "mid";
  if (normalized === "bottom" || normalized === "text-bottom") return "bottom";
  return "top";
}

export function addNativeText(
  slide: TextSlideTarget,
  node: DomNodeSnapshot,
  manifest: ConversionManifest,
): void {
  const role = classifyTextRole(node);
  if (!role || !node.text.trim() || !node.visible) return;

  const fontPixels = Number.parseFloat(node.style.fontSize || "16px");
  const naturalWidth = Number.parseFloat(
    node.style.pptxTextNaturalWidth || "NaN",
  );
  const isIntrinsicTextWidth =
    Number.isFinite(naturalWidth) &&
    Math.abs(node.rect.width - naturalWidth) <= 2;
  const safeWidth = isIntrinsicTextWidth
    ? Math.min(
      HTML_CANVAS.width - node.rect.x,
      node.rect.width + Math.max(4, fontPixels * 0.25),
    )
    : node.rect.width;
  const rect = pxRectToInches(
    { ...node.rect, width: safeWidth },
    HTML_CANVAS,
  );
  const color = cssColorToPptx(node.style.color);
  const fontSize = cssPixelsToPoints(node.style.fontSize || "16px", 12);
  const weight = Number.parseInt(node.style.fontWeight || "400", 10);

  slide.addText(node.text, {
    x: rect.x,
    y: rect.y,
    w: rect.width,
    h: rect.height,
    fontFace: firstFontFamily(node.style.fontFamily),
    fontSize,
    bold: Number.isFinite(weight) && weight >= 600,
    italic: node.style.fontStyle === "italic" || node.style.fontStyle === "oblique",
    color: color.color,
    transparency: color.transparency,
    margin: 0,
    fit: "shrink",
    valign: verticalAlign(node.style.verticalAlign),
    align: horizontalAlign(node.style.textAlign),
    breakLine: false,
  });

  manifest.add({
    slide: node.slide,
    selector: node.selector,
    domType: node.tagName,
    semanticRole: role,
    text: node.text,
    pptxOutputType: "native-text",
    pptxObjectId: `slide-${node.slide}-text-${manifest.records.length + 1}`,
    rasterized: false,
    rasterAuthorized: false,
    rasterReason: null,
    outputAsset: null,
    warnings: visualEffectWarnings(node),
  });
}
