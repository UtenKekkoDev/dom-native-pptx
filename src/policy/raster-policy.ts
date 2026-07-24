import { RASTER_ROLES } from "./semantic-contract.js";
import { findProtectedText } from "./text-policy.js";
import {
  ConversionPolicyError,
  type DomNodeSnapshot,
  type RasterDecision,
  type RasterRole,
} from "../types.js";

function preview(text: string): string {
  return text.trim().replace(/\s+/gu, " ").slice(0, 120);
}

export function evaluateRasterPolicy(node: DomNodeSnapshot): RasterDecision {
  if (node.attributes["data-pptx-raster"] !== "allowed") {
    throw new ConversionPolicyError({
      code: "RASTER_NOT_EXPLICITLY_ALLOWED",
      slide: node.slide,
      selector: node.selector,
      textPreview: preview(node.text),
      reason: "Element is not in the explicit raster whitelist",
      suggestedRepair:
        'Add data-pptx-raster="allowed" only when this is an approved visual asset.',
    });
  }

  const roleValue = node.attributes["data-pptx-raster-role"];
  if (!RASTER_ROLES.has(roleValue as RasterRole)) {
    throw new ConversionPolicyError({
      code: "RASTER_ROLE_NOT_APPROVED",
      slide: node.slide,
      selector: node.selector,
      textPreview: preview(node.text),
      reason: `Element does not declare an approved raster role "${roleValue ?? ""}"`,
      suggestedRepair:
        "Use logo, brand-lockup, photo, illustration, or decorative-composite.",
    });
  }

  const role = roleValue as RasterRole;
  const protectedNode = findProtectedText(node, role === "brand-lockup");
  if (protectedNode) {
    throw new ConversionPolicyError({
      code: "PROTECTED_TEXT_IN_RASTER",
      slide: protectedNode.slide,
      selector: protectedNode.selector,
      textPreview: preview(protectedNode.ownText || protectedNode.text),
      reason: "Rasterization would include protected text",
      suggestedRepair:
        "Move semantic text outside the raster container and map it to native PowerPoint text.",
    });
  }

  return {
    allowed: true,
    role,
    reason: "explicit-whitelist",
  };
}
