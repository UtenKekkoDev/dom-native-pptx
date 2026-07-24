import { describe, expect, it } from "vitest";
import { VERSION } from "../src/index.js";

describe("package bootstrap", () => {
  it("exports a semantic version", () => {
    expect(VERSION).toMatch(
      /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
    );
  });
});
