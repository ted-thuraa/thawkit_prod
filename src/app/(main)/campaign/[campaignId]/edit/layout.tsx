import React from "react";
import { redirect } from "next/navigation";
import {
  UnauthenticatedError,
  ForbiddenError,
  NotFoundError,
} from "@/lib/errors";
import { logger } from "@/lib/logger";
import { requireCampaignEditPermission } from "@/lib/auth/require-campaign-permission";
import { resolveEditorBootstrap } from "@/lib/editor/resolve-editor-bootstrap";
import EditorLayoutClient from "./EditorLayoutClient";

/**
 * Campaign Editor Layout (Server Component)
 *
 * Forces dynamic rendering for the whole `campaign/[campaignId]/editor` segment
 * — every mount depends on the caller's live session and the target
 * campaign's live membership/role, neither of which can be prerendered.
 *
 * TWO server-side steps happen here, in order, before any client code
 * mounts:
 *   1. The permission gate (`requireCampaignEditPermission`) — a denied
 *      caller never sees a flash of UI they shouldn't. See
 *      require-campaign-permission.ts for exactly what's checked.
 *   2. The editor bootstrap (`resolveEditorBootstrap`) — this campaign's
 *      funnel, pages, components, and layer styles, fetched here instead
 *      of via a client-side REST call after mount. See
 *      resolve-editor-bootstrap.ts for why this replaces Ycode's
 *      `editor/init` route entirely rather than porting it as-is.
 * `resolveEditorBootstrap` internally re-runs the same permission check
 * via `requireCampaignEditPermission` — deduped by that function's own
 * `cache()` wrapper, so this costs no extra DB round trip.
 *
 * PERSISTENT BUILDER: this layout — and therefore `EditorLayoutClient`,
 * mounted once here — persists across every sub-route under this segment
 * (`layers/[pageId]`, `pages/[pageId]`, `components/[componentId]`).
 * Because Next.js doesn't re-run a layout's Server Component on
 * navigation within the same segment, `resolveEditorBootstrap` above only
 * runs once per distinct `campaignId`, not once per page/component
 * navigation. Those sub-routes each have a `page.tsx` that renders
 * nothing; the actual editor content is driven entirely by
 * `CampaignEditorMain` reading the URL directly (via
 * `useCampaignEditorUrl()`) and the `bootstrap` prop threaded down from
 * here — see `CampaignEditorMain.tsx`'s file comment for the full
 * rationale.
 *
 * NOTE on redirect() inside try/catch: this does not violate the
 * "redirect() must never be called inside try/catch blocks that return
 * ActionResult" rule the Server Actions in this codebase follow. That rule
 * exists because a Server Action's catch block normalizes thrown errors
 * into an `ActionResult` — which would swallow redirect()'s internal
 * NEXT_REDIRECT throw and turn it into a normal error instead of an actual
 * redirect. This is a Server Component, not a Server Action returning
 * ActionResult: its contract is to render JSX, call redirect()/notFound(),
 * or throw. redirect() below is called only from inside the catch handler
 * itself — never re-wrapped by a further try — so its throw propagates to
 * Next.js's rendering runtime uninterrupted. `resolveEditorBootstrap` is
 * called OUTSIDE the try/catch, after the gate has already succeeded — if
 * it throws (e.g. the "campaign has no funnel" invariant-violation case),
 * that's deliberately NOT caught here; it should reach Next.js's nearest
 * error boundary as a genuine 500, not be redirected away quietly.
 */

export const dynamic = "force-dynamic";

export default async function CampaignEditorLayout({
  params,
}: {
  params: Promise<{ campaignId: string }>;
}) {
  const { campaignId } = await params;

  try {
    await requireCampaignEditPermission(campaignId);
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      logger.info("Unauthenticated request redirected from campaign editor", {
        campaignId,
      });
      redirect(
        `/login?redirectTo=${encodeURIComponent(`/campaign/${campaignId}/edit`)}`,
      );
    }

    if (error instanceof ForbiddenError || error instanceof NotFoundError) {
      // Deliberately the same destination for both cases — see
      // require-campaign-permission.ts's doc comment: a denied caller must
      // not be able to distinguish "campaign exists but I can't access it"
      // from "campaign doesn't exist."
      logger.warn("Campaign editor access denied", {
        campaignId,
        reason: error instanceof ForbiddenError ? "forbidden" : "not-found",
      });
      redirect("/workspace?error=campaign-not-accessible");
    }

    // Unexpected error — rethrow so Next.js's nearest error boundary
    // handles it, rather than silently redirecting on something this gate
    // didn't anticipate.
    throw error;
  }

  const bootstrap = await resolveEditorBootstrap(campaignId);

  return <EditorLayoutClient campaignId={campaignId} bootstrap={bootstrap} />;
}
