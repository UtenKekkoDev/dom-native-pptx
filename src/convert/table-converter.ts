import type { DomNodeSnapshot } from "../types.js";
import type { ConversionManifest } from "../pipeline/manifest.js";
import { HTML_CANVAS, pxRectToInches } from "./unit-converter.js";

export interface TableSlideTarget {
  addTable(rows: string[][], options: Record<string, unknown>): unknown;
}

function collectRows(node: DomNodeSnapshot, output: DomNodeSnapshot[]): void {
  if (node.tagName === "TR") {
    output.push(node);
    return;
  }
  for (const child of node.children) collectRows(child, output);
}

export function extractTableRows(node: DomNodeSnapshot): string[][] {
  if (node.tagName !== "TABLE") {
    throw new Error(`Native table source must be TABLE: ${node.selector}`);
  }
  const rowNodes: DomNodeSnapshot[] = [];
  collectRows(node, rowNodes);
  return rowNodes
    .map((row) => row.children
      .filter((cell) => cell.tagName === "TH" || cell.tagName === "TD")
      .map((cell) => cell.text.trim()))
    .filter((row) => row.length > 0);
}

export function addNativeTable(
  slide: TableSlideTarget,
  node: DomNodeSnapshot,
  rows: string[][],
  manifest: ConversionManifest,
): void {
  if (!rows.length || rows.some((row) => !row.length)) {
    throw new Error(`Native table requires non-empty rows: ${node.selector}`);
  }
  const columnCount = rows[0].length;
  if (rows.some((row) => row.length !== columnCount)) {
    throw new Error(`Native table rows must have equal column counts: ${node.selector}`);
  }

  const rect = pxRectToInches(node.rect, HTML_CANVAS);
  slide.addTable(rows, {
    x: rect.x,
    y: rect.y,
    w: rect.width,
    h: rect.height,
    border: { color: "B8B1C2", pt: 1 },
    color: "20152A",
    fill: "FFFFFF",
    fontFace: "Microsoft YaHei",
    fontSize: 12,
    margin: 0.05,
    autoFit: false,
  });
  manifest.add({
    slide: node.slide,
    selector: node.selector,
    domType: node.tagName,
    semanticRole: "table-cell",
    text: rows.flat().join("\n"),
    pptxOutputType: "native-table",
    pptxObjectId: `slide-${node.slide}-table-${manifest.records.length + 1}`,
    rasterized: false,
    rasterAuthorized: false,
    rasterReason: null,
    outputAsset: null,
    warnings: [],
  });
}
