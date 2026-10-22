/**
 * Settings route — /campaign/[campaignId]/edit/settings
 *
 * Renders nothing — same pattern as the base edit/page.tsx: the persistent
 * client layout owns all editor content and reads the area from the URL via
 * useCampaignEditorUrl(). This file only makes the segment a matchable route.
 */
export default function SettingsRoute() {
  return null;
}
