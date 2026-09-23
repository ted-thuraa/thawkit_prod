// path: src/drizzle/schemas/auth-schema.ts
//
// ─── Postgres port ───────────────────────────────────────────────────────────
// mysqlTable → pgTable, mysqlEnum → pgEnum, int → integer.
//
// varchar(255) → text: Postgres stores both identically and there is no
// performance difference, so the arbitrary 255 cap buys nothing. Length is
// still worth enforcing at the Zod layer where the real validation lives.
// If you'd rather keep strict parity with the MySQL DDL, `varchar` is
// exported from pg-core with the same `{ length: 255 }` option.
//
// timestamp → timestamp({ withTimezone: true }): this one matters. A plain
// Postgres `timestamp` (without time zone) is parsed by node-pg into a Date
// interpreted in the SERVER PROCESS's local zone, so a container running on
// EAT would shift every read by three hours. `timestamptz` stores an
// absolute instant and round-trips correctly everywhere — it is the direct
// replacement for the `timezone: "Z"` pin on the old mysql2 pool.
//
// Extra-config callbacks still return arrays (drizzle-orm v1).
// ─────────────────────────────────────────────────────────────────────────────

import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  boolean,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
  twoFactorEnabled: boolean("two_factor_enabled").default(false),
  role: text("role"),
  banned: boolean("banned").default(false),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires", { withTimezone: true }),
  stripeCustomerId: text("stripe_customer_id"),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  impersonatedBy: text("impersonated_by"),
  activeOrganizationId: text("active_organization_id"),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", {
    withTimezone: true,
  }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
    withTimezone: true,
  }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const twoFactor = pgTable("two_factor", {
  id: text("id").primaryKey(),
  secret: text("secret").notNull(),
  backupCodes: text("backup_codes").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  // ADDED: better-auth 1.7's twoFactor account-lockout feature.
  verified: boolean("verified").notNull().default(false),
  failedVerificationCount: integer("failed_verification_count")
    .notNull()
    .default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
});

export const passkey = pgTable("passkey", {
  id: text("id").primaryKey(),
  name: text("name"),
  publicKey: text("public_key").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  credentialID: text("credential_id").notNull(),
  counter: integer("counter").notNull(),
  deviceType: text("device_type").notNull(),
  backedUp: boolean("backed_up").notNull(),
  transports: text("transports"),
  createdAt: timestamp("created_at", { withTimezone: true }),
  aaguid: text("aaguid"),
});

// Required by the /workspace bootstrapping sequence to short-circuit
// suspended/billing-lapsed workspaces before rendering the dashboard.
export const organizationStatusValues = [
  "active",
  "suspended",
  "trial_expired",
] as const;
export type OrganizationStatusValue = (typeof organizationStatusValues)[number];

// pgEnum creates a real Postgres type, so the constraint is enforced in the
// DB exactly as mysqlEnum was. Trade-off: adding a value later is a cheap
// ALTER TYPE ... ADD VALUE, but renaming or removing one is awkward. If a
// status set turns out to churn, `text("status", { enum: values })` gives
// the same TypeScript union with no DB type to migrate.
export const organizationStatus = pgEnum(
  "organization_status",
  organizationStatusValues,
);

export const organization = pgTable("organization", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").unique(),
  logo: text("logo"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  metadata: text("metadata"),
  status: organizationStatus("status").default("active").notNull(),
});

export const member = pgTable(
  "member",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").default("member").notNull(),
    // Org-scoped display name override, edited via Team settings without
    // mutating the global `user.name` (shared across every org a user
    // belongs to).
    displayName: text("display_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    // One membership row per (org, user), and the primary lookup path for
    // requireOrgPermission() — hit on nearly every workspace request.
    uniqueIndex("member_org_user_unique_idx").on(
      table.organizationId,
      table.userId,
    ),
  ],
);

export const invitation = pgTable(
  "invitation",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role"),
    status: text("status").default("pending").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    inviterId: text("inviter_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // ADDED: every other table in this file has this; invitation never did.
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("invitation_org_email_pending_unique_idx")
      .on(table.organizationId, table.email)
      .where(sql`${table.status} = 'pending'`),
    index("invitation_org_status_idx").on(table.organizationId, table.status),
  ],
);

export const subscription = pgTable("subscription", {
  id: text("id").primaryKey(),
  amount: integer("amount").notNull(),
  currency: text("currency").notNull(),
  recurringInterval: text("recurring_interval").notNull(),
  status: text("status").notNull(),

  currentPeriodStart: timestamp("current_period_start", {
    withTimezone: true,
  }).notNull(),
  currentPeriodEnd: timestamp("current_period_end", {
    withTimezone: true,
  }).notNull(),

  cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false).notNull(),
  canceledAt: timestamp("canceled_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),

  customerId: text("customer_id").notNull(),
  productId: text("product_id").notNull(),
  discountId: text("discount_id"),
  checkoutId: text("checkout_id").notNull(),

  customerCancellationReason: text("customer_cancellation_reason"),
  customerCancellationComment: text("customer_cancellation_comment"),

  metadata: text("metadata"),
  customFieldData: text("custom_field_data"),

  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  modifiedAt: timestamp("modified_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),

  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});
