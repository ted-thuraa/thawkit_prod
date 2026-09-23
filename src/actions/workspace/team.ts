// path: src/actions/workspace/team.ts

"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { nanoid } from "better-auth";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/lib/auth/auth";
import { db } from "@/drizzle/db";
import {
  invitation,
  member,
  user,
  verification,
} from "@/drizzle/schemas/auth-schema";
import { getServerSession } from "@/lib/sessionServer";
import { requireOrgPermission } from "@/lib/auth/require-org-permission";
import { WORKSPACE_ROLE_MATRIX } from "@/lib/workspace/permissions";
import {
  ConflictError,
  ForbiddenError,
  InvariantViolationError,
  NotFoundError,
  UnauthenticatedError,
  UpstreamServiceError,
  ValidationError,
  isAppError,
} from "@/lib/errors";
import { logger } from "@/lib/logger";
import { sendAdminEmailChangeRequestEmail } from "@/lib/emails/admin-email-change-request";
import type {
  ActionResult,
  MemberDTO,
  OrgRole,
  PendingInvitationDTO,
} from "@/types/workspace";

const TEAM_SETTINGS_PATH = "/workspace/settings/team";

/** Centralizes error → ActionResult mapping so no mutation below swallows or re-throws untyped errors. */
function toActionError<T>(
  error: unknown,
  actionName: string,
  context: Record<string, unknown>,
): ActionResult<T> {
  if (isAppError(error)) {
    logger.warn(`${actionName} rejected`, { ...context, error });
    return { ok: false, error: error.toClientSafe() };
  }

  const message = error instanceof Error ? error.message : String(error);
  if (/duplicate|unique/i.test(message)) {
    const conflict = new ConflictError(
      "A pending invitation already exists for this email.",
    );
    logger.warn(`${actionName} rejected: conflict`, { ...context, error });
    return { ok: false, error: conflict.toClientSafe() };
  }

  logger.error(`${actionName} failed unexpectedly`, { ...context, error });
  const wrapped = new UpstreamServiceError(
    "Something went wrong. Please try again.",
    error,
  );
  return { ok: false, error: wrapped.toClientSafe() };
}

/** Business invariant: an org must always retain at least one owner. */
async function assertNotLastOwner(
  organizationId: string,
  memberId: string,
): Promise<void> {
  const owners = await db.query.member.findMany({
    where: and(
      eq(member.organizationId, organizationId),
      eq(member.role, "owner"),
    ),
    columns: { id: true },
  });

  if (owners.length <= 1 && owners.some((owner) => owner.id === memberId)) {
    throw new InvariantViolationError(
      "This workspace must always have at least one owner. Assign ownership to another member first.",
    );
  }
}

// ---------------------------------------------------------------------------
// Invite member
// ---------------------------------------------------------------------------

const inviteMemberSchema = z.object({
  organizationId: z.string().min(1),
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  role: z.enum(["admin", "member"]), // owners are never created via invite
});
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

export async function inviteMember(
  input: InviteMemberInput,
): Promise<ActionResult<PendingInvitationDTO>> {
  const parsed = inviteMemberSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid invite details.",
        fieldErrors: parsed.error.flatten().fieldErrors,
      },
    };
  }
  const { organizationId, email, role } = parsed.data;

  try {
    const actor = await requireOrgPermission(
      organizationId,
      WORKSPACE_ROLE_MATRIX.manageTeam,
    );

    // Uniqueness of (organizationId, email) is enforced at the DB layer
    // (see `invitation_org_email_unique_idx` in auth-schema.ts); a race
    // here still fails safely via that constraint rather than duplicating.
    const result = await auth.api.inviteMember({
      body: { organizationId, email, role },
      headers: await headers(),
    });

    if (!result) {
      throw new UpstreamServiceError(
        "The invitation service did not return a result.",
      );
    }

    logger.info("Member invited", {
      organizationId,
      invitedEmail: email,
      role,
      actorId: actor.userId,
    });
    revalidatePath(TEAM_SETTINGS_PATH);

    return {
      ok: true,
      data: {
        id: result.id,
        email: result.email,
        role: (result.role ?? role) as OrgRole,
        status: result.status as PendingInvitationDTO["status"],
        expiresAt: new Date(result.expiresAt).toISOString(),
        inviter: { id: actor.userId, name: "" }, // resolved on next listPendingInvitations() read
      },
    };
  } catch (error) {
    return toActionError(error, "inviteMember", { organizationId, email });
  }
}

