"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
//import { EditorHeader } from "./_components/editorHeader";
import { authClient } from "@/lib/auth/auth-client";
import type { EditorBootstrapContext } from "@/lib/editor/resolve-editor-bootstrap";
import { EditorHeader } from "./_components/editorHeader";
import { Button } from "@/components/ui/button";
import { GitForkIcon, Palette, Plus } from "lucide-react";
import { CampaignEditorMain } from "./_components/builderMain";
//import { CampaignEditorMain } from "./_components/BuilderMain";

type Props = {
  campaignId: string;
  bootstrap: EditorBootstrapContext;
};

type user = {
  email: string;
  name: string;
  image?: string | null | undefined;
};

const EditorLayoutClient: React.FC<Props> = ({ campaignId, bootstrap }) => {
  const [user, setUser] = useState<user | null>(null);
  const { data: session } = authClient.useSession();

  useEffect(() => {
    if (session) {
      setUser({
        email: session.user.email,
        name: session.user.name,
        image: session.user.image,
      });
    }
    // Depends on `session` (not `[]`): session resolves asynchronously
    // after mount (authClient.useSession()'s isPending starts true), so an
    // empty dependency array would mean this effect's stale closure never
    // re-ran once the real session arrived and `user` stayed null past the
    // loading state.
  }, [session]);

  return (
    <div className="">
      <SidebarProvider className="h-screen flex flex-col">
        <EditorHeader campaignId={campaignId} user={user} />
        <div className="flex flex-1 overflow-hidden">
          <SidebarInset className="overflow-hidden flex-1 flex  bg-muted bg-[radial-gradient(#e5e7eb_0.5px,transparent_1px)] [background-size:16px_16px]">
            {/* `key={campaignId}` forces a full React remount of
                CampaignEditorMain when the campaign changes, belt-and-braces
                alongside its own campaignId-keyed store-reset effect (see
                that file's comment) — resets local component state
                immediately rather than waiting on an effect to clean up
                global Zustand state that would otherwise persist across
                the swap. */}
            {/* The editor is URL-driven and owns all content for this layout.
                Child editor route pages intentionally render null, so render
                the persistent orchestrator directly rather than allowing a
                route element to mask the editor body. */}
            <CampaignEditorMain
              key={campaignId}
              campaignId={campaignId}
              bootstrap={bootstrap}
            />
          </SidebarInset>
        </div>
      </SidebarProvider>
    </div>
  );
};

export default EditorLayoutClient;
