// path: src/lib/editor/bootstrap/instrument.ts

import "server-only";
import { logger } from "@/lib/logger";
import type { BootstrapSection } from "./types";

/**
 * Tenant ids come from the already-validated campaign row, never from the
 * client — but RQB v2 silently DROPS a filter whose value is `undefined`, so
 * an empty id would turn a scoped query into a table scan. Fail loudly
 * instead (same rationale as `assertOrganizationId` in tenant-scope.ts, which
 * is a "use server" module and so cannot export a sync helper).
 */
export function assertTenantId(label: string, value: string | null | undefined): string {
  if (!value || value.trim() === "") {
    throw new Error(`Editor bootstrap: missing ${label} for a tenant-scoped query.`);
  }
  return value;
}

/**
 * Runs one OPTIONAL bootstrap section, times it, and converts a failure into
 * `{ status: "error" }` instead of throwing. The full error is logged against
 * the section name; the client only ever receives the generic message.
 */
export async function runSection<T>(
  name: string,
  context: Record<string, unknown>,
  task: () => Promise<T>,
): Promise<BootstrapSection<T>> {
  const startedAt = performance.now();
  try {
    const data = await task();
    logger.info("Editor bootstrap section loaded", {
      ...context,
      section: name,
      durationMs: Math.round(performance.now() - startedAt),
    });
    return { status: "ready", data };
  } catch (error) {
    logger.error(`Editor bootstrap: "${name}" failed`, {
      ...context,
      section: name,
      durationMs: Math.round(performance.now() - startedAt),
      error,
    });
    return { status: "error", error: `Failed to load ${name}.` };
  }
}
