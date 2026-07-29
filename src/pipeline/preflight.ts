import { parseChartConfig } from "../convert/chart-converter.js";
import { extractTableRows } from "../convert/table-converter.js";
import { evaluateRasterPolicy } from "../policy/raster-policy.js";
import { explicitTextRole } from "../policy/text-policy.js";
import { classifyVisualEffects } from "../policy/visual-effect-policy.js";
import { ConversionPolicyError, type DomNodeSnapshot } from "../types.js";

function pseudoText(value: string | undefined): string {
  const content = (value ?? "").trim();
  if (!content || content === "none" || content === "normal") return "";
  if (content.startsWith("url(")) return "";
  const quote = content[0];
  if ((quote === '"' || quote === "'") && content.at(-1) === quote) {
    return content.slice(1, -1).trim();
  }
  return content;
}

function rejectNonNativeContent(node: DomNodeSnapshot): void {
  for (const property of ["beforeContent", "afterContent"] as const) {
    const text = pseudoText(node.style[property]);
    if (!text) continue;
    throw new ConversionPolicyError({
      code: "PSEUDO_TEXT_NOT_NATIVE",
      slide: node.slide,
      selector: node.selector,
      textPreview: text.slice(0, 120),
      reason:
        "Visible pseudo-element text cannot become native PowerPoint text",
      suggestedRepair:
        "Move the generated content into a real HTML text element with data-pptx-text-role.",
    });
  }

  if (node.tagName === "CANVAS") {
    throw new ConversionPolicyError({
      code: "CANVAS_REQUIRES_RASTER_POLICY",
      slide: node.slide,
      selector: node.selector,
      textPreview: "",
      reason: "A visible canvas would disappear from native PowerPoint output",
      suggestedRepair:
        "Mark a visual-only canvas as an explicitly allowed raster or rebuild semantic content natively.",
    });
  }
}

function inspectNode(node: DomNodeSnapshot): void {
  if (!node.visible) return;

  const rasterRequested =
    "data-pptx-raster" in node.attributes ||
    "data-pptx-raster-role" in node.attributes;
  if (rasterRequested) {
    evaluateRasterPolicy(node);
    return;
  }

  rejectNonNativeContent(node);

  const zIndex = Number.parseInt(node.style.zIndex ?? "", 10);
  if (Number.isFinite(zIndex) && zIndex < 0) {
    throw new ConversionPolicyError({
      code: "NEGATIVE_Z_INDEX_UNSUPPORTED",
      slide: node.slide,
      selector: node.selector,
      textPreview: node.text.slice(0, 120),
      reason:
        "Negative z-index depends on browser stacking contexts that PowerPoint does not reproduce",
      suggestedRepair:
        "Use non-negative sibling z-index values or reorder the DOM to express the intended PowerPoint layer order.",
    });
  }

  explicitTextRole(node);

  if ("data-pptx-chart-config" in node.attributes) {
    parseChartConfig(node.attributes["data-pptx-chart-config"]);
    return;
  }

  if (node.tagName === "TABLE") {
    const rows = extractTableRows(node);
    if (!rows.length) {
      throw new Error(`Native table has no editable rows: ${node.selector}`);
    }
    return;
  }

  const unsupported = classifyVisualEffects(node).find(
    (finding) => finding.disposition === "requires-raster",
  );
  if (unsupported) {
    const hasSemanticText = Boolean(explicitTextRole(node) || node.text.trim());
    throw new ConversionPolicyError({
      code: "UNSUPPORTED_VISUAL_REQUIRES_RASTER",
      slide: node.slide,
      selector: node.selector,
      textPreview: node.text.slice(0, 120),
      reason: `${unsupported.property} cannot be represented faithfully as a native PowerPoint shape`,
      suggestedRepair: hasSemanticText
        ? "Move the visual effect to a separate text-free element, explicitly authorize only that visual node for raster capture, and keep semantic text native."
        : "Explicitly authorize this isolated visual-only node for raster capture or replace the effect with supported native shapes.",
    });
  }

  for (const child of node.children) inspectNode(child);
}

export function preflight(slides: DomNodeSnapshot[][]): void {
  if (!slides.length) {
    throw new Error("No .pptx-slide elements were found");
  }
  for (const nodes of slides) {
    for (const node of nodes) inspectNode(node);
  }
}
