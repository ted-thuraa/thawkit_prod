ALTER TABLE "pages" ALTER COLUMN "settings" SET DEFAULT '"{}"';--> statement-breakpoint
ALTER TABLE "funnels" ADD CONSTRAINT "funnels_campaign_id_key" UNIQUE("campaign_id");