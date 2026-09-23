// path: src/app/(main)/workspace/_components/app-sidebar.tsx

"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { Hexagon, LayoutGrid, Settings2, Users2 } from "lucide-react";

import { NavMain } from "@/app/(main)/workspace/_components/nav-main";
import { OrganisationsSwitcher } from "@/app/(main)/workspace/_components/org-switcher";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar";
import type { listOrganizations } from "@/actions/organization.actions";

type OrganizationSummary = Awaited<
  ReturnType<typeof listOrganizations>
>[number];

type AppSidebarProps = React.ComponentProps<typeof Sidebar> & {
  //organizations: OrganizationSummary[];
  campaignId: string;
  activeOrganizationId: string;
};

export function AppSidebar({
  //organizations,
  campaignId,
  activeOrganizationId,
  ...props
}: AppSidebarProps) {
  const pathname = usePathname();

  const navMain = [
    {
      title: "Overview",
      url: "",
      icon: LayoutGrid,
      isActive: pathname === `/campaign/${campaignId}/`,
      items: [],
    },
    {
      title: "Editor",
      url: `/campaign/${campaignId}/edit`,
      isActive: pathname === "/",
      icon: Users2,
      items: [],
    },
    {
      title: "Settings",
      url: `/campaign/${campaignId}/settings`,
      // startsWith rather than exact match: /workspace/settings/team and
      // /workspace/settings/overview should both highlight this nav item.
      isActive: pathname.startsWith("/"),
      icon: Settings2,
      items: [],
    },
  ];

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <div className="mb-4 flex items-center gap-2.5">
          <div className="bg-indigo-600 p-1.5 rounded-lg">
            <Hexagon className="w-5 h-5 text-white fill-white" />
          </div>
          <span className="text-lg font-bold tracking-tight text-slate-900 font-sans">
            Thawkit
          </span>
        </div>
        {/* <OrganisationsSwitcher
          organizations={organizations}
          activeOrganizationId={activeOrganizationId}
        /> */}
      </SidebarHeader>

      <SidebarContent>
        <NavMain items={navMain} />
      </SidebarContent>

      <SidebarFooter />

      <SidebarRail />
    </Sidebar>
  );
}
