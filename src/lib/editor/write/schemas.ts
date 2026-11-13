// path: src/lib/editor/write/schemas.ts

import { z } from "zod";

/**
 * Runtime validation for the CMS write server actions. Server Actions are
 * public HTTP endpoints: TypeScript parameter types are not enforced at
 * runtime, so every client-supplied value is validated here before it can
 * reach a query. Ids are strict UUIDs on the write path (unlike the lenient
 * read path) — a write with a malformed id is a bug, not a probe.
 *
 * The bounds double as cost limits (rows / values / bytes one request may
 * demand).
 */

export const uuidSchema = z.string().uuid();

export const FIELD_TYPE_VALUES = [
  "text",
  "number",
  "boolean",
  "date",
  "date_only",
  "color",
  "reference",
  "multi_reference",
  "rich_text",
  "image",
  "audio",
  "video",
  "document",
  "link",
  "email",
  "phone",
  "option",
  "count",
] as const;

const MAX_VALUE_BYTES = 2_000_000;

/** A form value: scalar, list, or JSON document (rich text). */
const itemValueSchema = z
  .union([
    z.string().max(MAX_VALUE_BYTES),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(z.unknown()).max(1000),
    z.record(z.string(), z.unknown()),
  ])
  .refine((v) => JSON.stringify(v ?? null).length <= MAX_VALUE_BYTES, {
    message: "Value too large",
  });

export const itemValuesSchema = z
  .record(uuidSchema, itemValueSchema)
  .refine((v) => Object.keys(v).length <= 200, { message: "Too many values" });

export type ItemValuesInput = z.infer<typeof itemValuesSchema>;

const collectionNameSchema = z.string().trim().min(1).max(200);

export const collectionSortingSchema = z.object({
  field: z.string().min(1).max(64),
  direction: z.enum(["asc", "desc", "manual"]),
});

export const createCollectionSchema = z.object({
  name: collectionNameSchema,
});

export const updateCollectionSchema = z
  .object({
    name: collectionNameSchema.optional(),
    sorting: collectionSortingSchema.nullable().optional(),
  })
  .strict();

export const reorderIdsSchema = z.array(uuidSchema).min(1).max(500);

export const optionSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
});

export const fieldDataSchema = z
  .object({
    options: z.array(optionSchema).max(200).optional(),
    count: z
      .object({ collectionId: uuidSchema, fieldId: uuidSchema })
      .optional(),
  })
  .passthrough();

export const createFieldSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    type: z.enum(FIELD_TYPE_VALUES),
    default: z.string().max(10_000).nullable().optional(),
    reference_collection_id: uuidSchema.nullable().optional(),
    data: fieldDataSchema.optional(),
  })
  .strict();

export const updateFieldSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    default: z.string().max(10_000).nullable().optional(),
    reference_collection_id: uuidSchema.nullable().optional(),
    hidden: z.boolean().optional(),
    data: fieldDataSchema.optional(),
  })
  .strict();
