/**
 * Canvas/design route — /campaigns/[campaignId]/layers/[pageId]
 * (?view=desktop|tablet|mobile, ?tab=design|settings|interactions,
 * ?layer=[layerId])
 *
 * Renders nothing — see the base campaigns/[campaignId]/page.tsx comment.
 * CampaignEditorMain reads `pageId` and the query params from the URL
 * itself (via useCampaignEditorUrl), not from this file's params.
 */
export default function LayersRoute() {
  return null;
}
