export type TextRole =
  | "title"
  | "subtitle"
  | "body"
  | "caption"
  | "number"
  | "table-cell"
  | "chart-label"
  | "footnote"
  | "footer"
  | "page-number"
  | "source";

export type RasterRole =
  "logo" | "brand-lockup" | "photo" | "illustration" | "decorative-composite";

export type SecurityMode = "safe" | "trusted";

export interface SecurityPolicyErrorDetails {
  code:
    | "SECURITY_REMOTE_RESOURCE_BLOCKED"
    | "SECURITY_LOCAL_PATH_ESCAPE"
    | "SECURITY_IFRAME_BLOCKED"
    | "SECURITY_DATA_URL_BLOCKED"
    | "SECURITY_TRUSTED_MODE_REQUIRED"
    | "SECURITY_RESOURCE_TIMEOUT";
  resourceType: string;
  resourceLocation: string;
  inputPath: string;
  securityMode: SecurityMode;
  suggestedRepair: string;
}

export interface RectPx {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DomNodeSnapshot {
  slide: number;
  selector: string;
  tagName: string;
  id: string;
  text: string;
  ownText: string;
  visible: boolean;
  attributes: Record<string, string>;
  rect: RectPx;
  style: Record<string, string>;
  children: DomNodeSnapshot[];
}

export interface RasterDecision {
  allowed: true;
  role: RasterRole;
  reason: "explicit-whitelist";
}

export type VisualEffectDisposition =
  "native" | "approximation" | "requires-raster" | "reject";

export interface VisualEffectFinding {
  property: string;
  disposition: VisualEffectDisposition;
  message: string;
}

export type PptxOutputType =
  "native-text" | "native-shape" | "native-table" | "native-chart" | "image";

export interface ConversionRecord {
  slide: number;
  selector: string;
  domType: string;
  semanticRole: TextRole | RasterRole | null;
  text: string;
  pptxOutputType: PptxOutputType;
  pptxObjectId: string;
  rasterized: boolean;
  rasterAuthorized: boolean;
  rasterReason: string | null;
  outputAsset: string | null;
  warnings: string[];
}

export interface ConversionErrorDetails {
  code: string;
  slide: number;
  selector: string;
  textPreview: string;
  reason: string;
  suggestedRepair: string;
}

export class ConversionPolicyError extends Error {
  readonly details: ConversionErrorDetails;

  constructor(details: ConversionErrorDetails) {
    super(
      `${details.reason}; slide=${details.slide}; selector=${details.selector}; ` +
        `text="${details.textPreview}"`,
    );
    this.name = "ConversionPolicyError";
    this.details = details;
  }
}
