CREATE TYPE "layer_style_kind" AS ENUM('base', 'combo', 'global');--> statement-breakpoint
CREATE TYPE "page_type" AS ENUM('landing_page', 'normal_page', 'result_page');--> statement-breakpoint
CREATE TABLE "funnels" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"name" text NOT NULL,
	"status" "funnel_status" DEFAULT 'draft'::"funnel_status" NOT NULL,
	"settings" jsonb DEFAULT '"{}"',
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
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
	"settings" jsonb,
	"layers" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "funnels_organization_id_idx" ON "funnels" ("organization_id");--> statement-breakpoint
CREATE INDEX "funnels_campaign_id_idx" ON "funnels" ("campaign_id");--> statement-breakpoint
CREATE INDEX "component_org_idx" ON "component" ("organization_id");--> statement-breakpoint
CREATE INDEX "layer_style_org_idx" ON "layer_style" ("organization_id");--> statement-breakpoint
CREATE INDEX "version_funnel_idx" ON "funnel_version" ("funnel_id");--> statement-breakpoint
CREATE UNIQUE INDEX "version_funnel_number_idx" ON "funnel_version" ("funnel_id","version_number");--> statement-breakpoint
CREATE INDEX "version_current_idx" ON "funnel_version" ("funnel_id","is_current");--> statement-breakpoint
CREATE INDEX "page_funnel_idx" ON "pages" ("funnel_id");--> statement-breakpoint
CREATE UNIQUE INDEX "page_funnel_slug_idx" ON "pages" ("funnel_id","slug");--> statement-breakpoint
CREATE INDEX "page_funnel_order_idx" ON "pages" ("funnel_id","order");--> statement-breakpoint
ALTER TABLE "funnels" ADD CONSTRAINT "funnels_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "funnels" ADD CONSTRAINT "funnels_campaign_id_campaigns_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "component" ADD CONSTRAINT "component_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "layer_style" ADD CONSTRAINT "layer_style_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "funnel_version" ADD CONSTRAINT "funnel_version_funnel_id_funnels_id_fkey" FOREIGN KEY ("funnel_id") REFERENCES "funnels"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_funnel_id_funnels_id_fkey" FOREIGN KEY ("funnel_id") REFERENCES "funnels"("id") ON DELETE CASCADE;