// ---------------------------------------------------------------------------
// Revoke invitation
// ---------------------------------------------------------------------------

const revokeInvitationSchema = z.object({
  organizationId: z.string().min(1),
  invitationId: z.string().min(1),
});
export type RevokeInvitationInput = z.infer<typeof revokeInvitationSchema>;

export async function revokeInvitation(
  input: RevokeInvitationInput,
): Promise<ActionResult<{ invitationId: string }>> {
  const parsed = revokeInvitationSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid request.",
        fieldErrors: parsed.error.flatten().fieldErrors,
      },
    };
  }
  const { organizationId, invitationId } = parsed.data;

  try {
    const actor = await requireOrgPermission(
      organizationId,
      WORKSPACE_ROLE_MATRIX.manageTeam,
    );

    await auth.api.cancelInvitation({
      body: { invitationId },
      headers: await headers(),
    });

    // Hard-delete rather than leave a "canceled" row: the uniqueness
    // constraint on invitation(organizationId, email) is table-wide (MySQL
    // has no partial/filtered unique indexes), so a lingering canceled row
    // would otherwise permanently block re-inviting that email.
    await db.delete(invitation).where(eq(invitation.id, invitationId));

    logger.info("Invitation revoked", {
      organizationId,
      invitationId,
      actorId: actor.userId,
    });
    revalidatePath(TEAM_SETTINGS_PATH);

    return { ok: true, data: { invitationId } };
  } catch (error) {
    return toActionError(error, "revokeInvitation", {
      organizationId,
      invitationId,
    });
  }
}

// ---------------------------------------------------------------------------
// Remove member
// ---------------------------------------------------------------------------

const removeMemberSchema = z.object({
  organizationId: z.string().min(1),
  memberId: z.string().min(1),
});
export type RemoveMemberInput = z.infer<typeof removeMemberSchema>;

export async function removeMember(
  input: RemoveMemberInput,
): Promise<ActionResult<{ memberId: string }>> {
  const parsed = removeMemberSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid request.",
        fieldErrors: parsed.error.flatten().fieldErrors,
      },
    };
  }
  const { organizationId, memberId } = parsed.data;

  try {
    const actor = await requireOrgPermission(
      organizationId,
      WORKSPACE_ROLE_MATRIX.manageTeam,
    );

    const target = await db.query.member.findFirst({
      where: and(
        eq(member.id, memberId),
        eq(member.organizationId, organizationId),
      ),
    });

    if (!target) {
      throw new NotFoundError(
        "That member no longer belongs to this workspace.",
        { memberId },
      );
    }

    if (target.userId === actor.userId) {
      throw new ValidationError(
        "You can't remove yourself this way — use “Leave workspace” instead.",
      );
    }

    if (target.role === "owner" && actor.role !== "owner") {
      throw new ForbiddenError("Only an owner can remove another owner.");
    }

    if (target.role === "owner") {
      await assertNotLastOwner(organizationId, memberId);
    }

    await auth.api.removeMember({
      body: { memberIdOrEmail: target.id, organizationId },
      headers: await headers(),
    });

    logger.info("Member removed", {
      organizationId,
      removedMemberId: memberId,
      removedUserId: target.userId,
      actorId: actor.userId,
    });
    revalidatePath(TEAM_SETTINGS_PATH);

    return { ok: true, data: { memberId } };
  } catch (error) {
    return toActionError(error, "removeMember", { organizationId, memberId });
  }
}

// ---------------------------------------------------------------------------
// Change member role
// ---------------------------------------------------------------------------

const changeMemberRoleSchema = z.object({
  organizationId: z.string().min(1),
  memberId: z.string().min(1),
  role: z.enum(["owner", "admin", "member"]),
});
export type ChangeMemberRoleInput = z.infer<typeof changeMemberRoleSchema>;

