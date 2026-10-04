/**
 * Page route — /campaign/[campaignId]/edit/pages/[pageId]
 *
 *   ?view=desktop|tablet|mobile   canvas viewport
 *   ?tab=design|settings|interactions   right inspector tab (default design)
 *   ?layer=[layerId]              primary selected layer (default body)
 *   ?edit=general|seo|custom-code page-settings mode (absent otherwise)
 *
 * This is THE editor route: there is no separate `layers/[pageId]` route any
 * more. The left sidebar tab (Layers / Pages) is store-owned
 * (`useEditorStore.activeSidebarTab`) and intentionally has no URL
 * representation.
 *
 * Renders nothing — see the base edit/page.tsx comment. CampaignEditorMain
 * reads `pageId` and the query params from the URL itself (via
 * useCampaignEditorUrl), not from this file's params.
 */
export default function PageRoute() {
  return null;
}
