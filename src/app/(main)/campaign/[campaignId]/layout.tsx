import React from "react";
import { getServerSession } from "@/lib/sessionServer";
import { redirect } from "next/navigation";
import { resolveWorkspaceContext } from "@/lib/workspace/resolve-workspace-context";
import { getCampaignDetail } from "@/lib/querries/campaigns";
import CampaignLayout from "./_components/campaignLayout";

export default async function CampaignRouteLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ campaignId: string }>;
}) {
  // cache()-wrapped — reuses the session lookup resolveWorkspaceContext()
  // already triggered, no duplicate DB round trip.
  const session = await getServerSession();

  // resolveWorkspaceContext() already guarantees session.user exists once
  // resolution.kind === "ready"; this just narrows it for TypeScript
  // without reaching for a non-null assertion.
  if (!session?.user) {
    redirect("/login");
  }

  const resolution = await resolveWorkspaceContext();
  if (resolution.kind === "redirect") {
    redirect(resolution.to);
  }

  const { campaignId } = await params;

  // Re-verifies the campaign belongs to the active org on every hit — a
  // fresh redirect from creation, a back button, a bookmark, or a shared
  // link are all treated campaignIdentically. Throws NotFoundError if the
  // campaign doesn't exist or belongs to a different org; caught by
  // error.tsx. cache()-deduped against each sub-route page's own call.

  const campaign = await getCampaignDetail(
    resolution.context.organizationId,
    campaignId,
  );

  return (
    <CampaignLayout
      context={resolution.context}
      campaign={campaign}
      user={{
        name: session.user.name,
        email: session.user.email,
        image: session.user.image ?? null,
      }}
    >
      {children}
    </CampaignLayout>
  );
}
