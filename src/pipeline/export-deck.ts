import fs from "node:fs/promises";
import path from "node:path";
import PptxGenJS from "pptxgenjs";
import { snapshotDeck } from "../browser/dom-snapshot.js";
import { openSlidePage } from "../browser/slide-page-session.js";
import {
  captureAuthorizedRaster,
  setRasterCaptureBackground,
  setRasterCaptureIsolation,
  type RasterPageTarget,
} from "../convert/allowed-rasterizer.js";
import {
  addNativeChart,
  type ChartSlideTarget,
} from "../convert/chart-converter.js";
import {
  addImageAsset,
  type ImageSlideTarget,
} from "../convert/image-converter.js";
import {
  addNativeShape,
  type ShapeSlideTarget,
} from "../convert/shape-converter.js";
import {
  addNativeTable,
  extractTableRows,
  type TableSlideTarget,
} from "../convert/table-converter.js";
import {
  addNativeText,
  type TextSlideTarget,
} from "../convert/text-converter.js";
import { explicitTextRole } from "../policy/text-policy.js";
import { writeValidationHtml } from "../report/html-report.js";
import type { DomNodeSnapshot, SecurityMode } from "../types.js";
import { inspectPptx } from "../validate/pptx-xml.js";
import { ConversionManifest } from "./manifest.js";
import { orderSiblingsForPptx } from "./paint-order.js";
import { preflight } from "./preflight.js";

export interface ExportOptions {
  input: string;
  output: string;
  securityMode?: SecurityMode;
  timeoutMs?: number;
}

export interface ExportResult {
  output: string;
  manifestPath: string;
  validationJsonPath: string;
  validationHtmlPath: string;
  manifest: ConversionManifest;
}

interface RenderContext {
  slide: NativeSlideTarget;
  manifest: ConversionManifest;
  rasterAssets: Map<string, string>;
}

type NativeSlideTarget = TextSlideTarget &
  ShapeSlideTarget &
  ChartSlideTarget &
  TableSlideTarget &
  ImageSlideTarget & { background: { color: string } };

interface NativeDeckTarget {
  layout: string;
  author: string;
  company: string;
  subject: string;
  title: string;
  lang: string;
  theme: {
    headFontFace: string;
    bodyFontFace: string;
    lang: string;
  };
  addSlide(): NativeSlideTarget;
  writeFile(options: { fileName: string }): Promise<string>;
}

type PptxConstructorType = {
  new (): NativeDeckTarget;
};

const importedPptx = PptxGenJS as unknown as {
  default?: PptxConstructorType;
};
const PptxConstructor = (importedPptx.default ??
  PptxGenJS) as unknown as PptxConstructorType;

function nodeKey(node: DomNodeSnapshot): string {
  return `${node.slide}:${node.selector}`;
}

function hasVisibleShape(node: DomNodeSnapshot): boolean {
  const background = node.style.backgroundColor;
  const backgroundVisible = Boolean(
    background &&
    background !== "transparent" &&
    !/rgba?\([^)]*,\s*0(?:\.0+)?\s*\)$/u.test(background),
  );
  const borderVisible = [
    node.style.borderTopWidth,
    node.style.borderRightWidth,
    node.style.borderBottomWidth,
    node.style.borderLeftWidth,
  ].some((value) => Number.parseFloat(value || "0") > 0);
  return backgroundVisible || borderVisible;
}

function shouldRenderText(node: DomNodeSnapshot): boolean {
  if (!node.visible || !node.text.trim()) return false;
  if (explicitTextRole(node)) return true;
  return node.children.length === 0 || Boolean(node.ownText.trim());
}

function renderNode(node: DomNodeSnapshot, context: RenderContext): void {
  if (!node.visible) return;

  if (
    "data-pptx-raster" in node.attributes ||
    "data-pptx-raster-role" in node.attributes
  ) {
    const asset = context.rasterAssets.get(nodeKey(node));
    if (!asset) {
      throw new Error(
        `Authorized raster asset was not captured: ${nodeKey(node)}`,
      );
    }
    const role = node.attributes["data-pptx-raster-role"];
    addImageAsset(
      context.slide,
      node,
      asset,
      {
        allowed: true,
        role: role as
          | "logo"
          | "brand-lockup"
          | "photo"
          | "illustration"
          | "decorative-composite",
        reason: "explicit-whitelist",
      },
      context.manifest,
    );
    return;
  }

  if ("data-pptx-chart-config" in node.attributes) {
    addNativeChart(context.slide, node, context.manifest);
    return;
  }

  if (node.tagName === "TABLE") {
    addNativeTable(
      context.slide,
      node,
      extractTableRows(node),
      context.manifest,
    );
    return;
  }

  if (hasVisibleShape(node)) {
    addNativeShape(context.slide, node, context.manifest);
  }

  if (shouldRenderText(node)) {
    const text =
      explicitTextRole(node) || node.children.length === 0
        ? node.text
        : node.ownText;
    const textNode = text === node.text ? node : { ...node, text };
    context.manifest.expectText(node.slide, node.selector, text);
    addNativeText(context.slide, textNode, context.manifest);
    if (explicitTextRole(node)) return;
  }

  for (const child of orderSiblingsForPptx(node.children)) {
    renderNode(child, context);
  }
}

