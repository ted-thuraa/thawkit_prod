// path: src/lib/video-embed.ts

/**
 * External video links (NOT uploads). A video layer stores a provider-aware
 * reference `{ provider, video_id }` — never a free-form URL — and the embed
 * URL is rebuilt from it at render time:
 *
 *   input (what a user pastes)  ──parseVideoInput──▶  { provider, video_id }
 *   stored in layer JSON        ──buildVideoEmbedUrl─▶  https://<allow-listed origin>/embed/<id>
 *
 * Why this shape: the only attacker-influenced parts of the iframe `src` are
 * the video id (strictly validated per provider below, so it cannot carry a
 * path, query or scheme) and fixed boolean params. The host comes from a
 * hard-coded allow-list. No arbitrary URL can become an iframe source.
 *
 * Adding a provider = one entry in `PROVIDERS` + (for the UI) one select item.
 * Pure and isomorphic.
 */

export type VideoProvider = "youtube" | "loom";

export interface VideoReference {
  provider: VideoProvider;
  video_id: string;
}

export interface EmbedOptions {
  /** YouTube only: use the youtube-nocookie.com origin. */
  privacyMode?: boolean;
  autoplay?: boolean;
  muted?: boolean;
  loop?: boolean;
  controls?: boolean;
}

interface ProviderDefinition {
  label: string;
  /** Exact, lower-case input hostnames accepted when parsing a pasted URL. */
  inputHosts: readonly string[];
  /** Strict shape of a valid id. Nothing else may reach the iframe URL. */
  idPattern: RegExp;
  extractId(url: URL): string | null;
  embed(id: string, options: EmbedOptions): string;
}

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const LOOM_ID = /^[a-f0-9]{32}$/i;

function firstSegmentAfter(url: URL, prefixes: readonly string[]): string | null {
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length >= 2 && prefixes.includes(parts[0])) return parts[1];
  return null;
}

const PROVIDERS: Record<VideoProvider, ProviderDefinition> = {
  youtube: {
    label: "YouTube",
    inputHosts: [
      "youtube.com",
      "www.youtube.com",
      "m.youtube.com",
      "youtube-nocookie.com",
      "www.youtube-nocookie.com",
      "youtu.be",
    ],
    idPattern: YOUTUBE_ID,
    extractId(url) {
      const host = url.hostname.toLowerCase();
      if (host === "youtu.be") return url.pathname.split("/").filter(Boolean)[0] ?? null;
      if (url.pathname === "/watch") return url.searchParams.get("v");
      return firstSegmentAfter(url, ["embed", "shorts", "live", "v"]);
    },
    embed(id, o) {
      const origin = o.privacyMode
        ? "https://www.youtube-nocookie.com"
        : "https://www.youtube.com";
      const params = new URLSearchParams();
      if (o.autoplay) params.set("autoplay", "1");
      if (o.muted) params.set("mute", "1");
      if (o.loop) {
        params.set("loop", "1");
        params.set("playlist", id);
      }
      if (o.controls === false) params.set("controls", "0");
      const query = params.toString();
      return `${origin}/embed/${id}${query ? `?${query}` : ""}`;
    },
  },
  loom: {
    label: "Loom",
    inputHosts: ["loom.com", "www.loom.com"],
    idPattern: LOOM_ID,
    extractId(url) {
      return firstSegmentAfter(url, ["share", "embed"]);
    },
    embed(id) {
      return `https://www.loom.com/embed/${id.toLowerCase()}`;
    },
  },
};

export const VIDEO_PROVIDERS = Object.keys(PROVIDERS) as VideoProvider[];

export function videoProviderLabel(provider: VideoProvider): string {
  return PROVIDERS[provider].label;
}

export function isVideoProvider(value: unknown): value is VideoProvider {
  return typeof value === "string" && Object.hasOwn(PROVIDERS, value);
}

export function isValidVideoId(provider: VideoProvider, id: string): boolean {
  return PROVIDERS[provider].idPattern.test(id);
}

/**
 * Turns whatever a user pasted (a share/watch/embed/short URL, or a bare id)
 * into a normalized reference, or null. Only https/http URLs on the provider's
 * exact hostnames are accepted (no subdomain tricks, no credentials).
 */
export function parseVideoInput(
  input: string,
  preferredProvider: VideoProvider = "youtube",
): VideoReference | null {
  const value = input.trim();
  if (!value) return null;

  // Bare id → the preferred provider (keeps pre-existing stored YouTube ids valid).
  if (isValidVideoId(preferredProvider, value)) {
    return { provider: preferredProvider, video_id: value };
  }

  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;

  const host = url.hostname.toLowerCase();
  for (const provider of VIDEO_PROVIDERS) {
    const def = PROVIDERS[provider];
    if (!def.inputHosts.includes(host)) continue;
    const id = def.extractId(url);
    if (id && def.idPattern.test(id)) return { provider, video_id: id };
    return null;
  }
  return null;
}

/**
 * The ONLY function that produces an iframe `src` for external video.
 * Returns null (render nothing) for an unknown provider or an id that is not
 * exactly a valid id — including ids resolved from CMS bindings at render time.
 */
export function buildVideoEmbedUrl(
  ref: { provider: string; video_id: string },
  options: EmbedOptions = {},
): string | null {
  if (!isVideoProvider(ref.provider)) return null;
  const id = (ref.video_id ?? "").trim();
  if (!isValidVideoId(ref.provider, id)) return null;
  const url = PROVIDERS[ref.provider].embed(id, options);
  return isAllowedEmbedUrl(url) ? url : null;
}

export const EMBED_ALLOWED_ORIGINS = [
  "https://www.youtube.com",
  "https://www.youtube-nocookie.com",
  "https://www.loom.com",
] as const;

/** Final guard: an embed URL must be https on an allow-listed origin. */
export function isAllowedEmbedUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (EMBED_ALLOWED_ORIGINS as readonly string[]).includes(url.origin)
    );
  } catch {
    return false;
  }
}
