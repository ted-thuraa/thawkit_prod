// path: src/lib/editor/read/action-result.ts

import "server-only";
import { z } from "zod";
import {
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { ActionResult } from "./types";

/**
 * Converts a thrown error into the `ActionResult` failure the editor expects.
 * Same contract as `toErrorResult` in editor-actions.ts (known app errors
 * keep their message; anything else is logged in full and replaced with a
 * generic message so internals never reach the browser), plus malformed
 * input from the zod schemas.
 */
export function toErrorResult(
  error: unknown,
  fallbackMessage: string,
): ActionResult<never> {
  if (error instanceof z.ZodError) {
    logger.warn("Editor read action received invalid input", {
      issues: error.issues.map((issue) => ({
        path: issue.path.join("."),
        code: issue.code,
      })),
    });
    return { success: false, error: "Invalid request." };
  }

  if (
    error instanceof UnauthenticatedError ||
    error instanceof ForbiddenError ||
    error instanceof NotFoundError ||
    error instanceof ValidationError
  ) {
    return { success: false, error: error.message };
  }

  logger.error(fallbackMessage, { error });
  return { success: false, error: fallbackMessage };
}
