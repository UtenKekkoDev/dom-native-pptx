import type { ConversionRecord } from "../types.js";

export interface MissingProtectedText {
  slide: number;
  selector: string;
  text: string;
  expectedOutputType: string;
}

export function decodeXmlText(value: string): string {
  return value
    .replace(/&#x([\da-f]+);/giu, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/gu, (_, decimal: string) =>
      String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

export function extractTextNodes(
  xml: string,
  tag = "a:t",
): string[] {
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const expression = new RegExp(
    `<${escapedTag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapedTag}>`,
    "gu",
  );
  return Array.from(xml.matchAll(expression))
    .map((match) => decodeXmlText(match[1]));
}

function normalize(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function containsText(haystack: string[], expected: string): boolean {
  const target = normalize(expected);
  if (!target) return true;
  const joined = normalize(haystack.join(" "));
  return joined.includes(target);
}

export function findMissingProtectedText(
  records: ConversionRecord[],
  slideTexts: Map<number, string[]>,
  chartTexts: string[],
): MissingProtectedText[] {
  const missing: MissingProtectedText[] = [];
  for (const record of records) {
    if (record.pptxOutputType === "native-text") {
      if (!containsText(slideTexts.get(record.slide) ?? [], record.text)) {
        missing.push({
          slide: record.slide,
          selector: record.selector,
          text: record.text,
          expectedOutputType: "native-text",
        });
      }
      continue;
    }

    if (record.pptxOutputType === "native-table") {
      const slideText = slideTexts.get(record.slide) ?? [];
      for (const cell of record.text.split("\n").filter(Boolean)) {
        if (!containsText(slideText, cell)) {
          missing.push({
            slide: record.slide,
            selector: record.selector,
            text: cell,
            expectedOutputType: "native-table",
          });
        }
      }
      continue;
    }

    if (record.pptxOutputType === "native-chart") {
      for (const value of record.text.split("\n").filter(Boolean)) {
        if (!containsText(chartTexts, value)) {
          missing.push({
            slide: record.slide,
            selector: record.selector,
            text: value,
            expectedOutputType: "native-chart",
          });
        }
      }
    }
  }
  return missing;
}
