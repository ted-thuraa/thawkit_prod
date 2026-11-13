/**
 * CMS collection route — /campaign/[campaignId]/edit/cms/[collectionId]
 *
 * Renders nothing — same pattern as `edit/cms/page.tsx`: the persistent client
 * layout owns all editor content and reads the collection / item / pagination
 * state from the URL via `useCampaignEditorUrl()` (see lib/editor/cms-url.ts).
 * This file only makes the segment a matchable route; without it a deep link
 * to a collection would 404.
 */
export default function CMSCollectionRoute() {
  return null;
}
