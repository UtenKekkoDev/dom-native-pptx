import type { ConversionRecord } from "../types.js";

interface ExpectedText {
  slide: number;
  selector: string;
  text: string;
}

export class ConversionManifest {
  readonly records: ConversionRecord[] = [];
  private readonly expectedText = new Map<string, ExpectedText>();

  expectText(slide: number, selector: string, text: string): void {
    this.expectedText.set(`${slide}:${selector}`, { slide, selector, text });
  }

  add(record: ConversionRecord): void {
    this.records.push(record);
  }

  assertComplete(): void {
    for (const expected of this.expectedText.values()) {
      const found = this.records.some((record) =>
        record.slide === expected.slide &&
        record.selector === expected.selector &&
        record.pptxOutputType === "native-text" &&
        record.text === expected.text &&
        !record.rasterized);
      if (!found) {
        throw new Error(
          `Missing native text record: slide=${expected.slide}; ` +
          `selector=${expected.selector}; text="${expected.text.slice(0, 120)}"`,
        );
      }
    }
  }
}
