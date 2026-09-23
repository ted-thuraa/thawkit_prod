// path: src/lib/auth/require-org-permission.ts

import "server-only";
import { db } from "@/drizzle/db";
import { getServerSession } from "@/lib/sessionServer";
import {
  UnauthenticatedError,
  ForbiddenError,
  NotFoundError,
} from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { OrgRole, OrganizationStatus } from "@/types/workspace";

export interface AuthorizedActor {
  userId: string;
  organizationId: string;
  role: OrgRole;
  organizationStatus: OrganizationStatus;
  isImpersonating: boolean;
}

/**
 * The single authoritative authorization gate for every organization-scoped
 * mutation and query in the /workspace backend. Re-derives the caller's
 * identity, membership, and role from the live session + DB on every call —
 * it NEVER trusts a client-supplied role or organizationId as the basis for
 * a decision, closing the class of gap flagged against the earlier
 * `createOrganization` action (unvalidated client-supplied `userId`).
 *
 * Throws (never returns a "denied" value) so call sites can't accidentally
 * ignore a failed check.
 */
export async function requireOrgPermission(
  organizationId: string,
  allowedRoles: readonly OrgRole[],
): Promise<AuthorizedActor> {
  const session = await getServerSession();

  if (!session?.user) {
    throw new UnauthenticatedError();
  }

  if (session.user.banned) {
    logger.warn("Banned user attempted an authorized workspace action", {
      userId: session.user.id,
      organizationId,
    });
    throw new ForbiddenError("This account has been banned.");
  }

  const [org, membership] = await Promise.all([
    db.query.organization.findFirst({
      where: { id: organizationId },
    }),
    db.query.member.findFirst({
      where: {
        organizationId,
        userId: session.user.id,
      },
    }),
  ]);

  if (!org) {
    throw new NotFoundError("Organization not found.", { organizationId });
  }

  if (!membership) {
    // Intentionally the same error type/shape as "role not allowed" below —
    // do not let a non-member distinguish "org exists but I'm not in it"
    // from "I don't have permission" via a different error code.
    logger.warn(
      "Authorization denied: caller is not a member of the target organization",
      {
        userId: session.user.id,
        organizationId,
      },
    );
    throw new ForbiddenError("You do not have access to this workspace.");
  }

  const role = membership.role as OrgRole;

  if (!allowedRoles.includes(role)) {
    logger.warn("Authorization denied: role not permitted for this action", {
      userId: session.user.id,
      organizationId,
      role,
      allowedRoles,
    });
    throw new ForbiddenError(
      "You do not have permission to perform this action.",
      { role, allowedRoles },
    );
  }

  return {
    userId: session.user.id,
    organizationId,
    role,
    organizationStatus: org.status,
    isImpersonating: Boolean(session.session.impersonatedBy),
  };
}
