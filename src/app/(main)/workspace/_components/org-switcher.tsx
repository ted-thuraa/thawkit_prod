// path: src/app/(main)/workspace/_components/org-switcher.tsx

"use client";

import * as React from "react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronsUpDown, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { setActiveOrganization } from "@/actions/organization.actions";
import type { listOrganizations } from "@/actions/organization.actions";

type OrganizationSummary = Awaited<
  ReturnType<typeof listOrganizations>
>[number];

interface OrganisationsSwitcherProps {
  organizations: OrganizationSummary[];
  activeOrganizationId: string;
}

/** "Workspace" -> "W", "Johns Workspace" -> "JW" */
const getInitials = (name?: string | null): string => {
  if (!name) return "?";
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0][0] ?? "";
  const second = words[1]?.[0] ?? "";
  return words.length >= 2
    ? (first + second).toUpperCase()
    : first.toUpperCase();
};

export function OrganisationsSwitcher({
  organizations,
  activeOrganizationId,
}: OrganisationsSwitcherProps) {
  const { isMobile } = useSidebar();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [switchingId, setSwitchingId] = useState<string | null>(null);

  const activeOrg =
    organizations.find((org) => org.id === activeOrganizationId) ?? null;

  function handleSwitch(organizationId: string, slug?: string | null) {
    if (organizationId === activeOrganizationId || isPending) return;

    setSwitchingId(organizationId);
    startTransition(async () => {
      try {
        await setActiveOrganization(organizationId, slug ?? undefined);
        router.refresh();
      } catch {
        toast.error("Couldn't switch workspace. Please try again.");
      } finally {
        setSwitchingId(null);
      }
    });
  }

  if (!activeOrg) {
    return null;
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="border data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-full text-sm font-semibold uppercase">
                {getInitials(activeOrg.name)}
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{activeOrg.name}</span>
              </div>
              <ChevronsUpDown className="ml-auto size-4 shrink-0" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-56 rounded-lg"
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-muted-foreground text-xs">
              Workspaces
            </DropdownMenuLabel>
            {organizations.map((org) => (
              <DropdownMenuItem
                key={org.id}
                onClick={() => handleSwitch(org.id, org.slug)}
                disabled={isPending}
                className="gap-2 p-2"
              >
                <div className="p-1.5 bg-muted text-muted-foreground flex aspect-square size-7 items-center justify-center rounded-full border text-xs font-semibold uppercase">
                  {getInitials(org.name)}
                </div>
                <span className="truncate flex-1">{org.name}</span>
                {switchingId === org.id ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : org.id === activeOrganizationId ? (
                  <span className="text-xs text-muted-foreground">Current</span>
                ) : null}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-2 p-2" asChild>
              <Link href="/onboarding/create-workspace">
                <div className="flex size-6 items-center justify-center rounded-md border bg-transparent">
                  <Plus className="size-4" />
                </div>
                <div className="text-muted-foreground font-medium">
                  Add Workspace
                </div>
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
