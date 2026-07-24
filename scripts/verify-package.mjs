import { spawnSync } from "node:child_process";

const npmCli = process.env.npm_execpath;
if (!npmCli) {
  throw new Error("npm_execpath is unavailable; run this check through npm run test:package");
}
const result = spawnSync(
  process.execPath,
  [npmCli, "pack", "--dry-run", "--json", "--ignore-scripts"],
  { encoding: "utf8" },
);

if (result.status !== 0) {
  process.stderr.write(
    result.stderr || result.stdout || result.error?.message || "npm pack failed\n",
  );
  process.exit(result.status ?? 1);
}

const report = JSON.parse(result.stdout)[0];
const files = report.files.map((entry) => entry.path.replaceAll("\\", "/"));
const required = [
  "package.json",
  "README.md",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "dist/index.js",
  "dist/index.d.ts",
  "dist/cli.js",
];
const forbiddenPrefixes = [
  "src/",
  "tests/",
  "docs/",
  ".github/",
  "examples/",
  "skills/",
  ".tmp/",
  "outputs/",
];

const missing = required.filter((entry) => !files.includes(entry));
const forbidden = files.filter((entry) =>
  forbiddenPrefixes.some((prefix) => entry.startsWith(prefix))
);

if (missing.length || forbidden.length) {
  if (missing.length) {
    process.stderr.write(`Missing package files: ${missing.join(", ")}\n`);
  }
  if (forbidden.length) {
    process.stderr.write(`Forbidden package files: ${forbidden.join(", ")}\n`);
  }
  process.exit(1);
}

process.stdout.write(JSON.stringify({
  name: report.name,
  version: report.version,
  filename: report.filename,
  fileCount: files.length,
  packageSize: report.size,
  unpackedSize: report.unpackedSize,
}, null, 2) + "\n");
