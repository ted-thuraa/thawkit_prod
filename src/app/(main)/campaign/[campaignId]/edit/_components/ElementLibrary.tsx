"use client";

/**
 * Element Library Slide-Out Panel
 *
 * Displays categorized list of available elements that can be added to the page.
 * Uses custom pointer-based drag-and-drop for cross-iframe dragging to canvas.
 */

import React, {
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
} from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import Icon from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Empty,
  EmptyDescription,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

import Image from "next/image";
import {
  getLayerFromTemplate,
  getBlockName,
  getBlockIcon,
  getLayoutTemplate,
  getLayoutCategory,
  getLayoutPreviewImage,
  getLayoutsByCategory,
  getAllLayoutKeys,
} from "@/lib/templates/blocks";
import { DEFAULT_ASSETS } from "@/lib/asset-constants";
import {
  canHaveChildren,
  assignOrderClassToNewLayer,
  collectAllSettingsIds,
  generateUniqueSettingsId,
  findLayerById,
} from "@/lib/layer-utils";
//import { checkCircularReference, isCircularComponentReference } from '@/lib/component-utils';
import { cn, generateId } from "@/lib/utils";
import { toast } from "sonner";
import { componentsApi } from "@/lib/api";
import type { Layer } from "@/types/funnel";
//import ComponentCard from './ComponentCard';
//import RenameComponentDialog from './RenameComponentDialog';
//import SaveLayoutDialog from './SaveLayoutDialog';
import { usePagesStore } from "@/stores/editor/usePagesStore";
import { useEditorStore } from "@/stores/editor/useEditorStore";
//import { useEditorActions } from '@/hooks/use-editor-url';
//import { useLocalizationMode } from '@/hooks/use-localization-mode';
import type { UseLiveLayerUpdatesReturn } from "@/hooks/use-live-layer-updates";
import { EditorElementType } from "@/lib/editor/element-templates";

/**
 * Element Button with drag support
 * Uses simple mousedown handler to start drag
 */
interface ElementButtonProps {
  elementType: string;
  source: "elements" | "layouts";
  name: string;
  icon: React.ComponentProps<typeof Icon>["name"];
  onClick: () => void;
  onDragStart: (
    e: React.MouseEvent,
    elementType: string,
    source: "elements" | "layouts",
    name: string,
  ) => void;
  children?: React.ReactNode;
  className?: string;
  variant?: "default" | "card";
}

function ElementButton({
  elementType,
  source,
  name,
  icon,
  onClick,
  onDragStart,
  children,
  className,
  variant = "default",
}: ElementButtonProps) {
  const isDraggingRef = useRef(false);

  const handleMouseDown = (e: React.MouseEvent) => {
    // Only handle left mouse button
    if (e.button !== 0) return;

    const startX = e.clientX;
    const startY = e.clientY;
    const DRAG_THRESHOLD = 5;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (!isDraggingRef.current && distance > DRAG_THRESHOLD) {
        isDraggingRef.current = true;
        // Create a synthetic React event for the onDragStart callback
        onDragStart(e, elementType, source, name);
      }
    };

    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);

      // If we didn't drag, trigger click
      if (!isDraggingRef.current) {
        onClick();
      }

      isDraggingRef.current = false;
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  if (variant === "card") {
    return (
      <Button
        onMouseDown={handleMouseDown}
        size="sm"
        variant="secondary"
        className={cn(
          "justify-start flex-col items-start p-1.5 overflow-hidden hover:opacity-90 transition-opacity rounded-[10px] h-auto! cursor-grab active:cursor-grabbing select-none",
          className,
        )}
      >
        {children}
      </Button>
    );
  }

  return (
    <Button
      onMouseDown={handleMouseDown}
      size="sm"
      variant="secondary"
      className={cn(
        "justify-start cursor-grab active:cursor-grabbing select-none",
        className,
      )}
    >
      <Icon name={icon} />
      <span className="truncate">{name}</span>
    </Button>
  );
}

