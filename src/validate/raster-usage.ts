import type { ConversionRecord } from "../types.js";

export interface RasterAudit {
  unauthorizedRasterRecords: ConversionRecord[];
  authorizedRasterRecords: ConversionRecord[];
  fullSlideRasterCount: number;
  mediaFileCount: number;
  unmanifestedMediaCount: number;
}

function fullSlidePictures(
  slideXml: string,
  slideWidth: number,
  slideHeight: number,
): number {
  let count = 0;
  for (const match of slideXml.matchAll(/<p:pic>[\s\S]*?<\/p:pic>/gu)) {
    const picture = match[0];
    const offset = picture.match(/<a:off\s+x="(\d+)"\s+y="(\d+)"\s*\/>/u);
    const extent = picture.match(/<a:ext\s+cx="(\d+)"\s+cy="(\d+)"\s*\/>/u);
    if (!offset || !extent) continue;
    const [x, y] = offset.slice(1).map(Number);
    const [width, height] = extent.slice(1).map(Number);
    if (
      x <= slideWidth * 0.01 &&
      y <= slideHeight * 0.01 &&
      width >= slideWidth * 0.98 &&
      height >= slideHeight * 0.98
    ) {
      count += 1;
    }
  }
  return count;
}

export function auditRasterUsage(
  records: ConversionRecord[],
  slideXmlDocuments: string[],
  mediaFileCount: number,
  slideSize: { width: number; height: number },
): RasterAudit {
  const unauthorizedRasterRecords = records.filter((record) =>
    record.rasterized && !record.rasterAuthorized);
  const authorizedRasterRecords = records.filter((record) =>
    record.rasterized && record.rasterAuthorized);
  const fullSlideRasterCount = slideXmlDocuments.reduce(
    (total, xml) =>
      total + fullSlidePictures(xml, slideSize.width, slideSize.height),
    0,
  );
  return {
    unauthorizedRasterRecords,
    authorizedRasterRecords,
    fullSlideRasterCount,
    mediaFileCount,
    unmanifestedMediaCount: Math.max(
      0,
      mediaFileCount - authorizedRasterRecords.length,
    ),
  };
}
