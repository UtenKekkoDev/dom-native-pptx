import {
  ConversionPolicyError,
  type ConversionErrorDetails,
} from "../types.js";

export interface ErrorReport {
  ok: false;
  error: ConversionErrorDetails | {
    code: "UNEXPECTED_ERROR";
    reason: string;
  };
}

export function createErrorReport(error: unknown): ErrorReport {
  if (error instanceof ConversionPolicyError) {
    return { ok: false, error: error.details };
  }
  return {
    ok: false,
    error: {
      code: "UNEXPECTED_ERROR",
      reason: error instanceof Error ? error.message : String(error),
    },
  };
}
