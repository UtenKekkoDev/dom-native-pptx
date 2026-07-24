import { describe, expect, it } from "vitest";
import {
  addNativeChart,
  parseChartConfig,
} from "../../src/convert/chart-converter.js";
import {
  addNativeTable,
  extractTableRows,
} from "../../src/convert/table-converter.js";
import { ConversionManifest } from "../../src/pipeline/manifest.js";
import type { DomNodeSnapshot } from "../../src/types.js";

function node(overrides: Partial<DomNodeSnapshot> = {}): DomNodeSnapshot {
  return {
    slide: 1,
    selector: "#node",
    tagName: "DIV",
    id: "node",
    text: "",
    ownText: "",
    visible: true,
    attributes: {},
    rect: { x: 120, y: 200, width: 800, height: 400 },
    style: {},
    children: [],
    ...overrides,
  };
}

describe("native chart contract", () => {
  it("accepts a native bar chart declaration with editable series", () => {
    expect(parseChartConfig(JSON.stringify({
      type: "bar",
      data: [{ name: "收入", labels: ["Q1", "Q2"], values: [10, 20] }],
    }))).toEqual({
      type: "bar",
      data: [{ name: "收入", labels: ["Q1", "Q2"], values: [10, 20] }],
    });
  });

  it("rejects a chart without editable data series", () => {
    expect(() => parseChartConfig(JSON.stringify({
      type: "bar",
      data: [],
    }))).toThrow(/editable data series/i);
  });

  it("rejects series with mismatched label and value lengths", () => {
    expect(() => parseChartConfig(JSON.stringify({
      type: "line",
      data: [{ name: "用户", labels: ["1月", "2月"], values: [100] }],
    }))).toThrow(/same number of labels and values/i);
  });

  it("adds an editable chart object and manifest record", () => {
    let call: {
      type: string;
      data: unknown[];
      options: Record<string, unknown>;
    } | undefined;
    const slide = {
      addChart(
        type: string,
        data: unknown[],
        options: Record<string, unknown>,
      ) {
        call = { type, data, options };
        const first = data[0] as { labels: string[] };
        first.labels = [first.labels.join(",")];
      },
    };
    const chartNode = node({
      selector: "#chart",
      attributes: {
        "data-pptx-chart-config": JSON.stringify({
          type: "line",
          data: [{ name: "用户", labels: ["1月", "2月"], values: [100, 130] }],
        }),
      },
    });
    const manifest = new ConversionManifest();

    addNativeChart(slide, chartNode, manifest);

    expect(call?.type).toBe("line");
    expect(call?.data).toHaveLength(1);
    expect(call?.options).toMatchObject({
      showLegend: true,
      showTitle: false,
    });
    expect(manifest.records[0]?.pptxOutputType).toBe("native-chart");
    expect(manifest.records[0]?.text).toBe(
      "用户\n1月\n2月\n100\n130",
    );
  });
  it("maps the public column type to a PptxGenJS bar chart with column direction", () => {
    let call: {
      type: string;
      options: Record<string, unknown>;
    } | undefined;
    const slide = {
      addChart(
        type: string,
        _data: unknown[],
        options: Record<string, unknown>,
      ) {
        call = { type, options };
      },
    };
    const chartNode = node({
      selector: "#column-chart",
      attributes: {
        "data-pptx-chart-config": JSON.stringify({
          type: "column",
          data: [{ name: "Growth", labels: ["NA", "APAC"], values: [38, 52] }],
        }),
      },
    });

    addNativeChart(slide, chartNode, new ConversionManifest());

    expect(call?.type).toBe("bar");
    expect(call?.options).toMatchObject({ barDir: "col" });
  });
});

describe("native table contract", () => {
  it("extracts editable rows from a semantic table snapshot", () => {
    const table = node({
      tagName: "TABLE",
      selector: "#table",
      children: [
        node({
          tagName: "THEAD",
          children: [
            node({
              tagName: "TR",
              children: [
                node({ tagName: "TH", text: "地区", ownText: "地区" }),
                node({ tagName: "TH", text: "收入", ownText: "收入" }),
              ],
            }),
          ],
        }),
        node({
          tagName: "TBODY",
          children: [
            node({
              tagName: "TR",
              children: [
                node({ tagName: "TD", text: "亚太", ownText: "亚太" }),
                node({ tagName: "TD", text: "120", ownText: "120" }),
              ],
            }),
          ],
        }),
      ],
    });

    expect(extractTableRows(table)).toEqual([
      ["地区", "收入"],
      ["亚太", "120"],
    ]);
  });

  it("adds a native table and records all editable cell text", () => {
    let call: {
      rows: string[][];
      options: Record<string, unknown>;
    } | undefined;
    const slide = {
      addTable(rows: string[][], options: Record<string, unknown>) {
        call = { rows, options };
      },
    };
    const manifest = new ConversionManifest();
    const table = node({ tagName: "TABLE", selector: "#table" });

    addNativeTable(
      slide,
      table,
      [["地区", "收入"], ["亚太", "120"]],
      manifest,
    );

    expect(call?.rows).toEqual([["地区", "收入"], ["亚太", "120"]]);
    expect(call?.options).toMatchObject({
      fontFace: "Microsoft YaHei",
      fontSize: 12,
    });
    expect(manifest.records[0]).toMatchObject({
      pptxOutputType: "native-table",
      text: "地区\n收入\n亚太\n120",
    });
  });
});
