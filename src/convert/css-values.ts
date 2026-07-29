export interface PptxColor {
  color: string;
  transparency: number;
}

function channel(value: string): number {
  const parsed = Number.parseFloat(value);
  return Math.max(0, Math.min(255, Math.round(parsed)));
}

export function cssColorToPptx(
  value: string | undefined,
  fallback = "000000",
): PptxColor {
  if (!value || value === "transparent") {
    return { color: fallback, transparency: 100 };
  }

  const hex = value.match(/^#([\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/iu);
  if (hex) {
    let raw = hex[1];
    if (raw.length === 3)
      raw = raw
        .split("")
        .map((part) => part + part)
        .join("");
    const alpha =
      raw.length === 8 ? Number.parseInt(raw.slice(6, 8), 16) / 255 : 1;
    return {
      color: raw.slice(0, 6).toUpperCase(),
      transparency: Math.round((1 - alpha) * 100),
    };
  }

  const rgb = value.match(
    /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/iu,
  );
  if (!rgb) return { color: fallback, transparency: 0 };

  const color = rgb
    .slice(1, 4)
    .map((part) => channel(part).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
  const alphaValue = rgb[4];
  const alpha = alphaValue
    ? alphaValue.endsWith("%")
      ? Number.parseFloat(alphaValue) / 100
      : Number.parseFloat(alphaValue)
    : 1;
  return {
    color,
    transparency: Math.round((1 - Math.max(0, Math.min(1, alpha))) * 100),
  };
}

export function firstFontFamily(value: string | undefined): string {
  const first = (value || "Microsoft YaHei").split(",")[0].trim();
  return first.replace(/^['"]|['"]$/gu, "");
}
