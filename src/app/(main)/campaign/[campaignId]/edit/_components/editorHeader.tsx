"use client";
import react, { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  ChevronsUpDown,
  ExternalLink,
  Eye,
  EyeIcon,
  Home,
  Loader2Icon,
  Plus,
  Save,
  SidebarIcon,
  X,
} from "lucide-react";
import { IoMdArrowRoundBack } from "react-icons/io";
import { BiLinkExternal } from "react-icons/bi";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useSidebar } from "@/components/ui/sidebar";
import { useRouter } from "next/navigation";
//import { DeviceType, ProjectData } from "@/stores/pageEditorStore/types";

import { toast } from "sonner";
import Link from "next/link";
import React from "react";
import { CiMobile2 } from "react-icons/ci";
import { HiMiniDeviceTablet } from "react-icons/hi2";
import { GoDeviceDesktop } from "react-icons/go";
import Icon from "@/components/ui/icon";
import { useIsMobile } from "@/hooks/use-mobile";
import { useEditorStore } from "@/stores/editor/useEditorStore";
import { publishFunnelAction } from "@/actions/editor/editor-actions";

type EditorHeaderProps = {
  user: {
    email: string;
    name: string;
    image?: string | null | undefined;
  } | null;
  campaignId: string;
};

interface ScreenOption {
  value: "mobile" | "tablet" | "desktop";
  label: string;
  description: string;
  minWidth?: number; // Optional for 'and more'
  maxWidth?: number; // Optional for 'up to'
  icon: React.ComponentType<any>;
}

// Ensure "Desktop" covers the rest of the screen sizes logically
const screenOptions: ScreenOption[] = [
  {
    value: "mobile",
    label: "Phone",
    description: "up to 640px",
    maxWidth: 640,
    icon: CiMobile2,
  },
  {
    value: "tablet",
    label: "Tablet",
    description: "up to 1080px",
    maxWidth: 1080,
    icon: HiMiniDeviceTablet,
  },
  {
    value: "desktop",
    label: "Desktop",
    description: "1081px and more", // Adjusted description to be exclusive
    minWidth: 1081,
    icon: GoDeviceDesktop,
  },
];

