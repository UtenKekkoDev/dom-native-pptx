import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SecurityMode, SecurityPolicyErrorDetails } from "../types.js";

const DEFAULT_TIMEOUT_MS = 30_000;

export class SecurityPolicyError extends Error {
  constructor(readonly details: SecurityPolicyErrorDetails) {
    super(`${details.code}: ${details.resourceLocation}`);
    this.name = "SecurityPolicyError";
  }
}

export interface ResourceRequest {
  url: string;
  resourceType: string;
  isSubframeNavigation: boolean;
}

export interface SecurityPolicy {
  mode: SecurityMode;
  inputPath: string;
  rootDir: string;
  timeoutMs: number;
  assertAllowed(request: ResourceRequest): Promise<void>;
  assertAllowedFile(filePath: string): Promise<void>;
}

export function sanitizeResourceLocation(resourceLocation: string): string {
  try {
    const url = new URL(resourceLocation);
    if (url.protocol === "data:") {
      return url.href.split(",", 1)[0] ?? "data:";
    }
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.protocol === "file:"
      ? path.basename(fileURLToPath(url))
      : url.toString();
  } catch {
    return path.basename(resourceLocation);
  }
}

export async function createSecurityPolicy(options: {
  inputPath: string;
  securityMode?: SecurityMode;
  timeoutMs?: number;
}): Promise<SecurityPolicy> {
  const mode = options.securityMode ?? "safe";
  const inputPath = path.resolve(options.inputPath);
  const rootDir = await fs.realpath(path.dirname(inputPath));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const fail = (
    code: SecurityPolicyErrorDetails["code"],
    resourceType: string,
    resourceLocation: string,
    suggestedRepair: string,
  ): never => {
    throw new SecurityPolicyError({
      code,
      resourceType,
      resourceLocation: sanitizeResourceLocation(resourceLocation),
      inputPath,
      securityMode: mode,
      suggestedRepair,
    });
  };

  const assertAllowedFile = async (filePath: string): Promise<void> => {
    const realResourcePath = await fs.realpath(filePath);
    if (!isPathInside(rootDir, realResourcePath)) {
      fail(
        "SECURITY_LOCAL_PATH_ESCAPE",
        "file",
        filePath,
        "Move the resource inside the input HTML directory.",
      );
    }
  };

  return {
    mode,
    inputPath,
    rootDir,
    timeoutMs,
    assertAllowedFile,
    async assertAllowed(request): Promise<void> {
      if (request.isSubframeNavigation) {
        fail(
          "SECURITY_IFRAME_BLOCKED",
          request.resourceType,
          request.url,
          "Remove the iframe or replace it with static content.",
        );
      }

      let url: URL;
      try {
        url = new URL(request.url);
      } catch {
        await assertAllowedFile(request.url);
        return;
      }

      if (url.protocol === "data:") {
        if (/^data:(image|font)\//i.test(url.href)) return;
        fail(
          "SECURITY_DATA_URL_BLOCKED",
          request.resourceType,
          request.url,
          "Use an image or font data URL, or a local resource.",
        );
      }

      if (url.protocol === "file:") {
        await assertAllowedFile(fileURLToPath(url));
        return;
      }

      if (mode === "trusted") return;

      fail(
        "SECURITY_REMOTE_RESOURCE_BLOCKED",
        request.resourceType,
        request.url,
        "Download the resource into the input HTML directory or use trusted mode for audited HTML.",
      );
    },
  };
}

function isPathInside(rootDir: string, resourcePath: string): boolean {
  const normalizeForComparison = (value: string): string => {
    const resolved = path.resolve(value);
    return process.platform === "win32"
      ? resolved.toLocaleLowerCase()
      : resolved;
  };
  const normalizedRoot = normalizeForComparison(rootDir);
  const normalizedResource = normalizeForComparison(resourcePath);
  const relative = path.relative(normalizedRoot, normalizedResource);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}
