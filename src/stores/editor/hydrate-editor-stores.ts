// path: src/stores/editor/hydrate-editor-stores.ts

import type { EditorBootstrapContext } from "@/lib/editor/resolve-editor-bootstrap";
import { useAssetsStore } from "./useAssetsStore";
import { useCollectionLayerStore } from "./useCollectionLayerStore";
import { useCollectionsStore } from "./useCollectionsStore";
import { useComponentsStore } from "./useComponentsStore";
import {
  useEditorBootstrapStore,
  type BootstrapSectionName,
} from "./useEditorBootstrapStore";
import { useEditorStore } from "./useEditorStore";
import { useLayerStylesStore } from "./useLayerStylesStore";
import { usePagesStore } from "./usePagesStore";

/**
 * The single entry point that turns a server bootstrap payload into editor
 * state. Synchronous and network-free: the payload is already in the domain
 * shape the stores speak (mapping happened on the server).
 *
 * Call it from a LAYOUT effect, never during render — it writes to module
 * singletons, which on the server are shared across requests.
 *
 * Order matters and is preserved from the previous inline effect:
 *   1. reset everything bound to the previous campaign (the editor store's
 *      reset also clears the pages store and restores the sidebar tab),
 *   2. hydrate critical data (pages → styles → components),
 *   3. hydrate optional sections (assets, collections),
 *   4. mark this campaign as hydrated — the UI gates on this last step.
 *
 * Idempotent: running it twice for the same payload (React StrictMode's
 * dev-only double effect) lands in the same state.
 */
export function hydrateEditorStores(bootstrap: EditorBootstrapContext): void {
  // 1 ── reset
  useEditorBootstrapStore.getState().reset();
  useEditorStore.getState().resetForNewCampaign();
  useAssetsStore.getState().reset();
  useCollectionsStore.getState().reset();
  // Cached layer-level CMS data derived from the previous campaign's collections.
  useCollectionLayerStore.getState().clearAllLayerData();

  // 2 ── critical
  usePagesStore.getState().hydrateFromBootstrap(bootstrap.pages);
  // Styles and components hydrate before any retained canvas / layer-menu
  // code resolves references; the components store also drops the previous
  // campaign's drafts and pending saves.
  useLayerStylesStore.getState().hydrateFromBootstrap(bootstrap.layerStyles);
  useComponentsStore.getState().hydrateFromBootstrap(bootstrap.components);

  // 3 ── optional sections (a failed section is recorded, never thrown)
  const sectionErrors: Partial<Record<BootstrapSectionName, string>> = {};

  if (bootstrap.assets.status === "ready") {
    useAssetsStore.getState().hydrateFromBootstrap(bootstrap.assets.data);
  } else {
    sectionErrors.assets = bootstrap.assets.error;
    useAssetsStore.getState().setLoadError(bootstrap.assets.error);
  }

  if (bootstrap.collections.status === "ready") {
    useCollectionsStore
      .getState()
      .hydrateFromBootstrap(bootstrap.collections.data);
  } else {
    sectionErrors.collections = bootstrap.collections.error;
    useCollectionsStore.getState().setLoadError(bootstrap.collections.error);
  }

  // 4 ── mark ready
  useEditorBootstrapStore.getState().markReady({
    campaignId: bootstrap.campaign.id,
    generatedAt: bootstrap.generatedAt,
    sectionErrors,
  });
}
