import type { DomNodeSnapshot } from "../types.js";

function numericZIndex(node: DomNodeSnapshot): number {
  const value = Number.parseInt(node.style.zIndex ?? "auto", 10);
  return Number.isFinite(value) ? value : 0;
}

export function orderSiblingsForPptx(
  nodes: readonly DomNodeSnapshot[],
): DomNodeSnapshot[] {
  return nodes
    .map((node, index) => ({ node, index }))
    .sort(
      (left, right) =>
        numericZIndex(left.node) - numericZIndex(right.node) ||
        left.index - right.index,
    )
    .map(({ node }) => node);
}
