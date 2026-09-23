// path: src/drizzle/schemas/campaigns-schema.ts
//
// Postgres port — see the header of auth-schema.ts for the column-type
// rationale (text over varchar, timestamptz over bare timestamp).

import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  index,
  jsonb,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth-schema";

export const campaignStatusValues = ["draft", "live", "archived"] as const;
export type CampaignStatusValue = (typeof campaignStatusValues)[number];

export const campaignStatus = pgEnum("campaign_status", campaignStatusValues);

export const campaign = pgTable(
  "campaigns",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    status: campaignStatus("status").default("draft").notNull(),
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("campaigns_org_status_created_idx").on(
      table.organizationId,
      table.status,
      table.createdAt,
      table.id,
    ),
  ],
);

// publishFunnel() writes `status: "published"` and `publishedAt`, neither of
// which existed on this table before. Adjust the value set if the builder
// distinguishes more states.
export const funnelStatusValues = ["draft", "published", "archived"] as const;
export type FunnelStatusValue = (typeof funnelStatusValues)[number];

export const funnelStatus = pgEnum("funnel_status", funnelStatusValues);

export const funnel = pgTable(
  "funnels",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    campaignId: text("campaign_id")
      .notNull()
      .unique()
      .references(() => campaign.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    status: funnelStatus("status").default("draft").notNull(),
    settings: jsonb("settings").default("{}"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("funnels_organization_id_idx").on(table.organizationId),
    index("funnels_campaign_id_idx").on(table.campaignId),
  ],
);
