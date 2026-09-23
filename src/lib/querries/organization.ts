// path: src/lib/queries/organization.ts

import "server-only";
import { unstable_cache } from "next/cache";
import { db } from "@/drizzle/db";
import { requireOrgPermission } from "@/lib/auth/require-org-permission";
import { WORKSPACE_ROLE_MATRIX } from "@/lib/workspace/permissions";
import { NotFoundError } from "@/lib/errors";
import type {
  MemberDTO,
  OrganizationOverviewDTO,
  OrgRole,
  PendingInvitationDTO,
} from "@/types/workspace";

export function organizationOverviewCacheTag(organizationId: string): string {
  return `org:${organizationId}:overview`;
}

/**
 * Org name/logo change infrequently relative to campaign or team data, so
 * this is the one read in the workspace backend wrapped in a persistent,
 * tag-invalidated cache (see `updateOrganizationOverview`'s
 * `revalidateTag` call). Authorization is deliberately checked OUTSIDE the
 * cached function — permission decisions must never be cached across users,
 * only the resulting data, once a caller is already confirmed authorized.
 */
export async function getOrganizationOverview(
  organizationId: string,
): Promise<OrganizationOverviewDTO> {
  await requireOrgPermission(
    organizationId,
    WORKSPACE_ROLE_MATRIX.viewWorkspace,
  );

  const fetchCached = unstable_cache(
    async () => {
      const org = await db.query.organization.findFirst({
        where: { id: organizationId },
      });
      return org ?? null;
    },
    [`workspace-organization-overview-${organizationId}`],
    { tags: [organizationOverviewCacheTag(organizationId)], revalidate: 300 },
  );

  const org = await fetchCached();

  if (!org) {
    throw new NotFoundError("Organization not found.", { organizationId });
  }

  return { id: org.id, name: org.name, logo: org.logo, status: org.status };
}

/** Active members list — visible to every member of the org, not just admins. */
export async function listActiveMembers(
  organizationId: string,
): Promise<MemberDTO[]> {
  await requireOrgPermission(
    organizationId,
    WORKSPACE_ROLE_MATRIX.viewWorkspace,
  );

  const rows = await db.query.member.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    with: { user: { columns: { id: true, name: true, email: true } } },
  });

  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    role: row.role as OrgRole,
    displayName: row.displayName ?? row.user.name,
    email: row.user.email,
    joinedAt: row.createdAt.toISOString(),
  }));
}

/** Pending invites are only visible to owners/admins — who was invited and when is management-sensitive. */
export async function listPendingInvitations(
  organizationId: string,
): Promise<PendingInvitationDTO[]> {
  await requireOrgPermission(organizationId, WORKSPACE_ROLE_MATRIX.manageTeam);

  const rows = await db.query.invitation.findMany({
    where: { organizationId, status: "pending" },
    orderBy: { expiresAt: "desc" },
    with: { inviter: { columns: { id: true, name: true } } },
  });

  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    role: (row.role ?? "member") as OrgRole,
    status: row.status as PendingInvitationDTO["status"],
    expiresAt: row.expiresAt.toISOString(),
    inviter: { id: row.inviter.id, name: row.inviter.name },
  }));
}
