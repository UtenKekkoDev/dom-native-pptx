import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { SaxesParser } from "saxes";
import { decodeXmlText } from "./native-text.js";

const EMU_PER_POINT = 12_700;
const PREFIX = String.raw`(?:[A-Za-z_][\w.-]*:)?`;
// OOXML stores a typeface but not its glyph metrics. These conservative
// sans-serif advances keep broad/narrow Latin glyphs distinct; full-width and
// non-Latin glyphs use one em below.
const LATIN_WIDE_EM = 0.85;
const LATIN_UPPERCASE_EM = 0.62;
const LATIN_DEFAULT_EM = 0.5;
const LATIN_NARROW_EM = 0.32;
const PRESENTATIONML_NAMESPACE =
  "http://schemas.openxmlformats.org/presentationml/2006/main";
const DRAWINGML_NAMESPACE =
  "http://schemas.openxmlformats.org/drawingml/2006/main";

export type TextBoxMeasurementReason =
  "insufficient-height" | "missing-measurement" | "norm-autofit-risk";

export interface UndersizedTextBox {
  slide: number;
  shapeName: string;
  widthEmu: number;
  heightEmu: number;
  fontSizePoints: number;
  requiredHeightEmu: number;
  reason: TextBoxMeasurementReason;
}

function elementContents(xml: string, localName: string): string | undefined {
  return xml.match(
    new RegExp(
      `<${PREFIX}${localName}\\b[^>]*>([\\s\\S]*?)<\\/${PREFIX}${localName}>`,
      "u",
    ),
  )?.[1];
}

const xmlSerializer = new XMLSerializer();

function assertStrictlyWellFormedXml(slideXml: string): void {
  try {
    const parser = new SaxesParser({ xmlns: true });
    parser.on("doctype", () => {
      throw new Error("DOCTYPE declarations are not allowed.");
    });
    parser.write(slideXml).close();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Invalid PresentationML slide XML: strict XML validation failed: ${message}`,
      { cause: error },
    );
  }
}

function parsePresentationSlide(slideXml: string): Document {
  assertStrictlyWellFormedXml(slideXml);
  const diagnostics: string[] = [];
  const document = new DOMParser({
    locator: {},
    errorHandler: (level: string, message: unknown) => {
      diagnostics.push(`${level}: ${String(message)}`);
    },
  }).parseFromString(slideXml, "application/xml");

  if (diagnostics.length) {
    throw new Error(
      `Invalid PresentationML slide XML:\n${diagnostics.join("\n")}`,
    );
  }

  const root = document.documentElement;
  if (
    root?.namespaceURI !== PRESENTATIONML_NAMESPACE ||
    root.localName !== "sld"
  ) {
    const actualNamespace = root?.namespaceURI ?? "unbound";
    const actualLocalName = root?.localName ?? "missing";
    throw new Error(
      "Invalid PresentationML slide root: " +
        `expected {${PRESENTATIONML_NAMESPACE}}sld; ` +
        `received {${actualNamespace}}${actualLocalName}.`,
    );
  }

  return document;
}

function directChild(
  parent: Element,
  namespace: string,
  localName: string,
): Element | undefined {
  for (
    let child = parent.firstChild;
    child !== null;
    child = child.nextSibling
  ) {
    if (child.nodeType !== 1) continue;
    const element = child as Element;
    if (element.namespaceURI === namespace && element.localName === localName) {
      return element;
    }
  }
  return undefined;
}

function firstDescendant(
  parent: Element,
  namespace: string,
  localName: string,
): Element | undefined {
  return (
    parent.getElementsByTagNameNS(namespace, localName).item(0) ?? undefined
  );
}

function maxFontSizePoints(xml: string): number | undefined {
  const sizes = Array.from(
    xml.matchAll(
      new RegExp(`<${PREFIX}(?:rPr|endParaRPr)\\b[^>]*\\bsz="(\\d+)"`, "gu"),
    ),
    (match) => Number(match[1]) / 100,
  ).filter(Number.isFinite);
  return sizes.length ? Math.max(...sizes) : undefined;
}

function pointsFromSpacing(
  xml: string | undefined,
  fontSizePoints: number,
): number {
  if (!xml) return 0;
  const points = xml.match(
    new RegExp(`<${PREFIX}spcPts\\b[^>]*\\bval="(\\d+)"`, "u"),
  );
  if (points) return Number(points[1]) / 100;
  const percent = xml.match(
    new RegExp(`<${PREFIX}spcPct\\b[^>]*\\bval="(\\d+)"`, "u"),
  );
  return percent ? (fontSizePoints * Number(percent[1])) / 100_000 : 0;
}

function textWidthPoints(text: string, fontSizePoints: number): number {
  let em = 0;
  for (const character of text) {
    if (/\s/u.test(character)) em += 0.28;
    else if (/[,.;:!?()[\]{}'"`|]/u.test(character)) em += 0.35;
    else if ((character.codePointAt(0) ?? 0) > 0xff) em += 1;
    else if (/[MW@#%&]/u.test(character)) em += LATIN_WIDE_EM;
    else if (/[ilIjtfr]/u.test(character)) em += LATIN_NARROW_EM;
    else if (/[A-Z]/u.test(character)) em += LATIN_UPPERCASE_EM;
    else em += LATIN_DEFAULT_EM;
  }
  return em * fontSizePoints;
}

