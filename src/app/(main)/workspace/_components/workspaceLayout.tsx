// path: src/app/(main)/workspace/_components/workspaceLayout.tsx

"use client";

import React from "react";
import { usePathname } from "next/navigation";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import type { listOrganizations } from "@/actions/organization.actions";
import type { WorkspaceContext } from "@/types/workspace";
import { AppSidebar } from "./app-sidebar";
import { NavUser } from "@/components/ui/nav-user";

type OrganizationSummary = Awaited<
  ReturnType<typeof listOrganizations>
>[number];

type Props = {
  children: React.ReactNode;
  modal?: React.ReactNode;
  context: WorkspaceContext;
  organizations: OrganizationSummary[];
  user: {
    email: string;
    name: string;
    image?: string | null;
  };
};

function usePageLabel(): string {
  const pathname = usePathname();
  if (pathname.startsWith("/workspace/settings")) return "Settings";
  if (pathname.startsWith("/workspace/templates")) return "Templates";
  return "Projects";
}

const WorkspaceLayout = ({
  children,
  modal,
  context,
  organizations,
  user,
}: Props) => {
  const pageLabel = usePageLabel();

  return (
    <SidebarProvider>
      <AppSidebar
        organizations={organizations}
        activeOrganizationId={context.organizationId}
      />
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
          <div className="flex flex-1 items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator
              orientation="vertical"
              className="mr-2 data-[orientation=vertical]:h-4"
            />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem className="hidden md:block">
                  <BreadcrumbLink href="/workspace">
                    {context.organizationName}
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem>
                  <BreadcrumbPage>{pageLabel}</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
          <div className="ml-auto px-3">
            <NavUser user={user} />
          </div>
        </header>
        <div className="flex flex-1 flex-col">
          <div className="@container/main flex flex-1 flex-col gap-2">
            <div className="flex flex-col gap-4 p-4 md:gap-6 md:py-6 md:px-[3.4rem]">
              {children}
            </div>
          </div>
        </div>
      </SidebarInset>
      {modal}
    </SidebarProvider>
  );
};

export default WorkspaceLayout;
