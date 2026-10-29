CREATE TYPE "organization_status" AS ENUM('active', 'suspended', 'trial_expired');--> statement-breakpoint
CREATE TYPE "campaign_status" AS ENUM('draft', 'live', 'archived');--> statement-breakpoint
CREATE TYPE "funnel_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "layer_style_kind" AS ENUM('base', 'combo', 'global');--> statement-breakpoint
CREATE TYPE "page_type" AS ENUM('landing_page', 'normal_page', 'result_page');--> statement-breakpoint
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
CREATE TABLE "account" (
	"id" text PRIMARY KEY,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"inviter_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"display_name" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"slug" text UNIQUE,
	"logo" text,
	"created_at" timestamp with time zone NOT NULL,
	"metadata" text,
	"status" "organization_status" DEFAULT 'active'::"organization_status" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "passkey" (
	"id" text PRIMARY KEY,
	"name" text,
	"public_key" text NOT NULL,
	"user_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"counter" integer NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean NOT NULL,
	"transports" text,
	"created_at" timestamp with time zone,
	"aaguid" text
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL UNIQUE,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"impersonated_by" text,
	"active_organization_id" text
);
--> statement-breakpoint
CREATE TABLE "subscription" (
	"id" text PRIMARY KEY,
	"amount" integer NOT NULL,
	"currency" text NOT NULL,
	"recurring_interval" text NOT NULL,
	"status" text NOT NULL,
	"current_period_start" timestamp with time zone NOT NULL,
	"current_period_end" timestamp with time zone NOT NULL,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"canceled_at" timestamp with time zone,
	"started_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"customer_id" text NOT NULL,
	"product_id" text NOT NULL,
	"discount_id" text,
	"checkout_id" text NOT NULL,
	"customer_cancellation_reason" text,
	"customer_cancellation_comment" text,
	"metadata" text,
	"custom_field_data" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"modified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "two_factor" (
	"id" text PRIMARY KEY,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" text NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"failed_verification_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"email" text NOT NULL UNIQUE,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"two_factor_enabled" boolean DEFAULT false,
	"role" text,
	"banned" boolean DEFAULT false,
	"ban_reason" text,
	"ban_expires" timestamp with time zone,
	"stripe_customer_id" text
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"status" "campaign_status" DEFAULT 'draft'::"campaign_status" NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "funnels" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"campaign_id" text NOT NULL UNIQUE,
	"name" text NOT NULL,
	"status" "funnel_status" DEFAULT 'draft'::"funnel_status" NOT NULL,
	"settings" jsonb DEFAULT '"{}"',
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
CREATE TABLE "component" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"layers" jsonb NOT NULL,
	"variants" jsonb,
	"variables" jsonb,
	"thumbnail_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "layer_style" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"style_group" text,
	"kind" "layer_style_kind",
	"classes" text DEFAULT '' NOT NULL,
	"design" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "funnel_version" (
	"id" text PRIMARY KEY,
	"funnel_id" text NOT NULL,
	"version_number" integer NOT NULL,
	"compiled_schema" jsonb NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pages" (
	"id" text PRIMARY KEY,
	"funnel_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"order" integer NOT NULL,
	"depth" integer DEFAULT 0,
	"page_type" "page_type" NOT NULL,
	"content_hash" text,
	"is_dynamic" boolean DEFAULT false NOT NULL,
	"settings" jsonb DEFAULT '"{}"',
	"layers" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "assets_asset_folder_id_idx" ON "assets" ("asset_folder_id","is_published") WHERE "deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "assets_organization_id_idx" ON "assets" ("organization_id") WHERE "deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "assets_filename_idx" ON "assets" ("filename") WHERE "deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "assets_mime_type_idx" ON "assets" ("mime_type") WHERE "deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "assets_source_idx" ON "assets" ("source") WHERE "deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "assets_is_published_idx" ON "assets" ("is_published") WHERE "deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "assets_id_draft_unique_idx" ON "assets" ("id") WHERE "is_published" = false AND "deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "assets_storage_path_draft_unique_idx" ON "assets" ("storage_path") WHERE "storage_path" IS NOT NULL AND "is_published" = false;--> statement-breakpoint
CREATE INDEX "asset_folders_organization_id_idx" ON "asset_folders" ("organization_id") WHERE "deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "asset_folders_parent_idx" ON "asset_folders" ("asset_folder_id","is_published") WHERE "deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "asset_folders_name_idx" ON "asset_folders" ("name","is_published") WHERE "deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "asset_folders_draft_id_unique_idx" ON "asset_folders" ("id") WHERE "is_published" = false AND "deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "invitation_org_email_pending_unique_idx" ON "invitation" ("organization_id","email") WHERE "status" = 'pending';--> statement-breakpoint
CREATE INDEX "invitation_org_status_idx" ON "invitation" ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "member_org_user_unique_idx" ON "member" ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "campaigns_org_status_created_idx" ON "campaigns" ("organization_id","status","created_at","id");--> statement-breakpoint
CREATE INDEX "funnels_organization_id_idx" ON "funnels" ("organization_id");--> statement-breakpoint
CREATE INDEX "funnels_campaign_id_idx" ON "funnels" ("campaign_id");--> statement-breakpoint
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
CREATE INDEX "component_org_idx" ON "component" ("organization_id");--> statement-breakpoint
CREATE INDEX "layer_style_org_idx" ON "layer_style" ("organization_id");--> statement-breakpoint
CREATE INDEX "version_funnel_idx" ON "funnel_version" ("funnel_id");--> statement-breakpoint
CREATE UNIQUE INDEX "version_funnel_number_idx" ON "funnel_version" ("funnel_id","version_number");--> statement-breakpoint
CREATE INDEX "version_current_idx" ON "funnel_version" ("funnel_id","is_current");--> statement-breakpoint
CREATE INDEX "page_funnel_idx" ON "pages" ("funnel_id");--> statement-breakpoint
CREATE UNIQUE INDEX "page_funnel_slug_idx" ON "pages" ("funnel_id","slug");--> statement-breakpoint
CREATE INDEX "page_funnel_order_idx" ON "pages" ("funnel_id","order");--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "fk_assets_asset_folder" FOREIGN KEY ("asset_folder_id","is_published") REFERENCES "asset_folders"("id","is_published") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "asset_folders" ADD CONSTRAINT "asset_folders_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "asset_folders" ADD CONSTRAINT "fk_asset_folders_parent" FOREIGN KEY ("asset_folder_id","is_published") REFERENCES "asset_folders"("id","is_published") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fkey" FOREIGN KEY ("inviter_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "passkey" ADD CONSTRAINT "passkey_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "two_factor" ADD CONSTRAINT "two_factor_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_user_id_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "funnels" ADD CONSTRAINT "funnels_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "funnels" ADD CONSTRAINT "funnels_campaign_id_campaigns_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_funnel_id_funnels_id_fkey" FOREIGN KEY ("funnel_id") REFERENCES "funnels"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "collection_fields" ADD CONSTRAINT "collection_fields_collection_fkey" FOREIGN KEY ("collection_id","is_published") REFERENCES "collections"("id","is_published") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_collection_fkey" FOREIGN KEY ("collection_id","is_published") REFERENCES "collections"("id","is_published") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "collection_item_values" ADD CONSTRAINT "collection_item_values_item_fkey" FOREIGN KEY ("item_id","is_published") REFERENCES "collection_items"("id","is_published") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "collection_item_values" ADD CONSTRAINT "collection_item_values_field_fkey" FOREIGN KEY ("field_id","is_published") REFERENCES "collection_fields"("id","is_published") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "component" ADD CONSTRAINT "component_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "layer_style" ADD CONSTRAINT "layer_style_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "funnel_version" ADD CONSTRAINT "funnel_version_funnel_id_funnels_id_fkey" FOREIGN KEY ("funnel_id") REFERENCES "funnels"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_funnel_id_funnels_id_fkey" FOREIGN KEY ("funnel_id") REFERENCES "funnels"("id") ON DELETE CASCADE;