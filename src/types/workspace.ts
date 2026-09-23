// path: src/types/workspace.ts

export type OrgRole = "owner" | "admin" | "member";
export type OrganizationStatus = "active" | "suspended" | "trial_expired";
export type CampaignStatus = "draft" | "live" | "archived";
export type InvitationStatus =
  | "pending"
  | "accepted"
  | "canceled"
  | "rejected"
  | "expired";

export interface WorkspaceContext {
  organizationId: string;
  organizationName: string;
  organizationStatus: OrganizationStatus;
  role: OrgRole;
  userId: string;
  isImpersonating: boolean;
}

export type WorkspaceRedirectReason =
  | "unauthenticated"
  | "banned"
  | "no-organization"
  | "organization-not-found"
  | "organization-suspended"
  | "membership-revoked";

/** Discriminated union returned by resolveWorkspaceContext(); see that function's doc comment. */
export type WorkspaceResolution =
  | { kind: "ready"; context: WorkspaceContext }
  | { kind: "redirect"; to: string; reason: WorkspaceRedirectReason };

export interface CampaignDTO {
  id: string;
  name: string;
  status: CampaignStatus;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  createdBy: { id: string; name: string } | null;
}

export interface CampaignListFilter {
  status: CampaignStatus | "all";
  cursor?: string | null;
  pageSize?: number;
}

export interface PaginatedResult<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface FunnelDTO {
  id: string;
  name: string;
  createdAt: string; // ISO 8601
}

export interface CampaignDetail {
  campaign: CampaignDTO;
  funnel: FunnelDTO[];
}

export interface OrganizationOverviewDTO {
  id: string;
  name: string;
  logo: string | null;
  status: OrganizationStatus;
}

export interface MemberDTO {
  id: string; // member row id
  userId: string;
  role: OrgRole;
  displayName: string;
  email: string;
  joinedAt: string; // ISO 8601
}

export interface PendingInvitationDTO {
  id: string;
  email: string;
  role: OrgRole;
  status: InvitationStatus;
  expiresAt: string; // ISO 8601
  inviter: { id: string; name: string };
}

/**
 * Uniform return shape for every Server Action in `actions/workspace/*`.
 * Mutations never throw across the server/client boundary — Next.js
 * sanitizes thrown Server Action errors in production, so returning a
 * typed result is the only way the client reliably learns *why* something
 * failed (permission denied vs. not found vs. validation vs. conflict).
 */
export type ActionResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
        fieldErrors?: Record<string, string[]>;
      };
    };
