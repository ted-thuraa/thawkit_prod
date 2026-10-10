CREATE TABLE "assets" (
	"id" uuid DEFAULT gen_random_uuid(),
	"organization_id" text NOT NULL,
	"asset_folder_id" uuid,
	"source" text DEFAULT 'library' NOT NULL,
	"filename" text NOT NULL,
	"storage_path" text,
	"public_url" text,
	"file_size" integer,
	"mime_type" text,
	"width" integer,
	"height" integer,
	"content" text,
	"content_hash" text,
	"is_published" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	CONSTRAINT "assets_pkey" PRIMARY KEY("id","is_published")
);
--> statement-breakpoint
CREATE TABLE "asset_folders" (
	"id" uuid DEFAULT gen_random_uuid(),
	"organization_id" text NOT NULL,
	"asset_folder_id" uuid,
	"name" text NOT NULL,
	"depth" integer DEFAULT 0 NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"is_published" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	CONSTRAINT "asset_folders_pkey" PRIMARY KEY("id","is_published")
);
--> statement-breakpoint
ALTER TABLE "asset_folders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "collections" (
	"id" uuid DEFAULT gen_random_uuid(),
	"funnel_id" text NOT NULL,
	"name" text NOT NULL,
	"uuid" uuid DEFAULT gen_random_uuid() NOT NULL UNIQUE,
	"sorting" jsonb,
	"order" integer DEFAULT 0 NOT NULL,
	"is_published" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	CONSTRAINT "collections_pkey" PRIMARY KEY("id","is_published")
);
--> statement-breakpoint
CREATE TABLE "collection_fields" (
	"id" uuid DEFAULT gen_random_uuid(),
	"collection_id" uuid NOT NULL,
	"reference_collection_id" uuid,
	"name" text NOT NULL,
	"key" text,
	"type" text NOT NULL,
	"default" text,
	"fillable" boolean DEFAULT true NOT NULL,
	"order" integer NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"is_computed" boolean DEFAULT false NOT NULL,
	"data" jsonb DEFAULT '{}' NOT NULL,
	"is_published" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	CONSTRAINT "collection_fields_pkey" PRIMARY KEY("id","is_published")
);
--> statement-breakpoint
CREATE TABLE "collection_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"collection_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"processed_rows" integer DEFAULT 0 NOT NULL,
	"failed_rows" integer DEFAULT 0 NOT NULL,
	"column_mapping" jsonb NOT NULL,
	"csv_data" jsonb,
	"errors" jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "collection_items" (
	"id" uuid DEFAULT gen_random_uuid(),
	"collection_id" uuid NOT NULL,
	"manual_order" bigint DEFAULT 0 NOT NULL,
	"is_publishable" boolean DEFAULT true NOT NULL,
	"is_published" boolean DEFAULT false,
	"content_hash" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	CONSTRAINT "collection_items_pkey" PRIMARY KEY("id","is_published")
);
--> statement-breakpoint
CREATE TABLE "collection_item_values" (
	"id" uuid DEFAULT gen_random_uuid(),
	"value" text,
	"item_id" uuid NOT NULL,
	"field_id" uuid NOT NULL,
	"is_published" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	CONSTRAINT "collection_item_values_pkey" PRIMARY KEY("id","is_published")
);
--> statement-breakpoint
CREATE INDEX "assets_asset_folder_id_idx" ON "assets" ("asset_folder_id","is_published") WHERE "deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "assets_organization_id_idx" ON "assets" ("organization_id") WHERE "deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "assets_filename_idx" ON "assets" ("filename") WHERE "deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "assets_mime_type_idx" ON "assets" ("mime_type") WHERE "deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "assets_source_idx" ON "assets" ("source") WHERE "deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "assets_is_published_idx" ON "assets" ("is_published") WHERE "deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "assets_id_draft_unique_idx" ON "assets" ("id") WHERE "is_published" = false AND "deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "asset_folders_organization_id_idx" ON "asset_folders" ("organization_id") WHERE "deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "asset_folders_parent_idx" ON "asset_folders" ("asset_folder_id","is_published") WHERE "deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "asset_folders_name_idx" ON "asset_folders" ("name","is_published") WHERE "deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "asset_folders_draft_id_unique_idx" ON "asset_folders" ("id") WHERE "is_published" = false AND "deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "collections_funnel_id_idx" ON "collections" ("funnel_id");--> statement-breakpoint
CREATE INDEX "collections_is_published_idx" ON "collections" ("is_published");--> statement-breakpoint
CREATE INDEX "collection_fields_collection_id_idx" ON "collection_fields" ("collection_id");--> statement-breakpoint
CREATE INDEX "collection_fields_is_published_idx" ON "collection_fields" ("is_published");--> statement-breakpoint
CREATE INDEX "collection_fields_type_idx" ON "collection_fields" ("type");--> statement-breakpoint
CREATE INDEX "collection_fields_listing_idx" ON "collection_fields" ("collection_id","is_published","order") WHERE "deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "collection_imports_collection_id_idx" ON "collection_imports" ("collection_id");--> statement-breakpoint
CREATE INDEX "collection_imports_status_idx" ON "collection_imports" ("status");--> statement-breakpoint
CREATE INDEX "collection_items_collection_id_idx" ON "collection_items" ("collection_id");--> statement-breakpoint
CREATE INDEX "collection_items_is_published_idx" ON "collection_items" ("is_published");--> statement-breakpoint
CREATE INDEX "collection_items_listing_idx" ON "collection_items" ("collection_id","is_published","manual_order","created_at" DESC NULLS LAST) WHERE "deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "collection_item_values_item_id_idx" ON "collection_item_values" ("item_id");--> statement-breakpoint
CREATE INDEX "collection_item_values_field_id_idx" ON "collection_item_values" ("field_id");--> statement-breakpoint
CREATE INDEX "collection_item_values_is_published_idx" ON "collection_item_values" ("is_published");--> statement-breakpoint
CREATE UNIQUE INDEX "collection_item_values_item_field_unique_idx" ON "collection_item_values" ("item_id","field_id","is_published") WHERE "deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "collection_item_values_field_published_idx" ON "collection_item_values" ("field_id","is_published") WHERE "deleted_at" IS NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "fk_assets_asset_folder" FOREIGN KEY ("asset_folder_id","is_published") REFERENCES "asset_folders"("id","is_published") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "asset_folders" ADD CONSTRAINT "asset_folders_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "asset_folders" ADD CONSTRAINT "fk_asset_folders_parent" FOREIGN KEY ("asset_folder_id","is_published") REFERENCES "asset_folders"("id","is_published") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_funnel_id_funnels_id_fkey" FOREIGN KEY ("funnel_id") REFERENCES "funnels"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "collection_fields" ADD CONSTRAINT "collection_fields_collection_fkey" FOREIGN KEY ("collection_id","is_published") REFERENCES "collections"("id","is_published") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_collection_fkey" FOREIGN KEY ("collection_id","is_published") REFERENCES "collections"("id","is_published") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "collection_item_values" ADD CONSTRAINT "collection_item_values_item_fkey" FOREIGN KEY ("item_id","is_published") REFERENCES "collection_items"("id","is_published") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "collection_item_values" ADD CONSTRAINT "collection_item_values_field_fkey" FOREIGN KEY ("field_id","is_published") REFERENCES "collection_fields"("id","is_published") ON DELETE CASCADE;