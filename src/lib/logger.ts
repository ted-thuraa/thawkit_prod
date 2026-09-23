// path: src/lib/logger.ts

/**
 * Minimal structured logger — emits single-line JSON so log aggregators
 * (Datadog, CloudWatch, etc.) can parse fields directly instead of grepping
 * free-text strings. Intentionally dependency-free; swap the `emit`
 * implementation for a real transport (pino, winston) without touching
 * call sites elsewhere in the codebase.
 */

import { isAppError } from "./errors";

type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogFields {
  [key: string]: unknown;
}

function serializeFields(fields: LogFields): LogFields {
  const serialized: LogFields = {};

  for (const [key, value] of Object.entries(fields)) {
    if (value instanceof Error) {
      serialized[key] = {
        name: value.name,
        message: value.message,
        stack: value.stack,
        ...(isAppError(value)
          ? { code: value.code, appErrorContext: value.context }
          : {}),
      };
    } else {
      serialized[key] = value;
    }
  }

  return serialized;
}

function emit(level: LogLevel, message: string, fields: LogFields = {}): void {
  const entry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    service: "thawkit-workspace",
    ...serializeFields(fields),
  };

  const line = JSON.stringify(entry);

  switch (level) {
    case "error":
      console.error(line);
      break;
    case "warn":
      console.warn(line);
      break;
    default:
      console.log(line);
  }
}

export const logger = {
  debug(message: string, fields?: LogFields): void {
    if (process.env.NODE_ENV !== "production") emit("debug", message, fields);
  },
  info(message: string, fields?: LogFields): void {
    emit("info", message, fields);
  },
  warn(message: string, fields?: LogFields): void {
    emit("warn", message, fields);
  },
  error(message: string, fields?: LogFields): void {
    emit("error", message, fields);
  },
};
