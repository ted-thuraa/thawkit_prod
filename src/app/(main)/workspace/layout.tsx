// path: src/app/(main)/workspace/layout.tsx

import React from "react";
import { redirect } from "next/navigation";
import { resolveWorkspaceContext } from "@/lib/workspace/resolve-workspace-context";
import { getServerSession } from "@/lib/sessionServer";
import { listOrganizations } from "@/actions/organization.actions";
import WorkspaceLayout from "./_components/workspaceLayout";

export default async function Layout({
  children,
  modal,
}: {
  children: React.ReactNode;
  modal: React.ReactNode;
}) {
  const resolution = await resolveWorkspaceContext();

  if (resolution.kind === "redirect") {
    redirect(resolution.to);
  }

  // cache()-wrapped — reuses the session lookup resolveWorkspaceContext()
  // already triggered, no duplicate DB round trip.
  const session = await getServerSession();

  // resolveWorkspaceContext() already guarantees session.user exists once
  // resolution.kind === "ready"; this just narrows it for TypeScript
  // without reaching for a non-null assertion.
  if (!session?.user) {
    redirect("/login");
  }

  // Non-fatal if this fails: the switcher just falls back to showing only
  // the active workspace rather than crashing the whole shell.
  let organizations: Awaited<ReturnType<typeof listOrganizations>> = [];
  try {
    organizations = await listOrganizations();
  } catch {
    organizations = [];
  }

  return (
    <WorkspaceLayout
      context={resolution.context}
      organizations={organizations ?? []}
      user={{
        name: session.user.name,
        email: session.user.email,
        image: session.user.image ?? null,
      }}
      modal={modal}
    >
      {children}
    </WorkspaceLayout>
  );
}
