import type { RasterRole, TextRole } from "../types.js";

export const TEXT_ROLES = new Set<TextRole>([
  "title",
  "subtitle",
  "body",
  "caption",
  "number",
  "table-cell",
  "chart-label",
  "footnote",
  "footer",
  "page-number",
  "source",
]);

export const RASTER_ROLES = new Set<RasterRole>([
  "logo",
  "brand-lockup",
  "photo",
  "illustration",
  "decorative-composite",
]);

export const PROTECTED_TEXT_TAGS = new Set([
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "P",
  "LI",
  "BLOCKQUOTE",
  "TH",
  "TD",
  "CAPTION",
  "FIGCAPTION",
]);
