// path: src/app/(main)/workspace/_components/campaignStatusFilter.tsx

"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CampaignStatus } from "@/types/workspace";
import DialogWrapper from "@/components/wrappers/dialog-wrapper";
import { Button } from "@/components/ui/button";

const STATUS_OPTIONS: { value: CampaignStatus | "all"; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "draft", label: "Draft" },
  { value: "live", label: "Live" },
  { value: "archived", label: "Archived" },
];

export function CampaignStatusFilter({
  currentStatus,
  orgId,
}: {
  currentStatus: CampaignStatus | "all";
  orgId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function onSuccess() {
    return null;
  }

  function handleChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "all") {
      params.delete("status");
    } else {
      params.set("status", value);
    }
    // Changing the filter invalidates the current cursor's position in the list.
    params.delete("cursor");

    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  return (
    <>
      <div className="flex flex-row items-center gap-x-4">
        <Select value={currentStatus} onValueChange={handleChange}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Status</SelectLabel>
              {STATUS_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-row items-center gap-x-4">
        <DialogWrapper
          trigger={
            <Button
              className="bg-sidebar-primary text-sidebar-primary-foreground w-auto shadow-none"
              size="sm"
            >
              New campaign
            </Button>
          }
          // optional: title/description/className/onOpen/onClose
          // title="Add section"
          // description="Select a template to begin"
          className="bg-sidebar max-w-lg h-auto "
        >
          form
          {/* <NewProjectForm organizationId={orgId} onSuccess={onSuccess} /> */}
        </DialogWrapper>
      </div>
    </>
  );
}
