import path from "node:path";
import {
  sanitizeResourceLocation,
  SecurityPolicyError,
} from "../security/security-policy.js";
import {
  ConversionPolicyError,
  type ConversionErrorDetails,
  type SecurityPolicyErrorDetails,
} from "../types.js";

export interface ErrorReport {
  ok: false;
  error: FailureDetails;
}

interface UnexpectedErrorDetails {
  code: "UNEXPECTED_ERROR";
  reason: string;
}

type FailureDetails =
  ConversionErrorDetails | SecurityPolicyErrorDetails | UnexpectedErrorDetails;

const EMBEDDED_LOCATION = new RegExp(
  String.raw`\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s<>"']+|\\\\[^\\/\s]+[\\/](?:[^\\/\s]+[\\/])*[^\\/\s<>"'\[\]{}()]+|\b[A-Za-z]:[\\/](?:[^\\/\s]+[\\/])*[^\\/\s<>"'\[\]{}()]+|(?<![:\w])\/(?:[^/\s]+\/)+[^/\s<>"'\[\]{}()]+`,
  "gu",
);

function sanitizeDataPayloads(value: string): string {
  const start = value.search(/\bdata:/iu);
  return start < 0 ? value : value.slice(0, start) + "data:[redacted]";
}

function sanitizeQuotedLocations(value: string): string {
  return value.replace(/(["'])([^"'\r\n]+)\1/gu, (quoted, quote, inner) => {
    if (/^data:/iu.test(inner)) return `${quote}[data URL redacted]${quote}`;
    if (
      !/^(?:[A-Za-z][A-Za-z0-9+.-]*:\/\/|\\\\|[A-Za-z]:[\\/]|\/)/u.test(inner)
    ) {
      return quoted;
    }
    return `${quote}${sanitizeFailureLocation(inner)}${quote}`;
  });
}

function sanitizeUrlQueryAndFragmentSuffixes(value: string): string {
  const schemeStart = /\b[A-Za-z][A-Za-z0-9+.-]*:\/\//gu;
  let cursor = 0;
  let output = "";
  let match: RegExpExecArray | null;
  while ((match = schemeStart.exec(value)) !== null) {
    const start = match.index;
    const whitespace = value.slice(start).search(/\s/u);
    const end = whitespace < 0 ? value.length : start + whitespace;
    const token = value.slice(start, end);
    const suffixStart = [token.indexOf("?"), token.indexOf("#")]
      .filter((index) => index >= 0)
      .sort((left, right) => left - right)[0];
    output += value.slice(cursor, start);
    output +=
      suffixStart === undefined
        ? token
        : sanitizeResourceLocation(token.slice(0, suffixStart));
    cursor = end;
    schemeStart.lastIndex = end;
  }
  return output + value.slice(cursor);
}

function sanitizeFailureText(value: string): string {
  const quotedLocations = sanitizeQuotedLocations(value);
  const urlSuffixes = sanitizeUrlQueryAndFragmentSuffixes(quotedLocations);
  return sanitizeDataPayloads(urlSuffixes).replace(
    EMBEDDED_LOCATION,
    (location) => {
      if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//u.test(location)) {
        return sanitizeResourceLocation(location);
      }
      if (/^(?:\\\\|[A-Za-z]:[\\/])/u.test(location)) {
        return path.win32.basename(location);
      }
      return path.posix.basename(location);
    },
  );
}

function sanitizeFailureLocation(value: string): string {
  if (/^(?:\\\\|[A-Za-z]:[\\/])/u.test(value)) {
    return path.win32.basename(value);
  }
  if (path.posix.isAbsolute(value)) {
    return path.posix.basename(value);
  }
  return sanitizeResourceLocation(value);
}

function sanitizeFailureDetails(details: FailureDetails): FailureDetails {
  if ("resourceLocation" in details) {
    return {
      code: details.code,
      resourceType: sanitizeFailureText(details.resourceType),
      resourceLocation: sanitizeFailureLocation(details.resourceLocation),
      inputPath: sanitizeFailureLocation(details.inputPath),
      securityMode: details.securityMode,
      suggestedRepair: sanitizeFailureText(details.suggestedRepair),
    };
  }
  if ("slide" in details) {
    return {
      code: details.code,
      slide: details.slide,
      selector: sanitizeFailureText(details.selector),
      textPreview: sanitizeFailureText(details.textPreview),
      reason: sanitizeFailureText(details.reason),
      suggestedRepair: sanitizeFailureText(details.suggestedRepair),
    };
  }
  return {
    code: details.code,
    reason: sanitizeFailureText(details.reason),
  };
}

function unexpectedErrorDetails(error: unknown): UnexpectedErrorDetails {
  return {
    code: "UNEXPECTED_ERROR",
    reason: error instanceof Error ? error.message : String(error),
  };
}

export function createErrorReport(error: unknown): ErrorReport {
  let details: FailureDetails;
  if (error instanceof ConversionPolicyError) {
    details = error.details;
  } else if (error instanceof SecurityPolicyError) {
    details = error.details;
  } else {
    details = unexpectedErrorDetails(error);
  }
  return { ok: false, error: sanitizeFailureDetails(details) };
}
