// path: src/lib/errors.ts

/**
 * Centralized, typed error hierarchy for the /workspace backend.
 *
 * Design rules:
 * - Every operational (expected, handleable) failure throws one of these,
 *   never a bare `Error` or a swallowed `try/catch`.
 * - `toClientSafe()` is the ONLY thing ever sent across the server/client
 *   boundary — it never leaks stack traces, DB errors, or internal context.
 * - `context` is for structured logging only.
 */

export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "CONFLICT"
  | "INVARIANT_VIOLATION"
  | "UPSTREAM_ERROR";

export interface ClientSafeError {
  code: ErrorCode;
  message: string;
  fieldErrors?: Record<string, string[]>;
}

export abstract class AppError extends Error {
  abstract readonly code: ErrorCode;
  abstract readonly httpStatus: number;
  /** Distinguishes expected/handled failures from programmer bugs when logging. */
  readonly isOperational = true;
  readonly context?: Record<string, unknown>;

  constructor(message: string, context?: Record<string, unknown>) {
    super(message);
    this.name = new.target.name;
    this.context = context;
    if (typeof Error.captureStackTrace === "function") {
      Error.captureStackTrace(this, new.target);
    }
  }

  toClientSafe(): ClientSafeError {
    return { code: this.code, message: this.message };
  }
}

export class UnauthenticatedError extends AppError {
  readonly code = "UNAUTHENTICATED" as const;
  readonly httpStatus = 401;
  constructor(
    message = "You must be signed in to perform this action.",
    context?: Record<string, unknown>,
  ) {
    super(message, context);
  }
}

export class ForbiddenError extends AppError {
  readonly code = "FORBIDDEN" as const;
  readonly httpStatus = 403;
  constructor(
    message = "You do not have permission to perform this action.",
    context?: Record<string, unknown>,
  ) {
    super(message, context);
  }
}

export class NotFoundError extends AppError {
  readonly code = "NOT_FOUND" as const;
  readonly httpStatus = 404;
  constructor(
    message = "The requested resource was not found.",
    context?: Record<string, unknown>,
  ) {
    super(message, context);
  }
}

export class ValidationError extends AppError {
  readonly code = "VALIDATION_ERROR" as const;
  readonly httpStatus = 422;
  readonly fieldErrors?: Record<string, string[]>;

  constructor(
    message: string,
    fieldErrors?: Record<string, string[]>,
    context?: Record<string, unknown>,
  ) {
    super(message, context);
    this.fieldErrors = fieldErrors;
  }

  override toClientSafe(): ClientSafeError {
    return {
      code: this.code,
      message: this.message,
      fieldErrors: this.fieldErrors,
    };
  }
}

export class ConflictError extends AppError {
  readonly code = "CONFLICT" as const;
  readonly httpStatus = 409;
  constructor(
    message = "This action conflicts with the current state of the resource.",
    context?: Record<string, unknown>,
  ) {
    super(message, context);
  }
}

/** For business-rule invariants (e.g. "org must always have an owner"), distinct from a generic 409. */
export class InvariantViolationError extends AppError {
  readonly code = "INVARIANT_VIOLATION" as const;
  readonly httpStatus = 409;
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, context);
  }
}

/** Wraps failures from better-auth, Drizzle/MySQL, or other downstream systems. */
export class UpstreamServiceError extends AppError {
  readonly code = "UPSTREAM_ERROR" as const;
  readonly httpStatus = 502;
  readonly originalError?: unknown;

  constructor(
    message = "Something went wrong. Please try again.",
    originalError?: unknown,
    context?: Record<string, unknown>,
  ) {
    super(message, context);
    this.originalError = originalError;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
