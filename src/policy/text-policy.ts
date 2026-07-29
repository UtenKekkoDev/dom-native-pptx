import { PROTECTED_TEXT_TAGS, TEXT_ROLES } from "./semantic-contract.js";
import type { DomNodeSnapshot, TextRole } from "../types.js";

const TAG_ROLES: Readonly<Record<string, TextRole>> = {
  H1: "title",
  H2: "title",
  H3: "title",
  H4: "title",
  H5: "title",
  H6: "title",
  TH: "table-cell",
  TD: "table-cell",
  CAPTION: "caption",
  FIGCAPTION: "caption",
};

export function explicitTextRole(node: DomNodeSnapshot): TextRole | null {
  const explicit = node.attributes["data-pptx-text-role"];
  if (!explicit) return null;
  if (!TEXT_ROLES.has(explicit as TextRole)) {
    throw new ConversionPolicyTextError(
      node,
      `Unknown text role "${explicit}"`,
      "Use one of the documented data-pptx-text-role values.",
    );
  }
  return explicit as TextRole;
}

export function classifyTextRole(node: DomNodeSnapshot): TextRole | null {
  const explicit = explicitTextRole(node);
  if (explicit) return explicit;
  if (!node.ownText.trim() && !node.text.trim()) return null;
  return TAG_ROLES[node.tagName] ?? "body";
}

export function isSemanticTextNode(node: DomNodeSnapshot): boolean {
  if (!node.visible) return false;
  if (explicitTextRole(node)) return true;
  return PROTECTED_TEXT_TAGS.has(node.tagName) && Boolean(node.text.trim());
}

export function findProtectedText(
  node: DomNodeSnapshot,
  allowBrandWordmarkText = false,
): DomNodeSnapshot | null {
  if (!node.visible) return null;
  if (isSemanticTextNode(node)) return node;

  if (!allowBrandWordmarkText && node.ownText.trim()) {
    return node;
  }

  for (const child of node.children) {
    const protectedNode = findProtectedText(child, allowBrandWordmarkText);
    if (protectedNode) return protectedNode;
  }
  return null;
}

class ConversionPolicyTextError extends Error {
  constructor(node: DomNodeSnapshot, reason: string, repair: string) {
    super(
      `${reason}; slide=${node.slide}; selector=${node.selector}; ` +
        `repair=${repair}`,
    );
    this.name = "ConversionPolicyError";
  }
}
