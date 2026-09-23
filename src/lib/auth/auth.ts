import { betterAuth, nanoid } from "better-auth";

import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { db } from "@/drizzle/db";
import { nextCookies } from "better-auth/next-js";
import { createAuthMiddleware } from "better-auth/api";
import { twoFactor } from "better-auth/plugins/two-factor";
import { passkey } from "@better-auth/passkey";
import { admin as adminPlugin } from "better-auth/plugins/admin";
import { organization } from "better-auth/plugins/organization";
import { ac, admin, user } from "@/components/auth/permissions";
import { and, desc, eq } from "drizzle-orm";
import { member } from "@/drizzle/schema";
import {
  polar,
  checkout,
  portal,
  usage,
  webhooks,
} from "@polar-sh/better-auth";
import { Polar } from "@polar-sh/sdk";
import * as authSchema from "@/drizzle/schema";
import { env } from "@/lib/env";
import { sendEmailVerificationEmail } from "@/actions/emails/email-verification";
import { sendDeleteAccountVerificationEmail } from "@/actions/emails/delete-account-verification";
import { sendPasswordResetEmail } from "@/actions/emails/password-reset-email";
import { sendWelcomeEmail } from "@/actions/emails/welcome-email";
//import { subscriptions } from "../products";

// Utility function to safely parse dates
function safeParseDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  return new Date(value);
}

const polarClient = new Polar({
  accessToken: process.env.POLAR_ACCESS_TOKEN,
  server: "sandbox",
});

