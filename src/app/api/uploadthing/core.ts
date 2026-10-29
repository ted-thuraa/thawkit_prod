// path: src/app/api/uploadthing/core.ts

import { createUploadthing, type FileRouter } from "uploadthing/next";
import { UploadThingError } from "uploadthing/server";
import { z } from "zod";
import { requireCampaignEditPermission } from "@/lib/auth/require-campaign-permission";
import {
  folderBelongsToOrganization,
} from "@/lib/assets/asset-repository";
import {
  UploadRejectedError,
  processUploadedFile,
} from "@/lib/assets/process-upload";
import { processUploadDeps } from "@/lib/assets/process-upload-deps";
import {
  FILE_ROUTE_CONFIG,
  MAX_FILES_PER_UPLOAD,
  validateUploadCandidate,
} from "@/lib/assets/upload-policy";
import { isUuid } from "@/lib/editor/bootstrap/collect-asset-ids";
import { isAppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { Asset } from "@/types/funnel";

/**
 * UploadThing file router (uploadthing@7). One route: the media library.
 *
 * FLOW  browser ──files──▶ UploadThing storage   (direct; bytes never pass
 *                                                 through this server)
 *       ◀── presign ── middleware (below: auth + tenancy + claim checks)
 *       UploadThing ──signed callback──▶ onUploadComplete (below: verify the
 *       real bytes, persist metadata, compensate on failure)
 *
 * `metadata` returned from the middleware travels through UploadThing's
 * SIGNED callback, so the client cannot forge the organization it targets.
 */

/** A mapped type (not the `Asset` interface) so it satisfies UploadThing's JSON-object constraint. */
type AssetJson = { [K in keyof Asset]: Asset[K] };

const f = createUploadthing({
  // Whatever the client sees on failure. Never leaks internals.
  errorFormatter: (err) => ({ message: err.message }),
});

export const ourFileRouter = {
  assetLibrary: f(FILE_ROUTE_CONFIG)
    .input(
      z.object({
        campaignId: z.string().min(1).max(100),
        folderId: z.string().uuid().nullable().optional(),
      }),
    )
    .middleware(async ({ input, files }) => {
      // 1. AuthN + AuthZ first (org edit permission for THIS campaign). The
      //    organization is derived from the campaign — never from the client.
      let actor: Awaited<ReturnType<typeof requireCampaignEditPermission>>;
      try {
        actor = await requireCampaignEditPermission(input.campaignId);
      } catch (error) {
        if (isAppError(error)) {
          throw new UploadThingError({
            code: "FORBIDDEN",
            message: "You don't have permission to upload to this campaign.",
          });
        }
        logger.error("Upload middleware auth failure", { error });
        throw new UploadThingError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Could not authorize this upload.",
        });
      }

      // 2. Advisory claim checks → friendly early errors (the real checks run
      //    on the stored bytes in onUploadComplete).
      if (files.length > MAX_FILES_PER_UPLOAD) {
        throw new UploadThingError({
          code: "TOO_MANY_FILES",
          message: `Upload at most ${MAX_FILES_PER_UPLOAD} files at a time.`,
        });
      }
      for (const file of files) {
        const problem = validateUploadCandidate(file);
        if (problem) {
          throw new UploadThingError({ code: "BAD_REQUEST", message: problem });
        }
      }

      // 3. Target folder must be a live folder of THIS organization.
      const folderId = input.folderId ?? null;
      if (folderId) {
        const ok =
          isUuid(folderId) &&
          (await folderBelongsToOrganization(actor.organizationId, folderId));
        if (!ok) {
          throw new UploadThingError({
            code: "BAD_REQUEST",
            message: "The selected folder no longer exists.",
          });
        }
      }

      return {
        organizationId: actor.organizationId,
        userId: actor.userId,
        folderId,
      };
    })
    .onUploadError(({ error, fileKey }) => {
      logger.warn("Asset upload failed", { fileKey, code: error.code, message: error.message });
    })
    .onUploadComplete(async ({ metadata, file }) => {
      try {
        const asset = await processUploadedFile(
          {
            key: file.key,
            name: file.name,
            size: file.size,
            type: file.type,
            ufsUrl: file.ufsUrl,
          },
          metadata,
          processUploadDeps,
        );
        // Returned to the client (`serverData`) so the dialog can show the new
        // asset immediately, from the authoritative DB row.
        return { asset: { ...asset } as AssetJson };
      } catch (error) {
        // UploadRejectedError messages are user-safe; anything else is generic.
        const message =
          error instanceof UploadRejectedError
            ? error.message
            : "The upload could not be saved. Please try again.";
        throw new UploadThingError({ code: "BAD_REQUEST", message });
      }
    }),
} satisfies FileRouter;

export type OurFileRouter = typeof ourFileRouter;
