import { SubscriptionPlans } from "@/components/billing/subscription-management";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SidebarInput } from "@/components/ui/sidebar";
import DialogWrapper from "@/components/wrappers/dialog-wrapper";

export function UpgradeCard() {
  return (
    <Card className="gap-2 py-4 shadow-none">
      <CardHeader className="px-4">
        <CardTitle className="text-sm">Subscribe to our newsletter</CardTitle>
        <CardDescription>
          Opt-in to receive updates and news about the sidebar.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-4">
        <DialogWrapper
          trigger={
            <Button
              className="bg-sidebar-primary text-sidebar-primary-foreground w-full shadow-none"
              size="sm"
            >
              Upgrade
            </Button>
          }
          // optional: title/description/className/onOpen/onClose
          // title="Add section"
          // description="Select a template to begin"
          className="bg-sidebar max-w-screen w-[100%] h-[100%] overflow-y-auto"
        >
          <SubscriptionPlans />
        </DialogWrapper>
      </CardContent>
    </Card>
  );
}
