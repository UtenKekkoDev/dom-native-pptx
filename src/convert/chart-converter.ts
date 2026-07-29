import { z } from "zod";
import type { DomNodeSnapshot } from "../types.js";
import type { ConversionManifest } from "../pipeline/manifest.js";
import { HTML_CANVAS, pxRectToInches } from "./unit-converter.js";

const ChartSeriesSchema = z
  .object({
    name: z.string().min(1),
    labels: z.array(z.string()).min(1),
    values: z.array(z.number()).min(1),
  })
  .superRefine((series, context) => {
    if (series.labels.length !== series.values.length) {
      context.addIssue({
        code: "custom",
        message:
          "A chart series must contain the same number of labels and values",
      });
    }
  });

const ChartConfigSchema = z.object({
  type: z.enum(["bar", "column", "line", "pie", "doughnut"]),
  data: z
    .array(ChartSeriesSchema)
    .min(1, "At least one editable data series is required"),
  showLegend: z.boolean().optional(),
  showValue: z.boolean().optional(),
});

export type ChartConfig = z.infer<typeof ChartConfigSchema>;

export interface ChartSlideTarget {
  addChart(
    type: string,
    data: Array<{ name: string; labels: string[]; values: number[] }>,
    options: Record<string, unknown>,
  ): unknown;
}

export function parseChartConfig(value: string): ChartConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(
      `Invalid data-pptx-chart-config JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }
  return ChartConfigSchema.parse(parsed);
}

export function addNativeChart(
  slide: ChartSlideTarget,
  node: DomNodeSnapshot,
  manifest: ConversionManifest,
): void {
  const config = parseChartConfig(
    node.attributes["data-pptx-chart-config"] ?? "",
  );
  const rect = pxRectToInches(node.rect, HTML_CANVAS);
  const chartText = config.data
    .flatMap((series) => [
      series.name,
      ...series.labels,
      ...series.values.map(String),
    ])
    .join("\n");
  const chartData = config.data.map((series) => ({
    name: series.name,
    labels: [...series.labels],
    values: [...series.values],
  }));
  const pptxType = config.type === "column" ? "bar" : config.type;
  const barDirection =
    config.type === "column"
      ? { barDir: "col" }
      : config.type === "bar"
        ? { barDir: "bar" }
        : {};
  slide.addChart(pptxType, chartData, {
    x: rect.x,
    y: rect.y,
    w: rect.width,
    h: rect.height,
    showTitle: false,
    showLegend: config.showLegend ?? true,
    showValue: config.showValue ?? false,
    showCategoryName: false,
    showSerName: false,
    fontFace: "Microsoft YaHei",
    ...barDirection,
  });

  manifest.add({
    slide: node.slide,
    selector: node.selector,
    domType: node.tagName,
    semanticRole: "chart-label",
    text: chartText,
    pptxOutputType: "native-chart",
    pptxObjectId: `slide-${node.slide}-chart-${manifest.records.length + 1}`,
    rasterized: false,
    rasterAuthorized: false,
    rasterReason: null,
    outputAsset: null,
    warnings: [],
  });
}