export async function changeMemberRole(
  input: ChangeMemberRoleInput,
): Promise<ActionResult<MemberDTO>> {
  const parsed = changeMemberRoleSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid request.",
        fieldErrors: parsed.error.flatten().fieldErrors,
      },
    };
  }
  const { organizationId, memberId, role: newRole } = parsed.data;

  try {
    // Owner-only: admins cannot grant or revoke roles, including their own.
    const actor = await requireOrgPermission(
      organizationId,
      WORKSPACE_ROLE_MATRIX.manageRoles,
    );

    const target = await db.query.member.findFirst({
      where: and(
        eq(member.id, memberId),
        eq(member.organizationId, organizationId),
      ),
      with: { user: { columns: { id: true, name: true, email: true } } },
    });

    if (!target) {
      throw new NotFoundError(
        "That member no longer belongs to this workspace.",
        { memberId },
      );
    }

    if (target.role === "owner" && newRole !== "owner") {
      await assertNotLastOwner(organizationId, memberId);
    }

    await auth.api.updateMemberRole({
      body: { organizationId, memberId, role: newRole },
      headers: await headers(),
    });

    logger.info("Member role changed", {
      organizationId,
      memberId,
      previousRole: target.role,
      newRole,
      actorId: actor.userId,
    });
    revalidatePath(TEAM_SETTINGS_PATH);

    return {
      ok: true,
      data: {
        id: target.id,
        userId: target.userId,
        role: newRole,
        displayName: target.displayName ?? target.user.name,
        email: target.user.email,
        joinedAt: target.createdAt.toISOString(),
      },
    };
  } catch (error) {
    return toActionError(error, "changeMemberRole", {
      organizationId,
      memberId,
      newRole,
    });
  }
}

// ---------------------------------------------------------------------------
// Update member display name (org-scoped, not the global user.name)
// ---------------------------------------------------------------------------

const updateMemberDisplayNameSchema = z.object({
  organizationId: z.string().min(1),
  memberId: z.string().min(1),
  displayName: z.string().trim().min(1, "Display name can't be empty.").max(80),
});
export type UpdateMemberDisplayNameInput = z.infer<
  typeof updateMemberDisplayNameSchema
>;

export async function updateMemberDisplayName(
  input: UpdateMemberDisplayNameInput,
): Promise<ActionResult<Pick<MemberDTO, "id" | "displayName">>> {
  const parsed = updateMemberDisplayNameSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid request.",
        fieldErrors: parsed.error.flatten().fieldErrors,
      },
    };
  }
  const { organizationId, memberId, displayName } = parsed.data;

  try {
    const actor = await requireOrgPermission(
      organizationId,
      WORKSPACE_ROLE_MATRIX.manageTeam,
    );

    // mysql2 returns a [ResultSetHeader, FieldPacket[]] tuple — MySQL has no
    // RETURNING clause, so affectedRows is how we detect a no-op update.
    const [result] = await db
      .update(member)
      .set({ displayName })
      .where(
        and(eq(member.id, memberId), eq(member.organizationId, organizationId)),
      );

    if (result.affectedRows === 0) {
      throw new NotFoundError(
        "That member no longer belongs to this workspace.",
        { memberId },
      );
    }

    logger.info("Member display name updated", {
      organizationId,
      memberId,
      actorId: actor.userId,
    });
    revalidatePath(TEAM_SETTINGS_PATH);

    return { ok: true, data: { id: memberId, displayName } };
  } catch (error) {
    return toActionError(error, "updateMemberDisplayName", {
      organizationId,
      memberId,
    });
  }
}

// ---------------------------------------------------------------------------
// Admin-initiated email change — request + confirm
// ---------------------------------------------------------------------------
//
// SECURITY: an org owner can REQUEST an email change for a teammate, but
// `user.email` is never written here. This only creates a short-lived
// verification record and notifies the TARGET's current, already-verified
// email address — not the requested new one. The change takes effect only
// when the target confirms it while signed in as themselves
// (`confirmMemberEmailChange`). This prevents an owner from silently
// rerouting a teammate's login email to an address the owner controls,
// which would otherwise be a direct account-takeover vector.

const ADMIN_EMAIL_CHANGE_IDENTIFIER_PREFIX = "org-admin-email-change:";
const ADMIN_EMAIL_CHANGE_TTL_MS = 24 * 60 * 60 * 1000;

const requestMemberEmailChangeSchema = z.object({
  organizationId: z.string().min(1),
  memberId: z.string().min(1),
  newEmail: z
    .string()
    .trim()
    .toLowerCase()
    .email("Enter a valid email address."),
});
export type RequestMemberEmailChangeInput = z.infer<
  typeof requestMemberEmailChangeSchema
>;

export async function requestMemberEmailChange(
  input: RequestMemberEmailChangeInput,
): Promise<
  ActionResult<{ memberId: string; requestedEmail: string; expiresAt: string }>
