// path: src/lib/sessionServer.ts

// NOTE: previously carried a `"use server"` directive, which marks every
// export as a client-callable Server Action RPC endpoint — wrong for a
// session-reading utility that's only ever called from other server code.
// `server-only` is the correct primitive here: it guarantees this module
// (and the better-auth instance it pulls in) can never be bundled into
// client JS, without exposing it as an invokable action.
import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { auth } from "./auth/auth";
import { logger } from "./logger";
import { UpstreamServiceError } from "./errors";

export type ServerSession = Awaited<ReturnType<typeof auth.api.getSession>>;

/**
 * Resolves the current session exactly once per request. React's `cache()`
 * dedupes calls with identical arguments within a single render pass, so
 * `workspace/layout.tsx`, `workspace/page.tsx`, and every nested
 * `settings/*` Server Component can all call this without triggering
 * duplicate `headers()` reads or DB round trips.
 */
export const getServerSession = cache(async (): Promise<ServerSession> => {
  try {
    return await auth.api.getSession({ headers: await headers() });
  } catch (error) {
    logger.error("Failed to resolve server session", { error });
    throw new UpstreamServiceError(
      "Unable to verify your session right now.",
      error,
    );
  }
});
