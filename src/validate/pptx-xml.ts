import fs from "node:fs/promises";
import JSZip from "jszip";
import type { ConversionRecord, SecurityMode } from "../types.js";
import {
  extractTextNodes,
  findMissingProtectedText,
  type MissingProtectedText,
} from "./native-text.js";
import { auditRasterUsage } from "./raster-usage.js";
import {
  findUndersizedTextBoxes,
  type UndersizedTextBox,
} from "./text-box-measurement.js";

export interface ValidationReport {
  ok: boolean;
  securityMode: SecurityMode;
  warnings: string[];
  pptxPath: string;
  manifestPath: string;
  slideCount: number;
  nativeTexts: string[];
  chartTexts: string[];
  missingProtectedText: MissingProtectedText[];
  undersizedTextBoxes: UndersizedTextBox[];
  unauthorizedRasterRecords: ConversionRecord[];
  authorizedRasterRecords: ConversionRecord[];
  mediaFileCount: number;
  unmanifestedMediaCount: number;
  fullSlideRasterCount: number;
  errors: string[];
}

interface ConversionManifestData {
  schemaVersion?: unknown;
  securityMode?: unknown;
  records?: ConversionRecord[];
}

function manifestSecurity(manifest: ConversionManifestData): {
  securityMode: SecurityMode;
  warnings: string[];
} {
  if (manifest.schemaVersion === 1) {
    return {
      securityMode: "trusted",
      warnings: [
        "Manifest schema version 1 used an unrestricted browser policy; securityMode defaults to trusted.",
      ],
    };
  }
  if (manifest.schemaVersion !== 2) {
    throw new Error(
      `Unsupported conversion manifest schema version: ${String(manifest.schemaVersion)}`,
    );
  }
  if (manifest.securityMode !== "safe" && manifest.securityMode !== "trusted") {
    throw new Error(
      'Manifest schema version 2 requires securityMode to be "safe" or "trusted".',
    );
  }
  return { securityMode: manifest.securityMode, warnings: [] };
}

function slideNumber(name: string): number {
  return Number(name.match(/slide(\d+)\.xml$/u)?.[1] ?? 0);
}

function presentationSlideSize(xml: string): {
  width: number;
  height: number;
} {
  const size = xml.match(/<p:sldSz\s+cx="(\d+)"\s+cy="(\d+)"/u);
  return size
    ? { width: Number(size[1]), height: Number(size[2]) }
    : { width: 12_192_000, height: 6_858_000 };
}

export async function inspectPptx(
  pptxPath: string,
  manifestPath: string,
): Promise<ValidationReport> {
  const zip = await JSZip.loadAsync(await fs.readFile(pptxPath));
  const slideNames = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/u.test(name))
    .sort((left, right) => slideNumber(left) - slideNumber(right));
  const slideXmlDocuments = await Promise.all(
    slideNames.map((name) => zip.file(name)!.async("string")),
  );
  const slideTexts = new Map<number, string[]>();
  slideNames.forEach((name, index) => {
    slideTexts.set(
      slideNumber(name),
      extractTextNodes(slideXmlDocuments[index], "a:t"),
    );
  });

  const chartNames = Object.keys(zip.files)
    .filter((name) => /^ppt\/charts\/chart\d+\.xml$/u.test(name))
    .sort();
  const chartXml = (
    await Promise.all(chartNames.map((name) => zip.file(name)!.async("string")))
  ).join("\n");
  const chartTexts = [
    ...extractTextNodes(chartXml, "c:v"),
    ...extractTextNodes(chartXml, "a:t"),
  ];
  const nativeTexts = Array.from(slideTexts.values()).flat();

  const manifest = JSON.parse(
    await fs.readFile(manifestPath, "utf8"),
  ) as ConversionManifestData;
  const { securityMode, warnings } = manifestSecurity(manifest);
  const records = manifest.records ?? [];
  const missingProtectedText = findMissingProtectedText(
    records,
    slideTexts,
    chartTexts,
  );
  const undersizedTextBoxes = slideXmlDocuments.flatMap((xml, index) =>
    findUndersizedTextBoxes(xml, slideNumber(slideNames[index])),
  );

  const mediaFileCount = Object.keys(zip.files).filter((name) =>
    /^ppt\/media\/[^/]+$/u.test(name),
  ).length;
  const presentationXml =
    (await zip.file("ppt/presentation.xml")?.async("string")) ?? "";
  const rasterAudit = auditRasterUsage(
    records,
    slideXmlDocuments,
    mediaFileCount,
    presentationSlideSize(presentationXml),
  );

  const errors: string[] = [];
  if (missingProtectedText.length) {
    errors.push(
      `${missingProtectedText.length} protected text value(s) are missing from native OOXML`,
    );
  }
  if (rasterAudit.unauthorizedRasterRecords.length) {
    errors.push(
      `${rasterAudit.unauthorizedRasterRecords.length} unauthorized raster record(s) exist`,
    );
  }
  if (rasterAudit.unmanifestedMediaCount) {
    errors.push(
      `${rasterAudit.unmanifestedMediaCount} PPTX media file(s) have no authorized manifest record`,
    );
  }
  if (rasterAudit.fullSlideRasterCount) {
    errors.push(
      `${rasterAudit.fullSlideRasterCount} full-slide raster image(s) were detected`,
    );
  }

  return {
    ok: errors.length === 0,
    securityMode,
    warnings,
    pptxPath,
    manifestPath,
    slideCount: slideNames.length,
    nativeTexts,
    chartTexts,
    missingProtectedText,
    undersizedTextBoxes,
    unauthorizedRasterRecords: rasterAudit.unauthorizedRasterRecords,
    authorizedRasterRecords: rasterAudit.authorizedRasterRecords,
    mediaFileCount,
    unmanifestedMediaCount: rasterAudit.unmanifestedMediaCount,
    fullSlideRasterCount: rasterAudit.fullSlideRasterCount,
    errors,
  };
}