interface ElementLibraryProps {
  isOpen: boolean;
  onClose: () => void;
  liveLayerUpdates?: UseLiveLayerUpdatesReturn | null;
}

// Category definitions
const elementCategories: Record<string, string[]> = {
  Structure: [
    "section",
    "container",
    "div",
    "hr",
    "columns",
    "rows",
    "grid",
    "collection",
  ],
  Content: ["heading", "text", "richText"],
  Actions: ["button"],
  Media: ["image", "icon", "video", "audio"],
  Form: [
    "form",
    "filter",
    "input",
    "textarea",
    "select",
    "checkbox",
    "radio",
    "label",
  ],
  Table: ["table", "thead", "tbody", "tr", "th", "td"],
  Utilities: ["map", "slider", "lightbox", "localeSelector", "htmlEmbed"],
};

/**
 * Check if a layer tree contains any inlined components
 */
function hasInlinedComponents(layer: Layer): boolean {
  if ((layer as any)._inlinedComponentName) return true;
  if (layer.children) {
    return layer.children.some((child) => hasInlinedComponents(child));
  }
  return false;
}

/**
 * Process a layout layer tree to restore inlined components.
 * When a layout contains _inlinedComponentName, we create actual components
 * and replace the inlined content with component instances.
 */
async function restoreInlinedComponents(
  layer: Layer,
  existingComponents: { id: string; name: string }[],
  createdComponents: Map<string, string>, // name -> componentId
): Promise<Layer> {
  const newLayer = { ...layer } as Layer & {
    _inlinedComponentName?: string;
    _inlinedComponentVariables?: any[];
  };

  // Check if this layer has inlined component data
  if (newLayer._inlinedComponentName && newLayer.children?.length) {
    const componentName = newLayer._inlinedComponentName;
    const componentVariables = newLayer._inlinedComponentVariables;

    // Check if we already created this component in this batch
    let componentId: string | undefined = createdComponents.get(componentName);

    if (!componentId) {
      // Check if a component with this name already exists
      const existing = existingComponents.find((c) => c.name === componentName);

      if (existing) {
        componentId = existing.id;
      } else {
        // Create new component from inlined layers (including variables)
        try {
          // Debug: check if layers have interactions and log layer IDs
          const collectLayerIds = (layers: any[]): string[] => {
            const ids: string[] = [];
            for (const l of layers) {
              if (l.id) ids.push(l.id);
              if (l.children) ids.push(...collectLayerIds(l.children));
            }
            return ids;
          };
          const collectInteractionTargets = (layers: any[]): string[] => {
            const targets: string[] = [];
            for (const l of layers) {
              if (l.interactions) {
                for (const int of l.interactions) {
                  for (const tween of int.tweens || []) {
                    if (tween.layer_id) targets.push(tween.layer_id);
                  }
                }
              }
              if (l.children)
                targets.push(...collectInteractionTargets(l.children));
            }
            return targets;
          };

          const layerIds = collectLayerIds(newLayer.children || []);
          const interactionTargets = collectInteractionTargets(
            newLayer.children || [],
          );
          const missingTargets = interactionTargets.filter(
            (t) => !layerIds.includes(t),
          );

          if (missingTargets.length > 0) {
            console.warn(
              `[restoreInlinedComponents] ⚠️ Missing layer targets:`,
              missingTargets,
            );
          }

          const result = await componentsApi.create({
            name: componentName,
            layers: newLayer.children,
            variables: componentVariables,
          });
          const newId = result.data?.id;
          if (newId) {
            componentId = newId;
            createdComponents.set(componentName, newId);
          }
        } catch (error) {
          console.error(
            `Failed to create component "${componentName}":`,
            error,
          );
        }
      }
    }

    if (componentId) {
      // Convert to component instance
      newLayer.componentId = componentId;
      newLayer.children = []; // Clear inlined children
      delete newLayer._inlinedComponentName;
      delete newLayer._inlinedComponentVariables;
    }
  }

  // Recursively process children that weren't converted to component instances
  // Process sequentially to avoid race conditions when creating components
  if (newLayer.children?.length && !newLayer.componentId) {
    const processedChildren: Layer[] = [];
    for (const child of newLayer.children) {
      const processed = await restoreInlinedComponents(
        child,
        existingComponents,
        createdComponents,
      );
      processedChildren.push(processed);
    }
    newLayer.children = processedChildren;
  }

  return newLayer;
}

