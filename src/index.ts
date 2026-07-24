export const VERSION = "0.2.0-beta.1";

export { snapshotDeck } from "./browser/dom-snapshot.js";
export {
  exportDeck,
  type ExportOptions,
  type ExportResult,
} from "./pipeline/export-deck.js";
export { preflight } from "./pipeline/preflight.js";
export {
  inspectPptx,
  type ValidationReport,
} from "./validate/pptx-xml.js";
export type {
  ConversionErrorDetails,
  ConversionRecord,
  DomNodeSnapshot,
  PptxOutputType,
  RasterDecision,
  RasterRole,
  RectPx,
  TextRole,
  VisualEffectDisposition,
  VisualEffectFinding,
} from "./types.js";
