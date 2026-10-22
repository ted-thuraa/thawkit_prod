// path: src/lib/editor/editor-areas.ts

/**
 * Pure (React-free, store-free) model of the campaign editor's top-level
 * AREAS and the routes that mount them.
 *
 *   Design    /campaign/{id}/edit                  (base, resolves to a page)
 *             /campaign/{id}/edit/pages/{pageId}
 *             /campaign/{id}/edit/components/{componentId}
 *   CMS       /campaign/{id}/edit/cms[/…]
 *   Forms     /campaign/{id}/edit/forms[/…]
 *   Settings  /campaign/{id}/edit/settings[/…]
 *
 * The active area is NEVER stored: it is always derived from the pathname via
 * `parseEditorRoute` → `areaForRouteType`, so it cannot disagree with the URL
 * (refresh, back/forward and deep links all work by construction).
 *
 * Matching is segment-based, not substring/prefix-based: `/edit/formsX` is not
 * Forms and `/edit/pages-old/x` is not a page.
 */

export const EDITOR_AREAS = ["design", "cms", "forms", "settings"] as const;
export type EditorArea = (typeof EDITOR_AREAS)[number];

/** Areas that are entered through their own base route (Design is page-driven). */
export type EditorStandaloneArea = Exclude<EditorArea, "design">;

export const EDITOR_AREA_LABELS: Record<EditorArea, string> = {
  design: "Design",
  cms: "CMS",
  forms: "Forms",
  settings: "Settings",
};

export type EditorRouteType =
  "page" | "component" | "cms" | "forms" | "settings" | null;

export interface ParsedEditorRoute {
  type: EditorRouteType;
  /** `pageId` / `componentId` for Design routes; first nested segment otherwise. */
  resourceId: string | null;
}

const NO_ROUTE: ParsedEditorRoute = { type: null, resourceId: null };

const STANDALONE_AREAS: readonly string[] = ["cms", "forms", "settings"];

function isStandaloneArea(segment: string): segment is EditorStandaloneArea {
  return STANDALONE_AREAS.includes(segment);
}

/**
 * Classify a pathname under `/campaign/{id}/edit`.
 *
 * Page / component routes must be exactly `<kind>/<id>`. CMS / Forms /
 * Settings classify at ANY depth beneath their segment, so a nested route such
 * as `/edit/settings/general` still resolves to its area. Anything else
 * (including the base `/edit` and unknown paths) is `{ type: null }`.
 */
export function parseEditorRoute(
  pathname: string | null | undefined,
): ParsedEditorRoute {
  const segments = (pathname ?? "").split("?")[0].split("/").filter(Boolean);
  if (segments.length < 3) return NO_ROUTE;
  if (segments[0] !== "campaign" || segments[2] !== "edit") return NO_ROUTE;

  const [kind, resourceId, ...rest] = segments.slice(3);
  if (!kind) return NO_ROUTE;

  if (kind === "pages" || kind === "components") {
    if (!resourceId || rest.length > 0) return NO_ROUTE;
    return {
      type: kind === "pages" ? "page" : "component",
      resourceId,
    };
  }

  if (isStandaloneArea(kind)) {
    return { type: kind, resourceId: resourceId ?? null };
  }

  return NO_ROUTE;
}

/**
 * Route type → area. `null` (base `/edit`, or an unrecognised path that the
 * editor redirects to a page) is Design, matching the benchmark's behaviour.
 */
export function areaForRouteType(type: EditorRouteType): EditorArea {
  switch (type) {
    case "cms":
    case "forms":
    case "settings":
      return type;
    case "page":
    case "component":
    case null:
      return "design";
  }
}

/** Base editor URL — resolves to the first page when it has no resource. */
export function buildEditorBaseUrl(campaignId: string): string {
  return `/campaign/${campaignId}/edit`;
}

/** Entry URL of a standalone area. */
export function buildAreaUrl(
  campaignId: string,
  area: EditorStandaloneArea,
): string {
  return `${buildEditorBaseUrl(campaignId)}/${area}`;
}

/**
 * True when `url` (path + optional query) is a Design route of THIS campaign —
 * used to validate a remembered "return to Design" URL before pushing it.
 */
export function isDesignUrlForCampaign(
  url: string | null | undefined,
  campaignId: string,
): boolean {
  if (!url) return false;
  const [path] = url.split("?");
  const parsed = parseEditorRoute(path);
  if (parsed.type !== "page" && parsed.type !== "component") return false;
  return path.startsWith(`${buildEditorBaseUrl(campaignId)}/`);
}
