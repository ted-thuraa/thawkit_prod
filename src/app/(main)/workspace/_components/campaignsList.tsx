// path: src/app/(main)/workspace/_components/campaignsList.tsx

"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Grid3X3, List } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CampaignDTO, CampaignStatus } from "@/types/workspace";
import { Button } from "@/components/ui/button";
import DialogWrapper from "@/components/wrappers/dialog-wrapper";
import Link from "next/link";
import { CreateCampaignForm } from "./create-project";

const STATUS_BADGE_VARIANT: Record<
  CampaignStatus,
  "default" | "secondary" | "outline"
> = {
  draft: "secondary",
  live: "default",
  archived: "outline",
};

export function CampaignsList({
  campaigns,
  orgId,
}: {
  campaigns: CampaignDTO[];
  orgId: string;
}) {
  const [view, setView] = useState<"list" | "grid">("grid");

  function onSuccess() {
    return null;
  }

  if (campaigns.length === 0) {
    return (
      <Card>
        <CardContent className="py-16 text-center text-muted-foreground">
          <p className="mb-4">
            No campaigns yet. Create your first campaign to get started.
          </p>
          <DialogWrapper
            trigger={
              <Button
                className="bg-sidebar-primary text-sidebar-primary-foreground w-[10rem] shadow-none"
                size="sm"
              >
                New campaign
              </Button>
            }
            // optional: title/description/className/onOpen/onClose
            title="New campaign"
            description=" Give your campaign a name — you can add funnels and steps once it's created."
            className="bg-sidebar max-w-lg h-auto "
          >
            <CreateCampaignForm organizationId={orgId} />
          </DialogWrapper>
        </CardContent>
      </Card>
    );
  }

  return (
    <div>
      <div className="mb-4 flex justify-end px-2">
        <ToggleGroup
          type="single"
          variant="outline"
          value={view}
          onValueChange={(next) => next && setView(next as "list" | "grid")}
          className="*:data-[slot=toggle-group-item]:!px-4"
        >
          <ToggleGroupItem value="list" aria-label="List view">
            <List className="w-4 h-4" />
          </ToggleGroupItem>
          <ToggleGroupItem value="grid" aria-label="Grid view">
            <Grid3X3 className="w-4 h-4" />
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div
        className={cn(
          view === "grid"
            ? "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
            : "flex flex-col gap-3",
        )}
      >
        {campaigns.map((campaign) => (
          <Card key={campaign.id}>
            <Link href={`/campaign/${campaign.id}/`}>
              <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
                <CardTitle className="text-base font-medium">
                  {campaign.name}
                </CardTitle>
                <Badge
                  variant={STATUS_BADGE_VARIANT[campaign.status]}
                  className="capitalize"
                >
                  {campaign.status}
                </Badge>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                <p>
                  Updated {new Date(campaign.updatedAt).toLocaleDateString()}
                  {campaign.createdBy ? ` · by ${campaign.createdBy.name}` : ""}
                </p>
              </CardContent>
            </Link>
          </Card>
        ))}
      </div>
    </div>
  );
}
