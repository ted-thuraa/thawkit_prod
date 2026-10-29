"use client";
import react, {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
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
import Icon, { IconProps } from "@/components/ui/icon";
import { useIsMobile } from "@/hooks/use-mobile";
import { useEditorStore } from "@/stores/editor/useEditorStore";
import {
  isTempPageId,
  selectSaveState,
  usePagesStore,
} from "@/stores/editor/usePagesStore";
import { publishFunnelAction } from "@/actions/editor/editor-actions";
import { cn } from "@/lib/utils";
import { getPageIcon } from "@/lib/page-utils";
import { useCampaignEditorUrl } from "@/hooks/use-editor-url";
import {
  EDITOR_AREAS,
  EDITOR_AREA_LABELS,
  areaForRouteType,
  isDesignUrlForCampaign,
  type EditorArea,
} from "@/lib/editor/editor-areas";
import { DEFAULT_LAYER_ID } from "@/lib/editor/editor-url";
import { Page } from "@/types/funnel";

type EditorHeaderProps = {
  user: {
    email: string;
    name: string;
    image?: string | null | undefined;
  } | null;
  currentPageId: string;
  campaignId: string;
  placeholder?: string;
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

export function EditorHeader({
  campaignId,
  currentPageId,
  user,
  placeholder = "Select...",
}: EditorHeaderProps) {
  const { toggleSidebar } = useSidebar();
  const isMobile = useIsMobile();
  const router = useRouter();
  const { navigateToNextPage, navigateToArea, navigateToEditor, urlState } =
    useCampaignEditorUrl(campaignId);
  // Aggregate autosave state across every page, owned by `usePagesStore`:
  // "unsaved" = edits inside the 2 s debounce window, "saving" = a request is
  // in flight, "error" = the last save failed (it keeps retrying).
  const saveState = usePagesStore(selectSaveState);
  const [isChangePageOpen, setIsChangePageOpen] = useState(false);
  const [isChangeActiveNavOpen, setIsChangeActiveNavOpen] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const isPreviewMode = useEditorStore((s) => s.isPreviewMode);
  const setPreviewMode = useEditorStore((s) => s.setPreviewMode);
  const pages = usePagesStore((state) => state.pages);
  const setActiveSidebarTab = useEditorStore((s) => s.setActiveSidebarTab);
  const openFileManager = useEditorStore((s) => s.openFileManager);

  // Active editor area — derived from the URL on every render, never stored,
  // so it cannot disagree with the route (refresh / back / deep links).
  const activeArea = areaForRouteType(urlState.type);
  const [isAreaNavPending, startAreaTransition] = useTransition();

  // Design URL (path + query) we last left, so "Design" returns to the same
  // page / viewport / layer instead of the first page. Header-owned: the header
  // persists across every editor route (see EditorLayoutClient).
  const lastDesignUrlRef = useRef<string | null>(null);

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

  const handlePageOpenChange = useCallback((open: boolean) => {
    setIsChangePageOpen(open);
  }, []);
  const handleChangeActiveNav = useCallback((open: boolean) => {
    setIsChangeActiveNavOpen(open);
  }, []);

  // One coherent navigation per selection; the popover closes immediately and
  // the trigger follows the URL once the route commits.
  const handleAreaSelect = useCallback(
    (area: EditorArea) => {
      setIsChangeActiveNavOpen(false);
      if (area === activeArea) return;

      if (activeArea === "design") {
        lastDesignUrlRef.current =
          window.location.pathname + window.location.search;
      }

      startAreaTransition(() => {
        if (area !== "design") {
          navigateToArea(area);
          return;
        }
        const remembered = lastDesignUrlRef.current;
        if (isDesignUrlForCampaign(remembered, campaignId) && remembered) {
          router.push(remembered);
        } else {
          // Base route: CampaignEditorMain resolves it to the first page.
          navigateToEditor();
        }
      });
    },
    [activeArea, campaignId, navigateToArea, navigateToEditor, router],
  );

  // Still a stub — a manual Save button isn't needed now that every page is
  // autosaved by `usePagesStore`; kept in case a "force save" action is wanted
  // later (it would call `usePagesStore.getState().flushPendingSaves()`).
  const handleSave = async () => {};

  async function handlePublish() {
    setIsPublishing(true);

    // Publishing snapshots the SAVED pages, not the editor's in-memory copy.
    // Edits still inside the autosave window would be silently left out, so
    // write them first — and refuse to publish if that fails.
    const allSaved = await usePagesStore.getState().flushPendingSaves();
    if (!allSaved) {
      setIsPublishing(false);
      toast.error(
        "Couldn't save your latest changes, so nothing was published.",
        {
          description: "Check your connection and try again.",
        },
      );
      return;
    }

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

  const pagesById = useMemo(() => {
    const map = new Map<string, Page>();
    for (const page of pages) map.set(page.id, page);
    return map;
  }, [pages]);

  const selectedPage = useMemo(() => {
    if (!currentPageId) return null;
    return pagesById.get(currentPageId) ?? null;
  }, [currentPageId, pagesById]);

  // Switchable pages in funnel order. A page still being created (temp id)
  // has no route yet, so it is not offered — same rule as `PagesList`.
  const switchablePages = useMemo(
    () =>
      pages
        .filter((page) => !isTempPageId(page.id))
        .sort((a, b) => a.order - b.order),
    [pages],
  );

  // Page switching mirrors `PagesList.handlePageSelect`: the URL is the source
  // of truth (`CampaignEditorMain` derives `currentPageId` from it), so we only
  // reset the canvas selection and navigate — no store is written directly.
  const handlePageSelect = useCallback(
    (pageId: string) => {
      setIsChangePageOpen(false);
      if (pageId === currentPageId || !pagesById.has(pageId)) return;

      useEditorStore.getState().selectLayerWithSublayer(DEFAULT_LAYER_ID, {
        textStyleKey: null,
        sublayerIndex: null,
        listItemIndex: null,
      });
      startTransition(() => navigateToNextPage(pageId, DEFAULT_LAYER_ID));
    },
    [currentPageId, navigateToNextPage, pagesById],
  );

  function getAreaIcon(area: EditorArea): IconProps["name"] {
    switch (area) {
      case "design":
        return "cursor-default";
      case "cms":
        return "database";
      case "forms":
        return "form";
      case "settings":
        return "settings";
    }
  }

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

              <DropdownMenuItem onClick={() => openFileManager()}>
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
            <Popover
              open={isChangeActiveNavOpen}
              onOpenChange={handleChangeActiveNav}
            >
              <PopoverTrigger asChild>
                <Button
                  variant="input"
                  size="sm"
                  role="combobox"
                  aria-expanded={isChangeActiveNavOpen}
                  aria-busy={isAreaNavPending}
                  aria-label={`Switch editor area. Current area: ${EDITOR_AREA_LABELS[activeArea]}`}
                  className="min-w-32 justify-between text-foreground"
                >
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <Icon
                      name={getAreaIcon(activeArea)}
                      className="size-3 opacity-50 shrink-0"
                    />
                    <span className="truncate">
                      {EDITOR_AREA_LABELS[activeArea]}
                    </span>
                  </div>
                  <div className="shrink-0">
                    <Icon
                      name="chevronDown"
                      className="size-2.5! shrink-0 opacity-50"
                    />
                  </div>
                </Button>
              </PopoverTrigger>

              <PopoverContent
                align="start"
                className="w-48 gap-0 p-0"
                // Land focus on the list so arrow keys / Enter work at once.
                onOpenAutoFocus={(event) => {
                  event.preventDefault();
                  (event.currentTarget as HTMLElement)
                    .querySelector<HTMLElement>("[cmdk-root]")
                    ?.focus();
                }}
              >
                <Command loop aria-label="Editor areas">
                  <CommandList>
                    <CommandGroup>
                      {EDITOR_AREAS.map((area) => {
                        const isActive = area === activeArea;
                        return (
                          <CommandItem
                            key={area}
                            value={area}
                            data-checked={isActive}
                            aria-current={isActive ? "page" : undefined}
                            onSelect={() => handleAreaSelect(area)}
                            className={cn(isActive && "bg-secondary/50")}
                          >
                            <Icon
                              name={getAreaIcon(area)}
                              className="size-3 opacity-50"
                            />
                            <span className="truncate">
                              {EDITOR_AREA_LABELS[area]}
                            </span>
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>

            <Separator orientation="vertical" />

            <Popover
              open={isChangePageOpen}
              onOpenChange={handlePageOpenChange}
            >
              <PopoverTrigger asChild>
                <Button
                  variant="input"
                  size="sm"
                  role="combobox"
                  aria-expanded={isChangePageOpen}
                  aria-label={
                    selectedPage
                      ? `Switch page. Current page: ${selectedPage.name}`
                      : "Switch page"
                  }
                  className={cn(
                    "min-w-36 max-w-56 justify-between",
                    selectedPage && "text-foreground",
                  )}
                >
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    {selectedPage ? (
                      <>
                        <Icon
                          name={getPageIcon(selectedPage)}
                          className="size-3 opacity-50 shrink-0"
                        />
                        <span className="truncate">{selectedPage.name}</span>
                      </>
                    ) : (
                      <span className="truncate">{placeholder}</span>
                    )}
                  </div>
                  <div className="shrink-0">
                    <Icon
                      name="chevronDown"
                      className="size-2.5! shrink-0 opacity-50"
                    />
                  </div>
                </Button>
              </PopoverTrigger>

              <PopoverContent align="start" className="w-64 gap-0 p-0">
                <Command
                  // Match on the page name only; the item `value` is the id.
                  filter={(_value, search, keywords) =>
                    keywords
                      ?.join(" ")
                      .toLowerCase()
                      .includes(search.toLowerCase())
                      ? 1
                      : 0
                  }
                >
                  <CommandInput placeholder="Search pages..." />
                  <CommandList>
                    <CommandEmpty>
                      {switchablePages.length === 0
                        ? "No pages yet"
                        : "No pages found"}
                    </CommandEmpty>
                    <CommandGroup>
                      {switchablePages.map((page) => {
                        const isSelected = page.id === currentPageId;
                        return (
                          <CommandItem
                            key={page.id}
                            value={page.id}
                            keywords={[page.name]}
                            data-checked={isSelected}
                            aria-current={isSelected ? "true" : undefined}
                            onSelect={() => handlePageSelect(page.id)}
                            className={cn(isSelected && "bg-secondary/50")}
                          >
                            <Icon
                              name={getPageIcon(page)}
                              className="size-3 opacity-50"
                            />
                            <span className="truncate">{page.name}</span>
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
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
          <div
            className={`flex items-center justify-end w-20 text-xs ${
              saveState === "error"
                ? "text-red-500"
                : "text-zinc-500 dark:text-white/50"
            }`}
            aria-live="polite"
          >
            <span>
              {saveState === "saving"
                ? "Saving"
                : saveState === "unsaved"
                  ? "Unsaved"
                  : saveState === "error"
                    ? "Save failed"
                    : "Ready"}
            </span>
          </div>
          {/* Preview button */}
          <Button
            size="sm"
            variant="secondary"
            //onClick={}
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
            disabled={isPublishing || saveState === "saving"}
          >
            {isPublishing ? "Publishing…" : "Publish"}
          </Button>
        </div>
      </div>
    </header>
  );
}
