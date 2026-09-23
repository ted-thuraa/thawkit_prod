// path: src/lib/validation/campaign.ts

import { z } from "zod";

/**
 * Single source of truth for campaign input shapes, imported by BOTH the
 * client form (`zodResolver`) and the Server Action (`safeParse`). This is
 * what guarantees client and server validation can never silently drift —
 * there is only one schema, not two copies kept in sync by hand.
 */

export const createCampaignSchema = z.object({
  organizationId: z.string().min(1),
  name: z
    .string()
    .trim()
    .min(2, "Campaign name must be at least 2 characters.")
    .max(100),
});
export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;

export const updateCampaignSchema = z
  .object({
    organizationId: z.string().min(1),
    campaignId: z.string().min(1),
    name: z
      .string()
      .trim()
      .min(2, "Campaign name must be at least 2 characters.")
      .max(100)
      .optional(),
    status: z.enum(["draft", "live", "archived"]).optional(),
  })
  .refine((data) => data.name !== undefined || data.status !== undefined, {
    message: "Provide at least a name or a status to update.",
  });
export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>;

export const deleteCampaignSchema = z.object({
  organizationId: z.string().min(1),
  campaignId: z.string().min(1),
});
export type DeleteCampaignInput = z.infer<typeof deleteCampaignSchema>;
