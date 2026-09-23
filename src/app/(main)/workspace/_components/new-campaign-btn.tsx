"use client";

import { ChevronRight, Plus, type LucideIcon } from "lucide-react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import Link from "next/link";
import { cn } from "@/lib/utils";
import DialogWrapper from "@/components/wrappers/dialog-wrapper";
import { Button } from "@/components/ui/button";
import { CreateCampaignForm } from "./create-project";

export function NewCampaignBtn({ orgId }: { orgId: string }) {
  return (
    <>
      <DialogWrapper
        trigger={
          <Button>
            <Plus className="size-4" />
            New Campaign
          </Button>
        }
        // optional: title/description/className/onOpen/onClose
        title="New campaign"
        description=" Give your campaign a name — you can add funnels and steps once it's created."
        className="bg-sidebar max-w-lg h-auto "
      >
        <CreateCampaignForm organizationId={orgId} />
      </DialogWrapper>
    </>
  );
}