export default function ElementLibrary({
  isOpen,
  onClose,
  liveLayerUpdates,
}: ElementLibraryProps) {
  const addLayerFromTemplate = usePagesStore((s) => s.addLayerFromTemplate);
  const updateLayer = usePagesStore((s) => s.updateLayer);
  //const setDraftLayers = usePagesStore((s) => s.setDraftLayers);
  const pages = usePagesStore((s) => s.pages);

  const currentPageId = useEditorStore((s) => s.currentPageId);
  // Intentionally NOT subscribing to selectedLayerId — every usage below is
  // inside an event handler / async callback. Subscribing would re-render the
  // entire library (1700+ lines, dozens of ElementButtons, tooltips, context
  // menus) on every layer click. Read lazily via getState() instead.
  const setSelectedLayerId = useEditorStore((s) => s.setSelectedLayerId);
  const editingComponentId = useEditorStore((s) => s.editingComponentId);
  const editingComponentVariantId = useEditorStore(
    (s) => s.editingComponentVariantId,
  );
  const activeBreakpoint = useEditorStore((s) => s.activeBreakpoint);
  const pushComponentNavigation = useEditorStore(
    (s) => s.pushComponentNavigation,
  );
  const startCanvasDrag = useEditorStore((s) => s.startCanvasDrag);
  const endCanvasDrag = useEditorStore((s) => s.endCanvasDrag);
  const leftSidebarWidth = useEditorStore((s) => s.leftSidebarWidth);

  //const { openComponent } = useEditorActions();

  // Delete component state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletePreviewInfo, setDeletePreviewInfo] = useState<{
    pageCount: number;
    componentCount: number;
  } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [activeTab, setActiveTab] = React.useState<
    "elements" | "layouts" | "components"
  >(() => {
    if (typeof window !== "undefined") {
      const saved = sessionStorage.getItem("elementLibrary-activeTab");
      if (saved && ["elements", "layouts", "components"].includes(saved)) {
        return saved as "elements" | "layouts" | "components";
      }
    }
    return "elements";
  });
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const tabRefs = React.useRef<Record<string, HTMLDivElement | null>>({});

  const circularComponentIds = useMemo(() => {}, [editingComponentId]);

  const [isEditLayoutDialogOpen, setIsEditLayoutDialogOpen] = useState(false);
  const [editingLayoutKey, setEditingLayoutKey] = useState<string>("");
  const [editingLayoutName, setEditingLayoutName] = useState<string>("");
  const [editingLayoutCategory, setEditingLayoutCategory] =
    useState<string>("Custom");
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(
    () => {
      // Try to load from sessionStorage first
      if (typeof window !== "undefined") {
        const saved = sessionStorage.getItem(
          "elementLibrary-collapsedCategories",
        );
        if (saved) {
          try {
            return new Set(JSON.parse(saved));
          } catch (e) {
            // If parsing fails, fall through to default
          }
        }
      }
      // Initialize with all categories collapsed except "Navigation", "Hero", "Blog header" and "Blog posts"
      const allCategories = Object.keys(getLayoutsByCategory());
      return new Set(
        allCategories.filter(
          (cat) =>
            cat !== "Navigation" &&
            cat !== "Hero" &&
            cat !== "Blog header" &&
            cat !== "Blog posts",
        ),
      );
    },
  );

  // Sync tab when explicitly requested (e.g., "Add layout" button)
  React.useEffect(() => {
    const handleToggle = (event: Event) => {
      const tab = (event as CustomEvent<{ tab?: string }>).detail?.tab;
      if (tab && ["elements", "layouts", "components"].includes(tab)) {
        setActiveTab(tab as "elements" | "layouts" | "components");
      }
    };
    window.addEventListener("toggleElementLibrary", handleToggle);
    return () =>
      window.removeEventListener("toggleElementLibrary", handleToggle);
  }, []);

  // Persist active tab to sessionStorage
  React.useEffect(() => {
    if (typeof window !== "undefined") {
      sessionStorage.setItem("elementLibrary-activeTab", activeTab);
    }
  }, [activeTab]);

  // Persist collapsed state to sessionStorage
  React.useEffect(() => {
    if (typeof window !== "undefined") {
      sessionStorage.setItem(
        "elementLibrary-collapsedCategories",
        JSON.stringify(Array.from(collapsedCategories)),
      );
    }
  }, [collapsedCategories]);

  const toggleCategory = (category: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  // Handle drag start from element buttons
  // This is called when the mouse moves past the drag threshold
  const handleElementDragStart = useCallback(
    (
      e: React.MouseEvent,
      elementType: string,
      source: "elements" | "layouts",
      displayName: string,
    ) => {
      // Set drag state in store - this triggers the DragPreviewPortal and hit-testing
      startCanvasDrag(elementType, source, displayName, {
        x: e.clientX,
        y: e.clientY,
      });
      // Close sidebar when drag starts
      onClose();
    },
    [startCanvasDrag, onClose],
  );

  const handleAddElement = (elementType: string) => {
    const selectedLayerId = useEditorStore.getState().selectedLayerId;

    // Regular page mode
    if (!currentPageId) return;

    // Determine parent (selected container or Body)
    let parentId = selectedLayerId || "body";

    // Special handling for Section layers - always add to Body
    const isAddingSection = elementType === "section";
    if (isAddingSection) {
      parentId = "body";
    }

    // Add the layer using the template
    const result = addLayerFromTemplate(
      currentPageId,
      parentId,
      elementType as EditorElementType,
    );

    // Select the newly added layer
    if (result) {
      setSelectedLayerId(result.newLayerId);

      // Assign order class to new layer if siblings have responsive order classes
      if (result.parentToExpand) {
        const freshDraft =
          usePagesStore.getState().draftsByPageId[currentPageId];
        if (freshDraft) {
          const updatedLayers = assignOrderClassToNewLayer(
            freshDraft.layers,
            result.parentToExpand,
            result.newLayerId,
            activeBreakpoint,
          );
          // Only update if layers actually changed
          if (updatedLayers !== freshDraft.layers) {
            //setDraftLayers(currentPageId, updatedLayers);
          }
        }
      }

      // Broadcast layer add to other collaborators
      if (liveLayerUpdates && currentPageId) {
        // Get FRESH state from store (not stale draftsByPageId from render)
        const freshDraft =
          usePagesStore.getState().draftsByPageId[currentPageId];
        if (freshDraft) {
          // Find the new layer AND its actual parent (may differ from requested parentId)
          const findLayerWithParent = (
            layers: any[],
            id: string,
            parent: any = null,
          ): { layer: any; parent: any } | null => {
            for (const layer of layers) {
              if (layer.id === id) return { layer, parent };
              if (layer.children) {
                const found = findLayerWithParent(layer.children, id, layer);
                if (found) return found;
              }
            }
            return null;
          };
          const found = findLayerWithParent(
            freshDraft.layers,
            result.newLayerId,
          );
          if (found?.layer) {
            // Use the ACTUAL parent ID where the layer was placed
            const actualParentId = found.parent?.id || null;
            liveLayerUpdates.broadcastLayerAdd(
              currentPageId,
              actualParentId,
              elementType,
              found.layer,
            );
          }
        }
      }

      // Note: parentToExpand is handled by LayersTree component
      // We dispatch a custom event for LayersTree to listen to
      if (result.parentToExpand) {
        window.dispatchEvent(
          new CustomEvent("expandLayer", {
            detail: { layerId: result.parentToExpand },
          }),
        );
      }
    }

    // Close the panel
    onClose();
  };

  const handleAddLayout = async (layoutKey: string) => {
    const selectedLayerId = useEditorStore.getState().selectedLayerId;

    // Regular page mode
    if (!currentPageId) return;

    // Get layout template first (we need it to check if it's a section)
    const layoutTemplate = getLayoutTemplate(layoutKey);
    if (!layoutTemplate) return;

    // Determine parent (selected container or Body)
    // Special handling for Section layouts - always add to Body
    const isAddingSection = layoutTemplate.name === "section";
    let parentId = selectedLayerId || "body";
    if (isAddingSection) {
      parentId = "body";
    }

    // Use the internal addLayerFromTemplate logic but with our layout
    const draft = usePagesStore.getState().draftsByPageId[currentPageId];
    if (!draft) {
      const page = usePagesStore
        .getState()
        .pages.find((p) => p.id === currentPageId);
      if (!page) return;
    }

    // Collect existing settings IDs to generate unique ones
    const existingSettingsIds = collectAllSettingsIds(draft?.layers || []);
    const usedSettingsIds = new Set<string>(existingSettingsIds);

    // Track old→new settings.id mappings so we can update 'for' attributes on labels
    const idMappings = new Map<string, string>();

    // Helper to normalize layer and generate unique settings IDs
    const normalizeLayerWithUniqueIds = (layer: any): any => {
      const normalized = { ...layer };

      // Generate unique settings.id if the layer has one
      if (normalized.settings?.id) {
        const originalId = normalized.settings.id;
        const uniqueId = generateUniqueSettingsId(originalId, usedSettingsIds);
        usedSettingsIds.add(uniqueId);
        normalized.settings = {
          ...normalized.settings,
          id: uniqueId,
        };
        if (originalId !== uniqueId) {
          idMappings.set(originalId, uniqueId);
        }
      }

      // Recursively normalize children
      if (normalized.children) {
        normalized.children = normalized.children.map((child: any) =>
          normalizeLayerWithUniqueIds(child),
        );
      }

      return normalized;
    };

    // Update 'for' attributes on labels to match the new unique settings IDs
    const updateForAttributes = (layer: any): any => {
      const updated = { ...layer };
      if (updated.attributes?.for && idMappings.has(updated.attributes.for)) {
        updated.attributes = {
          ...updated.attributes,
          for: idMappings.get(updated.attributes.for),
        };
      }
      if (updated.children) {
        updated.children = updated.children.map((child: any) =>
          updateForAttributes(child),
        );
      }
      return updated;
    };

    // getLayoutTemplate already handles ID regeneration and interaction remapping
    let newLayer = normalizeLayerWithUniqueIds(layoutTemplate);
    if (idMappings.size > 0) {
      newLayer = updateForAttributes(newLayer);
    }

    // Restore inlined components (create actual components from inlined data)
    if (hasInlinedComponents(newLayer)) {
      const createdComponents = new Map<string, string>();
      // newLayer = await restoreInlinedComponents(
      //   newLayer,
      //   components.map(c => ({ id: c.id, name: c.name })),
      //   createdComponents
      // );

      // // Refresh components store if new components were created
      // if (createdComponents.size > 0) {
      //   await loadComponents();
      // }
    }

    // Find parent layer
    const findLayerWithParent = (
      tree: any[],
      id: string,
      parent: any | null = null,
    ): { layer: any; parent: any | null } | null => {
      for (const node of tree) {
        if (node.id === id) return { layer: node, parent };
        if (node.children) {
          const found = findLayerWithParent(node.children, id, node);
          if (found) return found;
        }
      }
      return null;
    };

    const currentDraft = usePagesStore.getState().draftsByPageId[
      currentPageId
    ] || {
      id: `draft-${currentPageId}`,
      page_id: currentPageId,
      layers: [],
      is_published: false,
      created_at: new Date().toISOString(),
      deleted_at: null,
    };

    const result = findLayerWithParent(currentDraft.layers, parentId);
    let newLayers;
    let parentToExpand: string | null = null;

    if (!result) {
      // Add to root
      newLayers = [...currentDraft.layers, newLayer];
    } else {
      // Check if parent can have children
      if (canHaveChildren(result.layer)) {
        // Add as child
        const updateLayerInTree = (
          tree: any[],
          layerId: string,
          updater: (l: any) => any,
        ): any[] => {
          return tree.map((node) => {
            if (node.id === layerId) {
              return updater(node);
            }
            if (node.children && node.children.length > 0) {
              return {
                ...node,
                children: updateLayerInTree(node.children, layerId, updater),
              };
            }
            return node;
          });
        };

        newLayers = updateLayerInTree(
          currentDraft.layers,
          parentId,
          (parent) => ({
            ...parent,
            children: [...(parent.children || []), newLayer],
          }),
        );
        parentToExpand = parentId;
      } else {
        // Insert after the selected layer
        if (result.parent) {
          const updateLayerInTree = (
            tree: any[],
            layerId: string,
            updater: (l: any) => any,
          ): any[] => {
            return tree.map((node) => {
              if (node.id === layerId) {
                return updater(node);
              }
              if (node.children && node.children.length > 0) {
                return {
                  ...node,
                  children: updateLayerInTree(node.children, layerId, updater),
                };
              }
              return node;
            });
          };

          newLayers = updateLayerInTree(
            currentDraft.layers,
            result.parent.id,
            (grandparent) => {
              const children = grandparent.children || [];
              const selectedIndex = children.findIndex(
                (c: any) => c.id === parentId,
              );
              const newChildren = [...children];
              newChildren.splice(selectedIndex + 1, 0, newLayer);
              return { ...grandparent, children: newChildren };
            },
          );
          parentToExpand = result.parent.id;
        } else {
          // Selected layer is at root level, insert after it
          const selectedIndex = currentDraft.layers.findIndex(
            (l: any) => l.id === parentId,
          );
          newLayers = [...currentDraft.layers];
          newLayers.splice(selectedIndex + 1, 0, newLayer);
        }
      }
    }

    // Assign order class to new layer if siblings have responsive order classes
    let finalLayers = newLayers;
    if (parentToExpand) {
      finalLayers = assignOrderClassToNewLayer(
        newLayers,
        parentToExpand,
        newLayer.id,
        activeBreakpoint,
      );
    }

    // Update the draft with the new layers
    //usePagesStore.getState().setDraftLayers(currentPageId, finalLayers);

    // Broadcast layout add to other collaborators - find actual parent
    if (liveLayerUpdates) {
      const findLayerWithParent = (
        layers: any[],
        id: string,
        parent: any = null,
      ): { layer: any; parent: any } | null => {
        for (const layer of layers) {
          if (layer.id === id) return { layer, parent };
          if (layer.children) {
            const found = findLayerWithParent(layer.children, id, layer);
            if (found) return found;
          }
        }
        return null;
      };
      const found = findLayerWithParent(newLayers, newLayer.id);
      const actualParentId = found?.parent?.id || null;
      liveLayerUpdates.broadcastLayerAdd(
        currentPageId,
        actualParentId,
        layoutKey,
        newLayer,
      );
    }

    // Select the root layer of the layout
    setSelectedLayerId(newLayer.id);

    // Expand parent if needed
    if (parentToExpand) {
      window.dispatchEvent(
        new CustomEvent("expandLayer", {
          detail: { layerId: parentToExpand },
        }),
      );
    }

    // Close the panel
    onClose();
  };

  const handleDeleteLayout = async (layoutKey: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent triggering the add layout action

    if (
      !confirm(`Are you sure you want to delete the layout "${layoutKey}"?`)
    ) {
      return;
    }

    try {
      const response = await fetch(`/ycode/api/layouts/${layoutKey}`, {
        method: "DELETE",
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to delete layout");
      }

      // Refresh the page to reload layouts
      window.location.reload();
    } catch (error) {
      console.error("Failed to delete layout:", error);
      alert("Failed to delete layout. Check console for details.");
    }
  };

  const handleEditLayout = async (layoutKey: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent triggering the add layout action

    // Get current category
    const category = getLayoutCategory(layoutKey) || "Custom";

    // Convert layout-key to Layout Name
    const layoutName = layoutKey
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");

    // Set state and open dialog
    setEditingLayoutKey(layoutKey);
    setEditingLayoutName(layoutName);
    setEditingLayoutCategory(category);
    setIsEditLayoutDialogOpen(true);
  };

  const handleConfirmEditLayout = async (
    layoutName: string,
    category: string,
    imageFile: File | null,
    oldLayoutKey?: string,
  ) => {
    if (!oldLayoutKey) return;

    try {
      // Generate new layout key from name
      const newLayoutKey = layoutName.toLowerCase().replace(/\s+/g, "-");

      // Call API to update layout
      const response = await fetch(`/ycode/api/layouts/${oldLayoutKey}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          newLayoutKey,
          newLayoutName: layoutName,
          category,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to update layout");
      }

      // Refresh the page to reload layouts
      window.location.reload();
    } catch (error) {
      console.error("Failed to update layout:", error);
      throw error;
    }
  };

  // const deleteConfirmDescription = `Are you sure you want to delete "${componentName}"? ${usageSuffix}`;

  // Read-only translation mode: hide the library entirely so the user knows
  // they can't add or modify structural elements while in a non-default locale.
  // if (isLocalizing) {
  //   return (
  //     <div
  //       className={cn(
  //         'fixed top-14 bottom-0 w-64 bg-background border-r z-50 flex flex-col items-center justify-center p-6 text-center',
  //         !isOpen && 'hidden'
  //       )}
  //       style={{ left: `${leftSidebarWidth}px` }}
  //     >
  //       <Empty>
  //         <EmptyMedia variant="icon">
  //           <Icon name="globe" />
  //         </EmptyMedia>
  //         <EmptyTitle>Translating</EmptyTitle>
  //         <EmptyDescription>
  //           Switch to the default locale to add elements.
  //         </EmptyDescription>
  //       </Empty>
  //     </div>
  //   );
  // }

  return (
    <div
      className={cn(
        "fixed top-14 bottom-0 w-64 bg-background border-r z-50 flex flex-col",
        !isOpen && "hidden",
      )}
      style={{ left: `${leftSidebarWidth}px` }}
    >
      {/* Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          const tab = value as "elements" | "layouts" | "components";
          setActiveTab(tab);
          tabRefs.current[tab]?.scrollTo(0, 0);
        }}
        className="flex flex-col h-full overflow-hidden gap-0"
      >
        <div className="flex flex-col shrink-0 gap-2">
          <div className="p-4 pb-0">
            <TabsList className="w-full">
              <TabsTrigger value="elements">Elements</TabsTrigger>
              <TabsTrigger value="layouts">Layouts</TabsTrigger>
              <TabsTrigger value="components">Components</TabsTrigger>
            </TabsList>
          </div>

          <hr className="mt-2 mb-0 mx-4 shrink-0" />
        </div>

        <TabsContent
          value="elements"
          forceMount
          ref={(el) => {
            tabRefs.current.elements = el;
          }}
          className="flex flex-col divide-y overflow-y-auto flex-1 px-4 pb-4 no-scrollbar"
        >
          {Object.entries(elementCategories).map(([categoryName, elements]) => (
            <div key={categoryName} className="flex flex-col pb-5">
              <header className="py-5">
                <Label>{categoryName}</Label>
              </header>
              <div className="grid grid-cols-2 gap-2">
                {elements.map((el) => (
                  <ElementButton
                    key={el}
                    elementType={el}
                    source="elements"
                    name={getBlockName(el) || el}
                    icon={getBlockIcon(el)}
                    onClick={() => handleAddElement(el)}
                    onDragStart={handleElementDragStart}
                  />
                ))}
              </div>
            </div>
          ))}
        </TabsContent>

        <TabsContent
          value="layouts"
          forceMount
          ref={(el) => {
            tabRefs.current.layouts = el;
          }}
          className="flex flex-col overflow-y-auto flex-1 px-4 pb-4 no-scrollbar"
        >
          {getAllLayoutKeys().length === 0 ? (
            <Empty>
              <EmptyTitle>No layouts available</EmptyTitle>
              <EmptyDescription>
                Pre-built page layouts will appear here
              </EmptyDescription>
            </Empty>
          ) : (
            <div className="flex flex-col divide-y pb-5">
              {Object.entries(getLayoutsByCategory()).map(
                ([category, layoutKeys]) => {
                  const isCollapsed = collapsedCategories.has(category);

                  return (
                    <div key={category} className="flex flex-col">
                      <header
                        className="py-5 flex items-center gap-2 cursor-pointer hover:opacity-70 transition-opacity"
                        onClick={() => toggleCategory(category)}
                      >
                        <Icon
                          name="triangle-down"
                          className={cn(
                            "size-3 opacity-25 transition-transform",
                            isCollapsed && "-rotate-90",
                          )}
                        />
                        <Label className="cursor-pointer">{category}</Label>
                      </header>
                      <div
                        className={cn(
                          "grid grid-cols-1 gap-1.5 pb-5",
                          isCollapsed && "hidden",
                        )}
                      >
                        {layoutKeys.map((layoutKey) => {
                          const previewImage = getLayoutPreviewImage(layoutKey);

                          return (
                            <ContextMenu key={layoutKey}>
                              <ContextMenuTrigger asChild>
                                <ElementButton
                                  elementType={layoutKey}
                                  source="layouts"
                                  name={layoutKey}
                                  icon="layout"
                                  onClick={() => handleAddLayout(layoutKey)}
                                  onDragStart={handleElementDragStart}
                                  variant="card"
                                >
                                  {previewImage && (
                                    <Image
                                      src={previewImage}
                                      width={640}
                                      height={262}
                                      alt="Layout preview"
                                      loading="eager"
                                      className="object-contain w-full h-full rounded pointer-events-none"
                                    />
                                  )}
                                </ElementButton>
                              </ContextMenuTrigger>

                              <ContextMenuContent>
                                <ContextMenuItem
                                  onClick={() => handleAddLayout(layoutKey)}
                                >
                                  <Icon name="plus" className="size-3" />
                                  Add to Canvas
                                </ContextMenuItem>

                                {process.env.NODE_ENV === "development" && (
                                  <>
                                    <ContextMenuSeparator />
                                    <ContextMenuItem
                                      onClick={(e) =>
                                        handleEditLayout(layoutKey, e)
                                      }
                                    >
                                      <Icon name="pencil" className="size-3" />
                                      Edit
                                    </ContextMenuItem>
                                    <ContextMenuItem
                                      onClick={(e) =>
                                        handleDeleteLayout(layoutKey, e)
                                      }
                                      className="text-red-500 focus:text-red-500"
                                    >
                                      <Icon name="trash" className="size-3" />
                                      Delete
                                    </ContextMenuItem>
                                  </>
                                )}
                              </ContextMenuContent>
                            </ContextMenu>
                          );
                        })}
                      </div>
                    </div>
                  );
                },
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* <SaveLayoutDialog
          open={isEditLayoutDialogOpen}
          onOpenChange={setIsEditLayoutDialogOpen}
          onConfirm={handleConfirmEditLayout}
          defaultName={editingLayoutName}
          defaultCategory={editingLayoutCategory}
          mode="edit"
          layoutKey={editingLayoutKey}
        /> */}
    </div>
  );
}
