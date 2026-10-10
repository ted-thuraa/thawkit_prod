// path: src/stores/editor/useEditorBootstrapStore.ts

import { create } from "zustand";

/**
 * Tracks WHICH campaign's server bootstrap the editor stores currently hold.
 *
 * Why this exists: the editor stores are module singletons, so "are the
 * stores populated?" is not enough — they may hold the PREVIOUS campaign's
 * data during a client-side campaign switch. The editor gates its first
 * render on `isHydratedFor(campaignId)`, which is true only after
 * `hydrateEditorStores` has run for exactly that campaign. It also records
 * which optional sections degraded so the UI can say so.
 *
 * SSR note: nothing ever writes this store on the server (hydration runs in
 * a layout effect, which does not run during SSR), so the server always sees
 * `idle` and renders the neutral skeleton — no per-request state can leak
 * through this module-level singleton.
 */

export type BootstrapSectionName = "assets" | "collections";

interface EditorBootstrapState {
  status: "idle" | "ready";
  campaignId: string | null;
  generatedAt: string | null;
  /** Optional sections that failed to load, with the generic server message. */
  sectionErrors: Partial<Record<BootstrapSectionName, string>>;
}

interface EditorBootstrapActions {
  markReady: (params: {
    campaignId: string;
    generatedAt: string;
    sectionErrors: Partial<Record<BootstrapSectionName, string>>;
  }) => void;
  reset: () => void;
}

const initialState: EditorBootstrapState = {
  status: "idle",
  campaignId: null,
  generatedAt: null,
  sectionErrors: {},
};

export const useEditorBootstrapStore = create<
  EditorBootstrapState & EditorBootstrapActions
>((set) => ({
  ...initialState,
  markReady: ({ campaignId, generatedAt, sectionErrors }) =>
    set({ status: "ready", campaignId, generatedAt, sectionErrors }),
  reset: () => set(initialState),
}));

/** Selector: have the stores been hydrated for exactly this campaign? */
export const selectIsHydratedFor =
  (campaignId: string) => (state: EditorBootstrapState) =>
    state.status === "ready" && state.campaignId === campaignId;
