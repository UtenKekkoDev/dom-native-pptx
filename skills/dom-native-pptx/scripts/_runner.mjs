import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const candidates = [
  process.env.DOM_NATIVE_PPTX_HOME,
  path.resolve(scriptDirectory, "../../.."),
  process.cwd(),
].filter(Boolean);

export const projectRoot = candidates.find((candidate) =>
  fs.existsSync(path.join(candidate, "src", "cli.ts")),
);

if (!projectRoot) {
  throw new Error(
    "dom-native-pptx project root was not found. Set DOM_NATIVE_PPTX_HOME.",
  );
}

export function absolute(value) {
  return path.resolve(process.cwd(), value);
}

export function runCli(command, args, capture = false) {
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      path.join(projectRoot, "src", "cli.ts"),
      command,
      ...args,
    ],
    {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    },
  );
  if (result.status !== 0) {
    if (capture) {
      process.stderr.write(result.stderr || result.stdout || "");
    }
    process.exit(result.status ?? 1);
  }
  return capture ? JSON.parse(result.stdout) : undefined;
}

export function requireArgs(values, usage) {
  if (values.some((value) => !value)) {
    process.stderr.write(`Usage: ${usage}\n`);
    process.exit(2);
  }
}
