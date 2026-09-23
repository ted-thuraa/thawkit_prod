// path: src/app/(main)/workspace/page.tsx

import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronRight, Plus } from "lucide-react";
import { resolveWorkspaceContext } from "@/lib/workspace/resolve-workspace-context";
import { CampaignsList } from "./_components/campaignsList";
import { CampaignStatusFilter } from "./_components/campaignStatusFilter";
import type { CampaignStatus } from "@/types/workspace";
import { listCampaigns } from "@/lib/querries/campaigns";
import { Button } from "@/components/ui/button";
import { NewCampaignBtn } from "./_components/new-campaign-btn";

const VALID_STATUSES: readonly string[] = ["all", "draft", "live", "archived"];

type SearchParams = {
  status?: string;
  cursor?: string;
};

export default async function WorkSpaceMainPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const resolution = await resolveWorkspaceContext();
  if (resolution.kind === "redirect") {
    redirect(resolution.to);
  }

  const resolvedSearchParams = await searchParams;
  const status: CampaignStatus | "all" = VALID_STATUSES.includes(
    resolvedSearchParams.status ?? "",
  )
    ? (resolvedSearchParams.status as CampaignStatus | "all")
    : "all";

  // Throws AppError on failure (e.g. ForbiddenError) — expected to be
  // caught by this route segment's error.tsx, per the queries-throw /
  // actions-return-ActionResult split from the backend design.
  const campaigns = await listCampaigns(resolution.context.organizationId, {
    status,
    cursor: resolvedSearchParams.cursor ?? null,
  });

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex items-center justify-between">
          <h3 className="text-xl font-semibold text-gray-800">Projects</h3>
          <NewCampaignBtn orgId={resolution.context.organizationId} />
        </div>

        <div className="w-full mb-6 flex flex-row flex-nowrap items-center justify-between gap-6">
          <CampaignStatusFilter
            currentStatus={status}
            orgId={resolution.context.organizationId}
          />
        </div>

        <CampaignsList
          campaigns={campaigns.items}
          orgId={resolution.context.organizationId}
        />

        {campaigns.hasMore && campaigns.nextCursor && (
          <div className="mt-6 flex justify-center">
            <Link
              href={`/workspace?status=${status}&cursor=${encodeURIComponent(campaigns.nextCursor)}`}
              className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
            >
              Load more
              <ChevronRight className="size-4" />
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
