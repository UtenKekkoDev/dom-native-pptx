import fs from "node:fs";
import path from "node:path";

const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));

function licenseFromInstalledFiles(packagePath) {
  const absolutePackagePath = path.resolve(packagePath);
  if (!fs.existsSync(absolutePackagePath)) return null;
  const licenseFile = fs
    .readdirSync(absolutePackagePath)
    .find((name) => /^licen[cs]e(?:\.|$)/iu.test(name));
  if (!licenseFile) return null;
  const text = fs
    .readFileSync(path.join(absolutePackagePath, licenseFile), "utf8")
    .slice(0, 1000);
  if (/MIT License|The MIT License/iu.test(text)) return "MIT (LICENSE file)";
  if (/Apache License[\s\S]*Version 2\.0/iu.test(text)) {
    return "Apache-2.0 (LICENSE file)";
  }
  if (/GNU LESSER GENERAL PUBLIC LICENSE[\s\S]*Version 3/iu.test(text)) {
    return "LGPL-3.0 (LICENSE file)";
  }
  return null;
}

const packages = Object.entries(lock.packages)
  .filter(
    ([packagePath, metadata]) =>
      packagePath.startsWith("node_modules/") && !metadata.dev,
  )
  .map(([packagePath, metadata]) => ({
    name: packagePath.slice("node_modules/".length),
    version: metadata.version,
    license: metadata.license ?? licenseFromInstalledFiles(packagePath),
  }));

const unresolved = packages
  .filter((entry) => !entry.license)
  .map((entry) => `${entry.name}@${entry.version}`);
const licenseCounts = Object.fromEntries(
  [...new Set(packages.map((entry) => entry.license ?? "UNRESOLVED"))]
    .sort()
    .map((license) => [
      license,
      packages.filter((entry) => (entry.license ?? "UNRESOLVED") === license)
        .length,
    ]),
);
const report = {
  productionPackages: packages.length,
  licenseCounts,
  unresolved,
  copyleftOrCombined: packages.filter((entry) =>
    /GPL|LGPL/iu.test(entry.license ?? ""),
  ),
};

if (process.argv.includes("--json")) {
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
} else {
  process.stdout.write(
    `Production packages: ${report.productionPackages}\n` +
      `License groups: ${JSON.stringify(report.licenseCounts)}\n` +
      `Unresolved: ${report.unresolved.length}\n` +
      `Copyleft or combined-license packages: ${report.copyleftOrCombined.length}\n`,
  );
}

if (unresolved.length) process.exitCode = 1;
