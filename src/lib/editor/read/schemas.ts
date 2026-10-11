// path: src/lib/editor/read/schemas.ts

import { z } from "zod";

/**
 * Runtime validation for the read server actions. A Server Action is a
 * public HTTP endpoint: TypeScript types on its parameters are NOT enforced
 * at runtime, so every client-supplied value is validated here before it can
 * reach a query. The bounds double as cost limits — they cap how much work
 * (rows, IN-list size, filter count) one request can demand.
 *
 * Deliberately lenient about id FORMAT (any short string): the query layer
 * discards non-UUID ids instead of failing the whole request, because the
 * editor may legitimately probe with values that merely look like ids
 * (an external URL where an asset id was expected, a legacy id).
 */

const shortId = z.string().min(1).max(64);

export const fetchAssetsParamsSchema = z.object({
  /** `null` = library root; omit to not filter by folder. */
  folderId: shortId.nullable().optional(),
  /** Search across several folders (descendants); `"root"` means the root. */
  folderIds: z.array(shortId).max(200).optional(),
  search: z.string().max(200).optional(),
  page: z.number().int().min(1).max(10_000).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});
export type FetchAssetsParamsInput = z.input<typeof fetchAssetsParamsSchema>;

export const assetIdsSchema = z.array(shortId).min(1).max(200);

export const itemFilterSchema = z.object({
  fieldId: shortId,
  operator: z.string().max(32),
  value: z.string().max(500),
});
export type ItemFilterInput = z.input<typeof itemFilterSchema>;

export const collectionItemsOptionsSchema = z.object({
  page: z.number().int().min(1).max(10_000).optional(),
  limit: z.number().int().min(1).max(200).optional(),
  offset: z.number().int().min(0).max(1_000_000).optional(),
  search: z.string().max(200).optional(),
  /** A field id, or `manual` / `none` / `random`. */
  sortBy: shortId.optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
  filters: z.array(itemFilterSchema).max(20).optional(),
  includeAssets: z.boolean().optional(),
});
export type CollectionItemsOptionsInput = z.input<
  typeof collectionItemsOptionsSchema
>;

export const collectionIdsSchema = z.array(shortId).min(1).max(50);
export const itemIdsSchema = z.array(shortId).min(1).max(500);
export const referencedLimitSchema = z.number().int().min(1).max(200);
export const searchTermSchema = z.string().max(200).optional();
export const idSchema = shortId;