function collectRasterNodes(slides: DomNodeSnapshot[][]): DomNodeSnapshot[] {
  const output: DomNodeSnapshot[] = [];
  const visit = (node: DomNodeSnapshot): void => {
    if (
      "data-pptx-raster" in node.attributes ||
      "data-pptx-raster-role" in node.attributes
    ) {
      output.push(node);
      return;
    }
    for (const child of node.children) visit(child);
  };
  for (const nodes of slides) for (const node of nodes) visit(node);
  return output;
}

async function captureRasterAssets(
  input: string,
  nodes: DomNodeSnapshot[],
  outputDir: string,
  securityMode: SecurityMode,
  timeoutMs?: number,
): Promise<Map<string, string>> {
  const assets = new Map<string, string>();
  if (!nodes.length) return assets;

  const session = await openSlidePage({
    inputPath: input,
    securityMode,
    timeoutMs,
  });
  try {
    const { page } = session;
    await setRasterCaptureBackground(page, true);
    try {
      for (const node of nodes) {
        const slideScope = page.locator(".pptx-slide").nth(node.slide - 1);
        const scopedPage: RasterPageTarget = {
          locator: (selector) => slideScope.locator(selector),
        };
        await setRasterCaptureIsolation(
          page,
          node.slide - 1,
          node.selector,
          true,
        );
        try {
          const capture = await captureAuthorizedRaster(
            scopedPage,
            node,
            outputDir,
          );
          assets.set(nodeKey(node), capture.outputAsset);
        } finally {
          await setRasterCaptureIsolation(
            page,
            node.slide - 1,
            node.selector,
            false,
          );
        }
      }
    } finally {
      await setRasterCaptureBackground(page, false);
    }
    return assets;
  } finally {
    await session.close();
  }
}

export async function exportDeck(
  options: ExportOptions,
): Promise<ExportResult> {
  const input = path.resolve(options.input);
  const output = path.resolve(options.output);
  const securityMode = options.securityMode ?? "safe";
  const snapshots = await snapshotDeck(input, {
    securityMode,
    timeoutMs: options.timeoutMs,
  });
  preflight(snapshots);

  const assetDir = output.replace(/\.pptx$/iu, ".assets");
  const rasterAssets = await captureRasterAssets(
    input,
    collectRasterNodes(snapshots),
    assetDir,
    securityMode,
    options.timeoutMs,
  );
  const manifest = new ConversionManifest();
  const deck = new PptxConstructor();
  deck.layout = "LAYOUT_WIDE";
  deck.author = "dom-native-pptx";
  deck.company = "Local";
  deck.subject = "Native editable PowerPoint converted from slide-safe HTML";
  deck.title = path.basename(input);
  deck.lang = "zh-CN";
  deck.theme = {
    headFontFace: "Microsoft YaHei",
    bodyFontFace: "Microsoft YaHei",
    lang: "zh-CN",
  };

  for (const nodes of snapshots) {
    const slide = deck.addSlide();
    slide.background = { color: "FFFFFF" };
    const context: RenderContext = { slide, manifest, rasterAssets };
    const backgroundNodes = nodes.filter(
      (node) => node.tagName === "PPTX-SLIDE-BACKGROUND",
    );
    const contentNodes = nodes.filter(
      (node) => node.tagName !== "PPTX-SLIDE-BACKGROUND",
    );
    for (const node of backgroundNodes) renderNode(node, context);
    for (const node of orderSiblingsForPptx(contentNodes)) {
      renderNode(node, context);
    }
  }

  manifest.assertComplete();
  await fs.mkdir(path.dirname(output), { recursive: true });
  await deck.writeFile({ fileName: output });

  const manifestPath = output.replace(/\.pptx$/iu, ".conversion-manifest.json");
  await fs.writeFile(
    manifestPath,
    JSON.stringify(
      {
        schemaVersion: 2,
        securityMode,
        source: input,
        output,
        generatedAt: new Date().toISOString(),
        records: manifest.records,
      },
      null,
      2,
    ),
    "utf8",
  );
  const validationJsonPath = output.replace(/\.pptx$/iu, ".validation.json");
  const validationHtmlPath = output.replace(/\.pptx$/iu, ".validation.html");
  const validation = await inspectPptx(output, manifestPath);
  await fs.writeFile(
    validationJsonPath,
    JSON.stringify(validation, null, 2),
    "utf8",
  );
  await writeValidationHtml(validationHtmlPath, validation);
  if (!validation.ok) {
    throw new Error(
      `PPTX structural validation failed: ${validation.errors.join("; ")}`,
    );
  }
  return {
    output,
    manifestPath,
    validationJsonPath,
    validationHtmlPath,
    manifest,
  };
}
