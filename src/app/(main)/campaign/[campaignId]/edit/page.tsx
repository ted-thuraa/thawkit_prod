/**
 * Base editor route — /campaign/[campaignId]/edit
 *
 * Renders nothing. The persistent client layout (EditorLayoutClient.tsx,
 * mounted once by layout.tsx) owns all editor content and reads the
 * current mode directly from the URL via useCampaignEditorUrl() — see
 * CampaignEditorMain.tsx's file comment for the full rationale. This file
 * exists only to make /campaign/[campaignId]/edit itself a valid, matchable
 * route segment; CampaignEditorMain immediately resolves it to the first
 * page's route (/edit/pages/[pageId]?view=desktop&tab=design&layer=body). Ported from Ycode's own app/(builder)/ycode/page.tsx,
 * which follows the identical pattern for the same reason
 * (github.com/ycode/ycode, MIT licensed).
 */
export default function EditorRoute() {
  return null;
}