export const auth = betterAuth({
  appName: "thawkit", //if app name chnges make sure to update
  user: {
    changeEmail: {
      enabled: true,
      sendChangeEmailVerification: async ({ user, url, newEmail }) => {
        await sendEmailVerificationEmail({
          user: { ...user, email: newEmail },
          url,
        });
      },
    },
    deleteUser: {
      enabled: true,
      sendDeleteAccountVerification: async ({ user, url }) => {
        await sendDeleteAccountVerificationEmail({ user, url });
      },
    },
    additionalFields: {
      // favoriteNumber: {
      //   type: "number",
      //   required: false,
      // },
    },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    sendResetPassword: async ({ user, url }) => {
      await sendPasswordResetEmail({ user, url });
    },
  },
  emailVerification: {
    autoSignInAfterVerification: true,
    sendOnSignUp: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmailVerificationEmail({ user, url });
    },
  },
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    },
    discord: {
      clientId: process.env.DISCORD_CLIENT_ID!,
      clientSecret: process.env.DISCORD_CLIENT_SECRET!,
    },
  },
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 30, // 30 sec
    },
  },
  plugins: [
    nextCookies(),
    twoFactor(),
    passkey(),
    adminPlugin({
      ac,
      roles: {
        admin,
        user,
      },
    }),
    organization({
      sendInvitationEmail: async ({
        email,
        organization,
        inviter,
        invitation,
      }) => {
        // await sendOrganizationInviteEmail({
        //   invitation,
        //   inviter: inviter.user,
        //   organization,
        //   email,
        // })
      },
    }),
    polar({
      client: polarClient,
      createCustomerOnSignUp: true,
      use: [
        checkout({
          products: [
            {
              productId: "b73e4d49-befb-4da6-a4b4-a4c3ecc5fdb3", // ID of Product from Polar Dashboard
              slug: "plus", // Custom slug for easy reference in Checkout URL, e.g. /checkout/pro
            },
          ],
          successUrl: env.POLAR_SUCCESS_URL,
          authenticatedUsersOnly: true,
        }),
        portal(),
        usage(),
        webhooks({
          secret: env.POLAR_WEBHOOK_SECRET,
          // onPayload: async ({ data, type }) => {
          //   if (
          //     type === "subscription.created" ||
          //     type === "subscription.active" ||
          //     type === "subscription.canceled" ||
          //     type === "subscription.revoked" ||
          //     type === "subscription.uncanceled" ||
          //     type === "subscription.updated"
          //   ) {
          //     console.log("🎯 Processing subscription webhook:", type);
          //     console.log("📦 Payload data:", JSON.stringify(data, null, 2));

          //     try {
          //       // STEP 1: Extract user ID from customer data
          //       const userId = data.customer?.externalId;
          //       // STEP 2: Build subscription data
          //       const subscriptionData = {
          //         id: data.id,
          //         createdAt: new Date(data.createdAt),
          //         modifiedAt: safeParseDate(data.modifiedAt),
          //         amount: data.amount,
          //         currency: data.currency,
          //         recurringInterval: data.recurringInterval,
          //         status: data.status,
          //         currentPeriodStart:
          //           safeParseDate(data.currentPeriodStart) || new Date(),
          //         currentPeriodEnd:
          //           safeParseDate(data.currentPeriodEnd) || new Date(),
          //         cancelAtPeriodEnd: data.cancelAtPeriodEnd || false,
          //         canceledAt: safeParseDate(data.canceledAt),
          //         startedAt: safeParseDate(data.startedAt) || new Date(),
          //         endsAt: safeParseDate(data.endsAt),
          //         endedAt: safeParseDate(data.endedAt),
          //         customerId: data.customerId,
          //         productId: data.productId,
          //         discountId: data.discountId || null,
          //         checkoutId: data.checkoutId || "",
          //         customerCancellationReason:
          //           data.customerCancellationReason || null,
          //         customerCancellationComment:
          //           data.customerCancellationComment || null,
          //         metadata: data.metadata
          //           ? JSON.stringify(data.metadata)
          //           : null,
          //         customFieldData: data.customFieldData
          //           ? JSON.stringify(data.customFieldData)
          //           : null,
          //         userId: userId as string | null,
          //       };

          //       console.log("💾 Final subscription data:", {
          //         id: subscriptionData.id,
          //         status: subscriptionData.status,
          //         userId: subscriptionData.userId,
          //         amount: subscriptionData.amount,
          //       });

          //       // STEP 3: Use Drizzle's onConflictDoUpdate for proper upsert
          //       await db
          //         .insert(subscription)
          //         .values(subscriptionData)
          //         .onConflictDoUpdate({
          //           target: subscription.id,
          //           set: {
          //             modifiedAt: subscriptionData.modifiedAt || new Date(),
          //             amount: subscriptionData.amount,
          //             currency: subscriptionData.currency,
          //             recurringInterval: subscriptionData.recurringInterval,
          //             status: subscriptionData.status,
          //             currentPeriodStart: subscriptionData.currentPeriodStart,
          //             currentPeriodEnd: subscriptionData.currentPeriodEnd,
          //             cancelAtPeriodEnd: subscriptionData.cancelAtPeriodEnd,
          //             canceledAt: subscriptionData.canceledAt,
          //             startedAt: subscriptionData.startedAt,
          //             endsAt: subscriptionData.endsAt,
          //             endedAt: subscriptionData.endedAt,
          //             customerId: subscriptionData.customerId,
          //             productId: subscriptionData.productId,
          //             discountId: subscriptionData.discountId,
          //             checkoutId: subscriptionData.checkoutId,
          //             customerCancellationReason:
          //               subscriptionData.customerCancellationReason,
          //             customerCancellationComment:
          //               subscriptionData.customerCancellationComment,
          //             metadata: subscriptionData.metadata,
          //             customFieldData: subscriptionData.customFieldData,
          //             userId: subscriptionData.userId,
          //           },
          //         });

          //       console.log("✅ Upserted subscription:", data.id);
          //     } catch (error) {
          //       console.error(
          //         "💥 Error processing subscription webhook:",
          //         error,
          //       );
          //       // Don't throw - let webhook succeed to avoid retries
          //     }
          //   }
          // },
        }),
      ],
    }),
  ],
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: authSchema,
  }),
  hooks: {
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path.startsWith("/sign-up")) {
        const user = ctx.context.newSession?.user ?? {
          name: ctx.body.name,
          email: ctx.body.email,
        };

        if (user != null) {
          //await sendWelcomeEmail(user);
        }
      }
    }),
  },
  databaseHooks: {
    session: {
      create: {
        before: async (userSession, ctx) => {
          const userId = userSession.userId;
          if (!userId) return; // safety

          // Prefer the org the user last actively selected (persisted via
          // actions/organization.ts#setActiveOrganization) so a new
          // session/device resumes where they left off, instead of always
          // defaulting to whichever org they most recently joined.
          // const currentUser = await db.query.user.findFirst({
          //   where: eq(userTable.id, userId),
          //   columns: { lastActiveOrganizationId: true },
          // });

          // if (currentUser?.lastActiveOrganizationId) {
          //   const stillMember = await db.query.member.findFirst({
          //     where: and(
          //       eq(member.userId, userId),
          //       eq(member.organizationId, currentUser.lastActiveOrganizationId)
          //     ),
          //     columns: { id: true },
          //   });

          //   if (stillMember) {
          //     return {
          //       data: {
          //         ...userSession,
          //         activeOrganizationId: currentUser.lastActiveOrganizationId,
          //       },
          //     };
          //   }
          // }

          const membership = await db.query.member.findFirst({
            where: { userId: userSession.userId },
            orderBy: { createdAt: "desc" },
            columns: { organizationId: true },
          });

          if (membership?.organizationId) {
            // user already belongs to an org -> use it
            return {
              data: {
                ...userSession,
                activeOrganizationId: membership?.organizationId,
              },
            };
          }

          return { data: userSession };
        },
      },
    },
  },
});
