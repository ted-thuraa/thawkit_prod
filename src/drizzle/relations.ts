// path: src/drizzle/relations.ts
//
// UNCHANGED by the Postgres migration — not one line. Relational Queries v2
// addresses columns through the schema namespace (`r.session.userId`) rather
// than importing dialect-specific table objects, so the whole graph is
// dialect-agnostic. This is the file that would have been the most painful
// rewrite under the old `relations()` API.

import { defineRelations } from "drizzle-orm";
import * as schema from "./schema";

/**
 * ─── Relation Graph (Relational Queries v2) ─────────────────────────────────
 *
 * Translation table from the pre-v1 API:
 *   fields: [a.x]        → from: r.a.x
 *   references: [b.y]    → to:   r.b.y
 *   relationName: "..."  → alias: "..."
 *
 * ON ALIASES: an alias is only required to disambiguate when TWO OR MORE
 * relations connect the same pair of tables, and no pair here does. If that
 * changes — say campaign gains both `creator` and `lastEditedBy` pointing at
 * `user` — add a matching `alias` to BOTH sides at that point.
 *
 * ON `optional: false`: applied only where the underlying FK column is
 * `.notNull()`. It is a TYPE-LEVEL assertion — it makes the key
 * non-nullable in results without adding a runtime check — so it is correct
 * here only because each of those columns carries a real FK constraint.
 *
 * ON BARE `r.many.x()`: a many side with no `from`/`to` infers its keys from
 * the single `one` side pointing back at it. Every bare many below has
 * exactly one counterpart.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const relations = defineRelations(schema, (r) => ({
  // ── User ──────────────────────────────────────────────────────────────────
  user: {
    sessions: r.many.session(),
    accounts: r.many.account(),
    twoFactors: r.many.twoFactor(),
    passkeys: r.many.passkey(),
    memberships: r.many.member(),
    sentInvitations: r.many.invitation(),
    subscriptions: r.many.subscription(),
    // Reverse side of campaign.creator — powers
    // db.query.user.findFirst({ with: { createdCampaigns: true } }).
    createdCampaigns: r.many.campaign(),
  },

  // ── Session ───────────────────────────────────────────────────────────────
  session: {
    user: r.one.user({
      from: r.session.userId,
      to: r.user.id,
      optional: false,
    }),
    // activeOrganizationId is nullable — a session need not have a workspace
    // selected yet, so this stays optional.
    activeOrganization: r.one.organization({
      from: r.session.activeOrganizationId,
      to: r.organization.id,
    }),
  },

  // ── Account ───────────────────────────────────────────────────────────────
  account: {
    user: r.one.user({
      from: r.account.userId,
      to: r.user.id,
      optional: false,
    }),
  },

  // ── TwoFactor ─────────────────────────────────────────────────────────────
  twoFactor: {
    user: r.one.user({
      from: r.twoFactor.userId,
      to: r.user.id,
      optional: false,
    }),
  },

  // ── Passkey ───────────────────────────────────────────────────────────────
  passkey: {
    user: r.one.user({
      from: r.passkey.userId,
      to: r.user.id,
      optional: false,
    }),
  },

  // ── Organization ("Workspace") ────────────────────────────────────────────
  organization: {
    members: r.many.member(),
    invitations: r.many.invitation(),
    activeSessions: r.many.session(),
    campaigns: r.many.campaign(),
    //funnels: r.many.funnel(),
    // components: r.many.component(),
    // layerStyles: r.many.layerStyle(),
  },

  // ── Member ────────────────────────────────────────────────────────────────
  member: {
    organization: r.one.organization({
      from: r.member.organizationId,
      to: r.organization.id,
      optional: false,
    }),
    user: r.one.user({
      from: r.member.userId,
      to: r.user.id,
      optional: false,
    }),
  },

  // ── Invitation ────────────────────────────────────────────────────────────
  invitation: {
    organization: r.one.organization({
      from: r.invitation.organizationId,
      to: r.organization.id,
      optional: false,
    }),
    inviter: r.one.user({
      from: r.invitation.inviterId,
      to: r.user.id,
      optional: false,
    }),
  },

  // ── Subscription ──────────────────────────────────────────────────────────
  subscription: {
    user: r.one.user({
      from: r.subscription.userId,
      to: r.user.id,
      optional: false,
    }),
  },

  // ── Campaign ──────────────────────────────────────────────────────────────
  campaign: {
    organization: r.one.organization({
      from: r.campaign.organizationId,
      to: r.organization.id,
      optional: false,
    }),
    // createdBy is nullable (ON DELETE SET NULL) — creator stays optional.
    // Powers listCampaigns' `with: { creator: true }` for CampaignDTO.createdBy.
    creator: r.one.user({
      from: r.campaign.createdBy,
      to: r.user.id,
    }),
    funnels: r.one.funnel(),
    // audiences.funnelId points at campaign.id — see the decision note in
    // funnel-content-schema.ts. The COLUMN keeps its legacy name; the
    // relation is named for what it actually is.
    // audiences: r.many.audiences(),
  },

  // ── Funnel ────────────────────────────────────────────────────────────────
  funnel: {
    organization: r.one.organization({
      from: r.funnel.organizationId,
      to: r.organization.id,
      optional: false,
    }),
    campaign: r.one.campaign({
      from: r.funnel.campaignId,
      to: r.campaign.id,
      optional: false,
    }),
    pages: r.many.page(),
    funnelVersions: r.many.funnelVersions(),
    //questionCategories: r.many.questionCategories(),
  },

  //── Funnel Version ────────────────────────────────────────────────────────
  funnelVersions: {
    funnel: r.one.funnel({
      from: r.funnelVersions.funnelId,
      to: r.funnel.id,
    }),
  },

  // ── Page ──────────────────────────────────────────────────────────────────
  page: {
    funnel: r.one.funnel({
      from: r.page.funnelId,
      to: r.funnel.id,
    }),
  },

  // ── Question Category ─────────────────────────────────────────────────────
  // questionCategories: {
  //   funnel: r.one.funnel({
  //     from: r.questionCategories.funnelId,
  //     to: r.funnel.id,
  //   }),
  // },

  // ── Audience ──────────────────────────────────────────────────────────────
  // Belongs to `campaign`, not `funnel`, despite the column name.
  // audiences: {
  //   campaign: r.one.campaign({
  //     from: r.audiences.funnelId,
  //     to: r.campaign.id,
  //   }),
  // },

  // ── Component ─────────────────────────────────────────────────────────────
  // component: {
  //   organization: r.one.organization({
  //     from: r.component.organizationId,
  //     to: r.organization.id,
  //     optional: false,
  //   }),
  // },

  // ── Layer Style ───────────────────────────────────────────────────────────
  // layerStyle: {
  //   organization: r.one.organization({
  //     from: r.layerStyle.organizationId,
  //     to: r.organization.id,
  //     optional: false,
  //   }),
  // },
}));