function wrappedLineCount(
  text: string,
  widthPoints: number,
  fontSizePoints: number,
): number {
  const tokens = text.match(/\s+|\S+/gu) ?? [];
  if (!tokens.length) return 1;

  let lines = 1;
  let lineWidth = 0;
  let pendingWhitespace = 0;
  for (const token of tokens) {
    if (/^\s+$/u.test(token)) {
      pendingWhitespace += textWidthPoints(token, fontSizePoints);
      continue;
    }

    const tokenWidth = textWidthPoints(token, fontSizePoints);
    if (tokenWidth <= widthPoints) {
      const separatorWidth = lineWidth === 0 ? 0 : pendingWhitespace;
      if (
        lineWidth > 0 &&
        lineWidth + separatorWidth + tokenWidth > widthPoints
      ) {
        lines += 1;
        lineWidth = tokenWidth;
      } else {
        lineWidth += separatorWidth + tokenWidth;
      }
    } else {
      if (lineWidth > 0) {
        lines += 1;
        lineWidth = 0;
      }
      for (const character of token) {
        const characterWidth = textWidthPoints(character, fontSizePoints);
        if (lineWidth > 0 && lineWidth + characterWidth > widthPoints) {
          lines += 1;
          lineWidth = 0;
        }
        lineWidth += characterWidth;
      }
    }
    pendingWhitespace = 0;
  }
  return lines;
}

function paragraphHeightPoints(
  paragraphXml: string,
  widthPoints: number,
  fallbackFontSizePoints: number,
): number | undefined {
  const fontSizePoints =
    maxFontSizePoints(paragraphXml) ?? fallbackFontSizePoints;
  if (
    !Number.isFinite(fontSizePoints) ||
    fontSizePoints <= 0 ||
    widthPoints <= 0
  ) {
    return undefined;
  }
  const paragraphProperties = elementContents(paragraphXml, "pPr");
  const lineHeightPoints = Math.max(
    fontSizePoints,
    pointsFromSpacing(
      elementContents(paragraphProperties ?? "", "lnSpc"),
      fontSizePoints,
    ),
  );
  const beforePoints = pointsFromSpacing(
    elementContents(paragraphProperties ?? "", "spcBef"),
    fontSizePoints,
  );
  const afterPoints = pointsFromSpacing(
    elementContents(paragraphProperties ?? "", "spcAft"),
    fontSizePoints,
  );
  const segments = paragraphXml.split(
    new RegExp(`<${PREFIX}br\\b[^>]*\\/?>`, "gu"),
  );
  const lines = segments.reduce((total, segment) => {
    const text = Array.from(
      segment.matchAll(
        new RegExp(`<${PREFIX}t\\b[^>]*>([\\s\\S]*?)<\\/${PREFIX}t>`, "gu"),
      ),
      (match) => decodeXmlText(match[1]),
    ).join("");
    return total + wrappedLineCount(text, widthPoints, fontSizePoints);
  }, 0);
  return lines * lineHeightPoints + beforePoints + afterPoints;
}

