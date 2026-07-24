import type {
  DomNodeSnapshot,
  VisualEffectDisposition,
  VisualEffectFinding,
} from "../types.js";

interface VisualEffectRule {
  styleKey: string;
  property: string;
  inactive: ReadonlySet<string>;
  disposition: VisualEffectDisposition;
  message: string;
}

const NONE = new Set(["", "none"]);
const NORMAL = new Set(["", "normal"]);

const RULES: readonly VisualEffectRule[] = [
  {
    styleKey: "backgroundImage",
    property: "background-image",
    inactive: NONE,
    disposition: "requires-raster",
    message:
      "CSS background images and gradients require an isolated visual-only raster node.",
  },
  {
    styleKey: "boxShadow",
    property: "box-shadow",
    inactive: NONE,
    disposition: "approximation",
    message: "CSS box shadows are not reproduced by the native shape converter.",
  },
  {
    styleKey: "textShadow",
    property: "text-shadow",
    inactive: NONE,
    disposition: "approximation",
    message: "Text remains native, but CSS text shadow is not reproduced.",
  },
  {
    styleKey: "transform",
    property: "transform",
    inactive: NONE,
    disposition: "approximation",
    message: "Complex CSS transforms are flattened to the measured axis-aligned bounds.",
  },
  {
    styleKey: "filter",
    property: "filter",
    inactive: NONE,
    disposition: "requires-raster",
    message: "CSS filters require an isolated visual-only raster node.",
  },
  {
    styleKey: "clipPath",
    property: "clip-path",
    inactive: NONE,
    disposition: "requires-raster",
    message: "CSS clip paths require an isolated visual-only raster node.",
  },
  {
    styleKey: "maskImage",
    property: "mask-image",
    inactive: NONE,
    disposition: "requires-raster",
    message: "CSS masks require an isolated visual-only raster node.",
  },
  {
    styleKey: "mixBlendMode",
    property: "mix-blend-mode",
    inactive: NORMAL,
    disposition: "requires-raster",
    message: "CSS blend modes require an isolated visual-only raster node.",
  },
];

function normalized(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export function classifyVisualEffects(
  node: DomNodeSnapshot,
): VisualEffectFinding[] {
  const findings: VisualEffectFinding[] = [];
  for (const rule of RULES) {
    if (rule.inactive.has(normalized(node.style[rule.styleKey]))) continue;
    findings.push({
      property: rule.property,
      disposition: rule.disposition,
      message: rule.message,
    });
  }

  const borderSides = ["Top", "Right", "Bottom", "Left"].map((side) => ({
    width: normalized(node.style[`border${side}Width`]),
    color: normalized(node.style[`border${side}Color`]),
  }));
  const borderSignatures = new Set(
    borderSides.map((side) => `${side.width || "0px"}|${side.color}`),
  );
  const hasVisibleBorder = borderSides.some(
    (side) => Number.parseFloat(side.width || "0") > 0,
  );
  if (hasVisibleBorder && borderSignatures.size > 1) {
    findings.push({
      property: "border-sides",
      disposition: "approximation",
      message:
        "PowerPoint native shapes use one uniform outline; asymmetric CSS border sides are approximated.",
    });
  }
  return findings;
}

export function visualEffectWarnings(node: DomNodeSnapshot): string[] {
  return classifyVisualEffects(node).map(
    (finding) =>
      `[${finding.disposition}] ${finding.property}: ${finding.message}`,
  );
}