> {
  const parsed = requestMemberEmailChangeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid request.",
        fieldErrors: parsed.error.flatten().fieldErrors,
      },
    };
  }
  const { organizationId, memberId, newEmail } = parsed.data;

  try {
    const actor = await requireOrgPermission(
      organizationId,
      WORKSPACE_ROLE_MATRIX.manageMemberEmail,
    );

    const target = await db.query.member.findFirst({
      where: and(
        eq(member.id, memberId),
        eq(member.organizationId, organizationId),
      ),
      with: { user: { columns: { id: true, name: true, email: true } } },
    });

    if (!target) {
      throw new NotFoundError(
        "That member no longer belongs to this workspace.",
        { memberId },
      );
    }

    if (target.userId === actor.userId) {
      throw new ValidationError(
        "Use your account settings to change your own email address.",
      );
    }

    if (newEmail === target.user.email) {
      throw new ValidationError("That is already this member's email address.");
    }

    const existingEmailOwner = await db.query.user.findFirst({
      where: eq(user.email, newEmail),
    });
    if (existingEmailOwner) {
      throw new ConflictError(
        "That email address is already in use by another account.",
      );
    }

    const token = nanoid(32);
    const expiresAt = new Date(Date.now() + ADMIN_EMAIL_CHANGE_TTL_MS);

    await db.insert(verification).values({
      id: nanoid(),
      identifier: `${ADMIN_EMAIL_CHANGE_IDENTIFIER_PREFIX}${token}`,
      value: JSON.stringify({
        targetUserId: target.userId,
        organizationId,
        requestedByUserId: actor.userId,
        newEmail,
      }),
      expiresAt,
    });

    await sendAdminEmailChangeRequestEmail({
      user: { name: target.user.name, email: target.user.email },
      requestedBy: { name: "" },
      newEmail,
      confirmationToken: token,
      expiresAt,
    });

    logger.info("Admin-initiated email change requested", {
      organizationId,
      memberId,
      targetUserId: target.userId,
      actorId: actor.userId,
    });

    return {
      ok: true,
      data: {
        memberId,
        requestedEmail: newEmail,
        expiresAt: expiresAt.toISOString(),
      },
    };
  } catch (error) {
    return toActionError(error, "requestMemberEmailChange", {
      organizationId,
      memberId,
    });
  }
}

/**
 * Intended to be called from a (not implemented here) confirmation route
 * that the target hits after clicking the link in their notification
 * email. Requires the caller to be authenticated AND to be the exact user
 * the change targets — deliberately not a bare token-in-URL flow, so a
 * leaked link (forwarded email, shared browser history) isn't sufficient
 * on its own to complete the change.
 */
export async function confirmMemberEmailChange(
  token: string,
): Promise<ActionResult<{ newEmail: string }>> {
  if (!token) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Missing confirmation token.",
      },
    };
  }

  try {
    const session = await getServerSession();
    if (!session?.user) {
      throw new UnauthenticatedError(
        "Sign in as the account holder to confirm this change.",
      );
    }

    const record = await db.query.verification.findFirst({
      where: eq(
        verification.identifier,
        `${ADMIN_EMAIL_CHANGE_IDENTIFIER_PREFIX}${token}`,
      ),
    });

    if (!record || record.expiresAt < new Date()) {
      throw new NotFoundError(
        "This confirmation link is invalid or has expired.",
      );
    }

    const payload = JSON.parse(record.value) as {
      targetUserId: string;
      newEmail: string;
      organizationId: string;
      requestedByUserId: string;
    };

    if (payload.targetUserId !== session.user.id) {
      logger.warn("Email-change confirmation attempted by a non-target user", {
        sessionUserId: session.user.id,
        targetUserId: payload.targetUserId,
      });
      // Deliberately vague: do not reveal whether the token was otherwise valid.
      throw new ForbiddenError(
        "This confirmation link does not belong to your account.",
      );
    }

    const existingEmailOwner = await db.query.user.findFirst({
      where: eq(user.email, payload.newEmail),
    });
    if (existingEmailOwner) {
      throw new ConflictError("That email address is no longer available.");
    }

    await db
      .update(user)
      .set({ email: payload.newEmail, emailVerified: true })
      .where(eq(user.id, payload.targetUserId));
    await db.delete(verification).where(eq(verification.id, record.id));

    logger.info("Admin-initiated email change confirmed by target user", {
      targetUserId: payload.targetUserId,
      organizationId: payload.organizationId,
      requestedByUserId: payload.requestedByUserId,
    });

    return { ok: true, data: { newEmail: payload.newEmail } };
  } catch (error) {
    return toActionError(error, "confirmMemberEmailChange", { token });
  }
}