function shapeMeasurement(
  shape: Element,
  slide: number,
): UndersizedTextBox | undefined {
  const nameElement = firstDescendant(shape, PRESENTATIONML_NAMESPACE, "cNvPr");
  const shapeName = nameElement?.getAttribute("name") ?? "";
  const spPr = directChild(shape, PRESENTATIONML_NAMESPACE, "spPr");
  const transform = spPr
    ? directChild(spPr, DRAWINGML_NAMESPACE, "xfrm")
    : undefined;
  const extent = transform
    ? directChild(transform, DRAWINGML_NAMESPACE, "ext")
    : undefined;
  const widthEmu = Number(extent?.getAttribute("cx") ?? "NaN");
  const heightEmu = Number(extent?.getAttribute("cy") ?? "NaN");
  const bodyElement = directChild(shape, PRESENTATIONML_NAMESPACE, "txBody");
  const body = bodyElement
    ? xmlSerializer.serializeToString(bodyElement)
    : undefined;
  const fontSizePoints = maxFontSizePoints(body ?? "");

  if (
    !body ||
    !Number.isFinite(widthEmu) ||
    widthEmu <= 0 ||
    !Number.isFinite(heightEmu) ||
    heightEmu <= 0 ||
    !Number.isFinite(fontSizePoints) ||
    fontSizePoints === undefined
  ) {
    return {
      slide,
      shapeName,
      widthEmu: Number.isFinite(widthEmu) ? widthEmu : 0,
      heightEmu: Number.isFinite(heightEmu) ? heightEmu : 0,
      fontSizePoints: fontSizePoints ?? 0,
      requiredHeightEmu: 0,
      reason: "missing-measurement",
    };
  }

  const widthPoints = widthEmu / EMU_PER_POINT;
  const paragraphs = Array.from(
    body.matchAll(
      new RegExp(`<${PREFIX}p\\b[^>]*>([\\s\\S]*?)<\\/${PREFIX}p>`, "gu"),
    ),
    (match) => match[0],
  );
  const requiredHeightPoints = paragraphs.reduce((total, paragraph) => {
    const height = paragraphHeightPoints(
      paragraph,
      widthPoints,
      fontSizePoints,
    );
    return height === undefined ? Number.NaN : total + height;
  }, 0);
  if (!paragraphs.length || !Number.isFinite(requiredHeightPoints)) {
    return {
      slide,
      shapeName,
      widthEmu,
      heightEmu,
      fontSizePoints,
      requiredHeightEmu: 0,
      reason: "missing-measurement",
    };
  }

  const requiredHeightEmu = Math.ceil(requiredHeightPoints * EMU_PER_POINT);
  const bodyProperties = elementContents(body, "bodyPr") ?? "";
  const hasNormAutofit = new RegExp(`<${PREFIX}normAutofit\\b`, "u").test(
    bodyProperties,
  );
  if (heightEmu >= requiredHeightEmu) {
    return undefined;
  }
  return {
    slide,
    shapeName,
    widthEmu,
    heightEmu,
    fontSizePoints,
    requiredHeightEmu,
    reason: hasNormAutofit ? "norm-autofit-risk" : "insufficient-height",
  };
}

export function findUndersizedTextBoxes(
  slideXml: string,
  slide: number,
): UndersizedTextBox[] {
  const results: UndersizedTextBox[] = [];
  const document = parsePresentationSlide(slideXml);
  const shapes = document.getElementsByTagNameNS(
    PRESENTATIONML_NAMESPACE,
    "sp",
  );

  for (let index = 0; index < shapes.length; index += 1) {
    const shape = shapes.item(index);
    if (!shape || !directChild(shape, PRESENTATIONML_NAMESPACE, "txBody"))
      continue;
    const measurement = shapeMeasurement(shape, slide);
    if (measurement !== undefined) results.push(measurement);
  }
  return results;
}
