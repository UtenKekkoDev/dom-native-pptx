import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  absolute,
  projectRoot,
  requireArgs,
  runCli,
} from "./_runner.mjs";

const [inputValue, outputValue] = process.argv.slice(2);
requireArgs([inputValue, outputValue], "node qa.mjs <slides.html> <output.pptx>");

const input = absolute(inputValue);
const output = absolute(outputValue);
const stem = output.replace(/\.pptx$/iu, "");
const htmlDir = `${stem}.html-render`;
const powerpointDir = `${stem}.powerpoint-render`;
const diffDir = `${stem}.diff`;

runCli("validate", [input]);
runCli("export", [input, output]);
runCli("render-html", [input, htmlDir]);

const powerpoint = spawnSync(
  "powershell.exe",
  [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    path.join(projectRoot, "src", "validate", "powerpoint-validator.ps1"),
    "-Pptx",
    output,
    "-OutputDir",
    powerpointDir,
  ],
  {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  },
);
if (powerpoint.status !== 0) {
  process.stderr.write(powerpoint.stderr || powerpoint.stdout || "");
  process.exit(powerpoint.status ?? 1);
}

fs.mkdirSync(diffDir, { recursive: true });
const htmlFiles = fs.readdirSync(htmlDir).filter((file) => /\.png$/iu.test(file)).sort();
const powerpointFiles = fs.readdirSync(powerpointDir).filter((file) => /\.png$/iu.test(file)).sort();
if (htmlFiles.length !== powerpointFiles.length) {
  throw new Error(
    `Render counts differ: HTML=${htmlFiles.length}, PowerPoint=${powerpointFiles.length}`,
  );
}

const slides = htmlFiles.map((file, index) => {
  const diff = path.join(diffDir, file);
  const result = runCli(
    "compare",
    [
      path.join(htmlDir, file),
      path.join(powerpointDir, powerpointFiles[index]),
      diff,
    ],
    true,
  );
  return {
    slide: index + 1,
    html: path.join(htmlDir, file),
    powerpoint: path.join(powerpointDir, powerpointFiles[index]),
    diff,
    ...result,
  };
});

const summary = {
  ok: true,
  input,
  output,
  renderer: "Microsoft PowerPoint",
  slideCount: slides.length,
  averageDiffRatio:
    slides.reduce((sum, slide) => sum + slide.ratio, 0) / slides.length,
  maximumDiffRatio: Math.max(...slides.map((slide) => slide.ratio)),
  slides,
  manualInspectionRequired: true,
};
const summaryPath = `${stem}.visual-summary.json`;
fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), "utf8");
process.stdout.write(`${JSON.stringify({ ...summary, summaryPath }, null, 2)}\n`);
