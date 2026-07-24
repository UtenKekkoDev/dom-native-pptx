import fs from "node:fs/promises";
import type { ValidationReport } from "../validate/pptx-xml.js";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export async function writeValidationHtml(
  outputPath: string,
  report: ValidationReport,
): Promise<void> {
  const status = report.ok ? "PASS" : "FAIL";
  const payload = escapeHtml(JSON.stringify(report, null, 2));
  await fs.writeFile(outputPath, `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>DOM Native PPTX Validation — ${status}</title>
<style>
body{font:16px/1.55 system-ui;margin:40px;max-width:1100px;color:#21182a}
.pass{color:#087f23}.fail{color:#b00020}
.metrics{display:grid;grid-template-columns:repeat(4,minmax(120px,1fr));gap:12px}
.metric{padding:16px;border:1px solid #d8d0df;border-radius:10px}
.metric strong{display:block;font-size:28px}
pre{white-space:pre-wrap;background:#f7f3fa;padding:20px;border-radius:10px}
</style>
</head>
<body>
<h1 class="${report.ok ? "pass" : "fail"}">${status}</h1>
<div class="metrics">
  <div class="metric"><strong>${report.slideCount}</strong>Slides</div>
  <div class="metric"><strong>${report.nativeTexts.length}</strong>Native text nodes</div>
  <div class="metric"><strong>${report.authorizedRasterRecords.length}</strong>Authorized rasters</div>
  <div class="metric"><strong>${report.errors.length}</strong>Errors</div>
</div>
<h2>Validation report</h2>
<pre>${payload}</pre>
</body>
</html>`, "utf8");
}
