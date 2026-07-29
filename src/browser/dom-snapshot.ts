import type { DomNodeSnapshot, SecurityMode } from "../types.js";
import { openSlidePage } from "./slide-page-session.js";

const STYLE_PROPERTIES = [
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "color",
  "backgroundColor",
  "backgroundImage",
  "borderTopColor",
  "borderRightColor",
  "borderBottomColor",
  "borderLeftColor",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "borderRadius",
  "textAlign",
  "verticalAlign",
  "lineHeight",
  "letterSpacing",
  "textDecorationLine",
  "textShadow",
  "textTransform",
  "whiteSpace",
  "opacity",
  "transform",
  "transformOrigin",
  "boxShadow",
  "filter",
  "clipPath",
  "maskImage",
  "mixBlendMode",
  "isolation",
  "zIndex",
  "overflow",
] as const;

/** @deprecated Pass the selector through `SnapshotOptions` instead. */
export function snapshotDeck(
  inputPath: string,
  selector: string,
): Promise<DomNodeSnapshot[][]>;
export function snapshotDeck(
  inputPath: string,
  options?: SnapshotOptions,
): Promise<DomNodeSnapshot[][]>;
export async function snapshotDeck(
  inputPath: string,
  optionsOrSelector: SnapshotOptions | string = {},
): Promise<DomNodeSnapshot[][]> {
  const options =
    typeof optionsOrSelector === "string"
      ? { selector: optionsOrSelector }
      : optionsOrSelector;
  const selector = options.selector ?? ".pptx-slide";
  const session = await openSlidePage({
    inputPath,
    securityMode: options.securityMode,
    timeoutMs: options.timeoutMs,
  });
  try {
    const { page } = session;

    const count = await page.locator(selector).count();
    if (count === 0) {
      throw new Error(`No ${selector} elements were found in ${inputPath}`);
    }

    // Use a literal browser script instead of a serialized TypeScript callback.
    // The latter can inherit bundler helpers (for example `__name`) that do not
    // exist inside Chromium when the CLI is executed through tsx.
    const browserScript = String.raw`
      (() => {
        const slideSelector = ${JSON.stringify(selector)};
        const styleProperties = ${JSON.stringify(STYLE_PROPERTIES)};
        const slides = Array.from(document.querySelectorAll(slideSelector));

        const elementSelector = (element, slide) => {
          if (element.id) return "#" + CSS.escape(element.id);
          const parts = [];
          let current = element;
          while (current && current !== slide) {
            const siblings = current.parentElement
              ? Array.from(current.parentElement.children)
                .filter((item) => item.tagName === current.tagName)
              : [];
            const suffix = siblings.length > 1
              ? ":nth-of-type(" + (siblings.indexOf(current) + 1) + ")"
              : "";
            parts.unshift(current.tagName.toLowerCase() + suffix);
            current = current.parentElement;
          }
          return ":scope > " + parts.join(" > ");
        };

        const directText = (element) =>
          Array.from(element.childNodes)
            .filter((child) => child.nodeType === Node.TEXT_NODE)
            .map((child) => child.textContent || "")
            .join("")
            .replace(/\s+/gu, " ")
            .trim();

        const textWithBreaks = (element) => {
          const visit = (node) => {
            if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
            if (node.nodeType !== Node.ELEMENT_NODE) return "";
            if (node.tagName === "BR") return "\n";
            return Array.from(node.childNodes).map(visit).join("");
          };
          return visit(element)
            .replace(/[ \t\f\v]+/gu, " ")
            .replace(/ *\n */gu, "\n")
            .trim();
        };

        const mapNode = (element, slide, slideNumber, slideRect) => {
          const rect = element.getBoundingClientRect();
          const computed = getComputedStyle(element);
          const style = Object.fromEntries(
            styleProperties.map((property) => [property, computed[property]]),
          );
          style.beforeContent = getComputedStyle(element, "::before").content;
          style.afterContent = getComputedStyle(element, "::after").content;
          const measurementCanvas = document.createElement("canvas");
          const measurementContext = measurementCanvas.getContext("2d");
          if (measurementContext) {
            measurementContext.font = [
              computed.fontStyle,
              computed.fontWeight,
              computed.fontSize,
              computed.fontFamily,
            ].join(" ");
            const rawText = textWithBreaks(element);
            const letterSpacing = Number.parseFloat(computed.letterSpacing || "0");
            const naturalWidth = Math.max(
              ...rawText.split("\n").map((line) =>
                measurementContext.measureText(line).width +
                Math.max(0, line.length - 1) *
                  (Number.isFinite(letterSpacing) ? letterSpacing : 0)),
              0,
            );
            style.pptxTextNaturalWidth = naturalWidth + "px";
          }
          return {
            slide: slideNumber,
            selector: elementSelector(element, slide),
            tagName: element.tagName,
            id: element.id,
            text: textWithBreaks(element),
            ownText: directText(element),
            visible:
              rect.width > 0 &&
              rect.height > 0 &&
              computed.visibility !== "hidden" &&
              computed.display !== "none" &&
              Number.parseFloat(computed.opacity || "1") > 0,
            attributes: Object.fromEntries(
              Array.from(element.attributes).map((attribute) => [
                attribute.name,
                attribute.value,
              ]),
            ),
            rect: {
              x: rect.x - slideRect.x,
              y: rect.y - slideRect.y,
              width: rect.width,
              height: rect.height,
            },
            style,
            children: Array.from(element.children).map((child) =>
              mapNode(child, slide, slideNumber, slideRect)),
          };
        };

        return slides.map((slide, index) => {
          const slideRect = slide.getBoundingClientRect();
          const slideComputed = getComputedStyle(slide);
          const background = {
            slide: index + 1,
            selector: ":scope",
            tagName: "PPTX-SLIDE-BACKGROUND",
            id: "",
            text: "",
            ownText: "",
            visible: true,
            attributes: {},
            rect: {
              x: 0,
              y: 0,
              width: slideRect.width,
              height: slideRect.height,
            },
            style: Object.fromEntries(
              styleProperties.map((property) => [
                property,
                slideComputed[property],
              ]),
            ),
            children: [],
          };
          return [
            background,
            ...Array.from(slide.children).map((element) =>
              mapNode(element, slide, index + 1, slideRect)),
          ];
        });
      })()
    `;
    return await page.evaluate<DomNodeSnapshot[][]>(browserScript);
  } finally {
    await session.close();
  }
}

export interface SnapshotOptions {
  selector?: string;
  securityMode?: SecurityMode;
  timeoutMs?: number;
}
