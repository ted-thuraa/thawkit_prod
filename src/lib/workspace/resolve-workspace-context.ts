// path: src/lib/workspace/resolve-workspace-context.ts

import "server-only";
import { cache } from "react";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { member, organization } from "@/drizzle/schemas/auth-schema";
import { getServerSession } from "@/lib/sessionServer";
//import { setActiveOrganization } from "@/actions/organization";
import { logger } from "@/lib/logger";
import type { OrgRole, WorkspaceResolution } from "@/types/workspace";
import {
  createOrganization,
  setActiveOrganization,
} from "@/actions/organization.actions";

/**
 * Implements the Bootstrapping & Security Sequence from the architecture
 * design doc. Called independently from `workspace/layout.tsx` AND
 * `workspace/page.tsx` (Next.js layouts cannot pass computed data to
 * sibling pages as props) — wrapped in `cache()` so both calls within the
 * same request dedupe to a single session lookup + DB round trip, instead
 * of resolving the org/membership twice per request.
 */
export const resolveWorkspaceContext = cache(
  async (): Promise<WorkspaceResolution> => {
    const session = await getServerSession();

    if (!session?.user) {
      return { kind: "redirect", to: "/login", reason: "unauthenticated" };
    }

    if (session.user.banned) {
      logger.info("Blocked banned user from entering workspace", {
        userId: session.user.id,
      });
      return { kind: "redirect", to: "/banned", reason: "banned" };
    }

    let activeOrganizationId = session.session.activeOrganizationId ?? null;

    if (activeOrganizationId === null) {
      const fallbackMembership = await db.query.member.findFirst({
        where: { userId: session.user.id },
        orderBy: { createdAt: "desc" },
      });

      if (!fallbackMembership) {
        // No orgs at all? Create a default organization for this user
        //const user = session.user;
        const defaultOrgName = `My Workspace`;
        const defaultSlug = defaultOrgName
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-");

        const newOrg = await createOrganization({
          name: defaultOrgName,
          slug: defaultSlug,
          userId: session.user.id,
          metadata: { autoCreated: true },
        });

        if (newOrg) {
          await setActiveOrganization(newOrg.id, newOrg.slug);
          return {
            kind: "ready",
            context: {
              organizationId: newOrg.id,
              organizationName: newOrg.name,
              organizationStatus: "active",
              role: "owner" as OrgRole,
              userId: session.user.id,
              isImpersonating: Boolean(session.session.impersonatedBy),
            },
          };
        } else {
          logger.warn("Failed to create a new organization", {
            userId: session.user.id,
          });
          return {
            kind: "redirect",
            to: "/onboarding/create-workspace",
            reason: "no-organization",
          };
        }
      }

      activeOrganizationId = fallbackMembership.organizationId;

      try {
        await setActiveOrganization(activeOrganizationId);
      } catch (error) {
        logger.warn(
          "Failed to persist fallback active organization onto session",
          {
            userId: session.user.id,
            organizationId: activeOrganizationId,
            error,
          },
        );
      }
    }

    const org = await db.query.organization.findFirst({
      where: { id: activeOrganizationId },
    });

    if (!org) {
      logger.warn("Session referenced a non-existent organization", {
        userId: session.user.id,
        organizationId: activeOrganizationId,
      });
      return {
        kind: "redirect",
        to: "/onboarding/create-workspace",
        reason: "organization-not-found",
      };
    }

    if (org.status !== "active") {
      return {
        kind: "redirect",
        to: `/workspace/suspended?reason=${org.status}`,
        reason: "organization-suspended",
      };
    }

    const membership = await db.query.member.findFirst({
      where: {
        organizationId: org.id,
        userId: session.user.id,
      },
    });

    if (!membership) {
      logger.info("Stale session referenced a revoked membership", {
        userId: session.user.id,
        organizationId: org.id,
      });
      return {
        kind: "redirect",
        to: "/onboarding/create-workspace",
        reason: "membership-revoked",
      };
    }

    return {
      kind: "ready",
      context: {
        organizationId: org.id,
        organizationName: org.name,
        organizationStatus: org.status,
        role: membership.role as OrgRole,
        userId: session.user.id,
        isImpersonating: Boolean(session.session.impersonatedBy),
      },
    };
  },
);