export function EditorHeader({ campaignId, user }: EditorHeaderProps) {
  const { toggleSidebar } = useSidebar();
  const isMobile = useIsMobile();
  const router = useRouter();
  // FIXED (Phase 6): was local `useState(false)`, entirely disconnected
  // from whether a save was actually happening — EditorBody.tsx now
  // triggers real saves (saveDraftLayersAction) after every layer/page
  // mutation, tracked in useEditorStore.isSaving. This indicator reads
  // that directly instead of carrying its own always-false copy.
  const isSaving = useEditorStore((state) => state.isSaving);
  const [isPreviewMode, setIsPreviewMode] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);

  // WIRED (Phase 7): was a dead `activeBreakpoint`-shaped array feeding a
  // dropdown that was never actually rendered (`currentDeviceOption` was
  // hardcoded to always resolve "Desktop", and `handleDeviceChange` had no
  // caller anywhere in the JSX). Now reads/writes the real store value
  // that EditorBuilder.tsx's iframe width has been reacting to since
  // Phase 5.
  const activeBreakpoint = useEditorStore((state) => state.activeBreakpoint);
  const setActiveBreakpoint = useEditorStore(
    (state) => state.setActiveBreakpoint,
  );

  const [theme, setTheme] = useState<"system" | "light" | "dark">(() => {
    if (typeof window !== "undefined") {
      const savedTheme = localStorage.getItem("theme") as
        | "system"
        | "light"
        | "dark"
        | null;
      return savedTheme || "dark";
    }
    return "dark";
  });

  useEffect(() => {
    const root = document.documentElement;

    if (theme === "system") {
      const systemPrefersDark = window.matchMedia(
        "(prefers-color-scheme: dark)",
      ).matches;
      if (systemPrefersDark) {
        root.classList.add("dark");
      } else {
        root.classList.remove("dark");
      }
    } else if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }

    localStorage.setItem("theme", theme);
  }, [theme]);

  // Still a stub — a real Save button beyond the automatic per-edit
  // persistence EditorBody.tsx already does isn't needed yet; kept for
  // parity with the original shell in case a manual "force save" action
  // is wanted later.
  const handleSave = async () => {};

  async function handlePublish() {
    setIsPublishing(true);
    const result = await publishFunnelAction(campaignId);
    setIsPublishing(false);

    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success(`Published version ${result.data.versionNumber}`);
  }

  const handlePreviewClick = () => {};

  const handlePreviewClose = () => {};

  // Find the currently selected option to display its label — now driven
  // by the real store value instead of a hardcoded "Desktop" lookup.
  const currentDeviceOption = screenOptions.find(
    (op) => op.value === activeBreakpoint,
  );
  const currentDeviceLabel = currentDeviceOption
    ? currentDeviceOption.label
    : "Select Device";
  const CurrentDeviceIcon = currentDeviceOption
    ? currentDeviceOption.icon
    : GoDeviceDesktop;

  return (
    <header className="bg-background sticky top-0 z-50 min-h-12 flex w-full items-center border-b">
      <div className="flex h-[--header-height] w-full flex-row shrink-0 items-center justify-between gap-2 px-4">
        <div className="flex items-center gap-2 ">
          {/* User Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="sm" className="size-8!">
                <div className="dark:text-white text-secondary-foreground">
                  <svg
                    className="size-3.5 fill-current"
                    viewBox="0 0 24 24"
                    version="1.1"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <g
                      id="Symbols"
                      stroke="none"
                      strokeWidth="1"
                      fill="none"
                      fillRule="evenodd"
                    >
                      <g
                        id="Sidebar"
                        transform="translate(-30.000000, -30.000000)"
                      >
                        <g id="Ycode">
                          <g transform="translate(30.000000, 30.000000)">
                            <rect
                              id="Rectangle"
                              x="0"
                              y="0"
                              width="24"
                              height="24"
                            />
                            <path
                              id="CurrentFill"
                              d="M11.4241533,0 L11.4241533,5.85877951 L6.024,8.978 L12.6155735,12.7868008 L10.951,13.749 L23.0465401,6.75101349 L23.0465401,12.6152717 L3.39516096,23.9856666 L3.3703726,24 L3.34318129,23.9827156 L0.96,22.4713365 L0.96,16.7616508 L3.36417551,18.1393242 L7.476,15.76 L0.96,11.9090099 L0.96,6.05375516 L11.4241533,0 Z"
                              className="fill-current"
                            />
                          </g>
                        </g>
                      </g>
                    </g>
                  </svg>
                </div>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <>
                <DropdownMenuItem asChild>
                  <Link href="/workspace">Dashboard</Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>

              <DropdownMenuItem onClick={() => router.push("#")}>
                Settings
              </DropdownMenuItem>

              <DropdownMenuItem
              //onClick={() => openFileManager()}
              >
                File manager
              </DropdownMenuItem>

              <>
                <DropdownMenuItem onClick={() => router.push("#")}>
                  Integrations
                </DropdownMenuItem>

                <DropdownMenuItem
                //onClick={() => setShowTransferDialog(true)}
                >
                  Backup &amp; Restore
                </DropdownMenuItem>
              </>

              <DropdownMenuSeparator />

              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Theme</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuRadioGroup
                    value={"dark"}
                    onValueChange={(value) =>
                      setTheme(value as "system" | "light" | "dark")
                    }
                  >
                    <DropdownMenuRadioItem value="system">
                      System
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="light">
                      Light
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="dark">
                      Dark
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>

              <DropdownMenuItem
              //onClick={() => setKeyboardShortcutsOpen(true)}
              >
                Keyboard shortcuts
              </DropdownMenuItem>

              <DropdownMenuSeparator />

              <DropdownMenuItem onClick={() => router.push("/ycode/profile")}>
                My profile
              </DropdownMenuItem>

              <DropdownMenuItem
              // onClick={async () => {
              //   await signOut();
              // }}
              >
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="flex gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  className="border bg-sidebar-accent text-sidebar-accent-foreground"
                >
                  <div className="  flex aspect-square size-4 items-center justify-center rounded-full text-sm font-semibold uppercase">
                    <Home className="size-3" />
                  </div>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">Home</span>
                  </div>
                  <ChevronsUpDown className="ml-auto size-4 shrink-0" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-56 rounded-lg"
                align="start"
                side={isMobile ? "bottom" : "right"}
                sideOffset={4}
              >
                <DropdownMenuLabel className="text-muted-foreground text-xs">
                  Pages
                </DropdownMenuLabel>

                <DropdownMenuItem
                  key="home"
                  //onClick={() => handleSwitch()}
                  //disabled={isPending}
                  className="gap-2 p-2"
                >
                  <div className="p-1.5 bg-muted text-muted-foreground flex aspect-square size-7 items-center justify-center rounded-full border text-xs font-semibold uppercase">
                    <Home />
                  </div>
                  <span className="truncate flex-1">Home</span>
                  {/* {switchingId === page.id ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : org.id === activeOrganizationId ? (
                  <span className="text-xs text-muted-foreground">Current</span>
                ) : null} */}
                </DropdownMenuItem>

                <DropdownMenuSeparator />
                <DropdownMenuItem className="gap-2 p-2" asChild>
                  <Link href="">
                    <div className="flex size-6 items-center justify-center rounded-md border bg-transparent">
                      <Plus className="size-4" />
                    </div>
                    <div className="text-muted-foreground font-medium">
                      Add Page
                    </div>
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="flex gap-1.5 items-center justify-center">
          {/* Breakpoint switcher — ADDED (Phase 7). Was previously dead
              code: screenOptions/currentDeviceOption/handleDeviceChange
              were all defined but never actually rendered anywhere in this
              file, so activeBreakpoint could never be changed from the
              header despite EditorBuilder.tsx's canvas already reacting to
              it since Phase 5. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="xs" variant="ghost" className="gap-1.5">
                <CurrentDeviceIcon className="size-3.5" />
                {currentDeviceLabel}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center">
              {screenOptions.map((option) => (
                <DropdownMenuItem
                  key={option.value}
                  onClick={() => setActiveBreakpoint(option.value)}
                  className="gap-2"
                >
                  <option.icon className="size-4" />
                  <div className="flex flex-col">
                    <span>{option.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {option.description}
                    </span>
                  </div>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="h-5">
            <Separator orientation="vertical" />
          </div>

          <Button size="xs" variant="ghost">
            <Icon name="globe" />
            'EN'
          </Button>

          <div className="h-5">
            <Separator orientation="vertical" />
          </div>

          <Button size="xs" variant="ghost" asChild>
            <a
              href="#"
              //href={baseUrl + publishedUrl} target="_blank"
              rel="noopener noreferrer"
            >
              "http://localhost:3000"
            </a>
          </Button>

          <>
            <div className="h-5">
              <Separator orientation="vertical" />
            </div>

            <Button
              size="xs"
              variant="default"
              className="bg-primary/20 hover:bg-primary/30 text-blue-400 hover:text-blue-300"
              onClick={() => router.push("/ycode/settings/updates")}
            >
              Update available
            </Button>
          </>
        </div>

        {/* Right: User & Actions */}
        <div className="flex items-center justify-end gap-2">
          {/* Save Status Indicator */}
          <div className="flex items-center justify-end w-16 text-xs text-zinc-500 dark:text-white/50">
            {isSaving ? (
              <>
                <span>Saving</span>
              </>
            ) : (
              <>
                <span>Ready</span>
              </>
            )}
          </div>
          {/* Preview button */}
          <Button
            size="sm"
            variant="secondary"
            //onClick={}
            //disabled={ isSaving}
            className={
              isPreviewMode
                ? "bg-black text-white hover:bg-black/90 dark:bg-white dark:text-black dark:hover:bg-white/90"
                : ""
            }
          >
            <Icon name="preview" />
          </Button>

          <Button
            size="sm"
            onClick={handlePublish}
            disabled={isPublishing || isSaving}
          >
            {isPublishing ? "Publishing…" : "Publish"}
          </Button>
        </div>
      </div>
    </header>
  );
}
