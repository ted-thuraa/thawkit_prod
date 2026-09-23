// path: src/lib/workspace/permissions.ts

import "server-only";
import type { OrgRole } from "@/types/workspace";

const ROLE_RANK: Record<OrgRole, number> = {
  member: 0,
  admin: 1,
  owner: 2,
};

export function hasAtLeastRole(role: OrgRole, minimum: OrgRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

/**
 * Single source of truth for "who can do what" in a workspace. Every
 * Server Action and authorization-gated query references this rather than
 * hardcoding role arrays inline.
 */
export const WORKSPACE_ROLE_MATRIX = {
  /** View campaigns, org overview, active members list. */
  viewWorkspace: ["owner", "admin", "member"],
  /** Edit org name/logo. */
  manageOverview: ["owner", "admin"],
  /** Invite, revoke invites, remove members, edit a member's display name. */
  manageTeam: ["owner", "admin"],
  /** Promote/demote roles — owner-only, admins cannot self-elevate. */
  manageRoles: ["owner"],
  /** Admin-initiated email change requests — owner-only given the account-takeover risk. */
  manageMemberEmail: ["owner"],
  /**
   * ADDED: creating a campaign is a content operation, not a
   * workspace-management operation — deliberately open to every role,
   * unlike the org/team settings above.
   */
  createCampaign: ["owner", "admin", "member"],
  /** ADDED: renaming/status changes/deletion — publishing a campaign as "live" affects the whole org, so this stays admin+. */
  manageCampaigns: ["owner", "admin"],
  editCampaignContent: ["owner", "admin", "member"],
} as const satisfies Record<string, readonly OrgRole[]>;
