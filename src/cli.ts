#!/usr/bin/env node
import path from "node:path";
import { Command } from "commander";
import { VERSION } from "./index.js";
import { snapshotDeck } from "./browser/dom-snapshot.js";
import { createErrorReport } from "./report/error-report.js";
import { exportDeck } from "./pipeline/export-deck.js";
import { preflight } from "./pipeline/preflight.js";
import type { SecurityMode } from "./types.js";
import { inspectPptx } from "./validate/pptx-xml.js";
import { renderHtmlSlides } from "./validate/html-renderer.js";
import { compareImages } from "./validate/visual-diff.js";

const program = new Command();
program
  .name("dom-native-pptx")
  .description("Convert slide-safe HTML DOM into native editable PowerPoint")
  .version(VERSION);

interface TrustedOptions {
  trusted?: boolean;
}

function securityMode(options: TrustedOptions): SecurityMode {
  return options.trusted ? "trusted" : "safe";
}

program
  .command("export")
  .argument("<input>", "slide-safe HTML file")
  .argument("[output]", "output .pptx path (positional npm fallback)")
  .option("-o, --output <file>", "output .pptx path")
  .option("--trusted", "allow JavaScript and remote resources for audited HTML")
  .action(
    async (
      input: string,
      positionalOutput: string | undefined,
      options: { output?: string } & TrustedOptions,
    ) => {
      const output = options.output || positionalOutput;
      if (!output) {
        throw new Error(
          "An output .pptx path is required (-o, --output, or positional)",
        );
      }
      const mode = securityMode(options);
      const result = await exportDeck({
        input: path.resolve(input),
        output: path.resolve(output),
        securityMode: mode,
      });
      process.stdout.write(
        `${JSON.stringify(
          {
            ok: true,
            output: result.output,
            manifest: result.manifestPath,
            validationJson: result.validationJsonPath,
            validationHtml: result.validationHtmlPath,
            records: result.manifest.records.length,
            securityMode: mode,
          },
          null,
          2,
        )}\n`,
      );
    },
  );

program
  .command("inspect")
  .argument("<pptx>", "PowerPoint file")
  .option("-m, --manifest <file>", "conversion manifest path")
  .action(async (pptx: string, options: { manifest?: string }) => {
    const pptxPath = path.resolve(pptx);
    const manifestPath = path.resolve(
      options.manifest ??
        pptxPath.replace(/\.pptx$/iu, ".conversion-manifest.json"),
    );
    const report = await inspectPptx(pptxPath, manifestPath);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.ok) process.exitCode = 1;
  });

program
  .command("render-html")
  .argument("<input>", "slide-safe HTML file")
  .argument("[output]", "PNG output directory (positional npm fallback)")
  .option("-o, --output <directory>", "PNG output directory")
  .option("--trusted", "allow JavaScript and remote resources for audited HTML")
  .action(
    async (
      input: string,
      positionalOutput: string | undefined,
      options: { output?: string } & TrustedOptions,
    ) => {
      const output = options.output || positionalOutput;
      if (!output)
        throw new Error("An HTML render output directory is required");
      const mode = securityMode(options);
      const result = await renderHtmlSlides(
        path.resolve(input),
        path.resolve(output),
        { securityMode: mode },
      );
      process.stdout.write(
        `${JSON.stringify(
          {
            ...result,
            securityMode: mode,
          },
          null,
          2,
        )}\n`,
      );
    },
  );

program
  .command("compare")
  .argument("<expected>", "expected PNG")
  .argument("<actual>", "actual PNG")
  .argument("[output]", "diff PNG path (positional npm fallback)")
  .option("-o, --output <file>", "diff PNG output path")
  .action(
    async (
      expected: string,
      actual: string,
      positionalOutput: string | undefined,
      options: { output?: string },
    ) => {
      const output = options.output || positionalOutput;
      if (!output) throw new Error("A visual diff output path is required");
      const result = await compareImages(
        path.resolve(expected),
        path.resolve(actual),
        path.resolve(output),
      );
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    },
  );

program
  .command("validate")
  .argument("<input>", "slide-safe HTML file")
  .option("--trusted", "allow JavaScript and remote resources for audited HTML")
  .action(async (input: string, options: TrustedOptions) => {
    const mode = securityMode(options);
    const slides = await snapshotDeck(path.resolve(input), {
      securityMode: mode,
    });
    preflight(slides);
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          slides: slides.length,
          securityMode: mode,
        },
        null,
        2,
      )}\n`,
    );
  });

try {
  await program.parseAsync();
} catch (error) {
  process.stderr.write(
    `${JSON.stringify(createErrorReport(error), null, 2)}\n`,
  );
  process.exitCode = 1;
}
