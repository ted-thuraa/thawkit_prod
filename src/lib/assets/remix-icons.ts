// path: src/lib/assets/remix-icons.ts

/**
 * The File Manager's built-in icon LIBRARY: Remix Icon, served locally from
 * the `react-icons` dependency the app already ships (`react-icons/ri`).
 *
 * Ycode's equivalent fetches the same icon family from a hosted HTTP API
 * (`YCODE_EXTERNAL_API_URL/api/icons`). ThawKit has no such service and must
 * not depend on someone else's, so this module exposes the SAME contract
 * (`fetchRemixIcons({search, style, limit, offset})` → `{icons, total, …}`)
 * backed by the installed package. Consequences, stated plainly:
 *   - icons are real Remix icons (1,539 fill + 1,539 line + single-style ones);
 *   - icon NAMES are derived from react-icons export names (`RiHome2Line` →
 *     `home-2-line`); good for labels/search, not guaranteed identical to the
 *     upstream Remix file names in every case (e.g. `html5`);
 *   - react-icons carries no category metadata, so `categories` is empty and
 *     the UI hides the category filter instead of inventing categories;
 *   - nothing is fetched over the network.
 *
 * The 2 MB icon module and `react-dom/server` are loaded lazily, only when the
 * Remix view is first opened.
 *
 * An icon becomes a usable ASSET only when the user saves it from the
 * "New SVG icon" dialog: it is stored as an inline-SVG asset (see
 * `createSvgAssetAction`), identical to a hand-made custom SVG. Library icons
 * are never referenced directly by pages — pages reference asset ids.
 */

export type RemixIconStyle = "fill" | "line";

export interface RemixIcon {
  source: "remix";
  /** Derived kebab-case name, e.g. `home-2-line`. */
  name: string;
  category: string;
  /** `null` for the single-style Remix icons that have no Fill/Line variant. */
  style: RemixIconStyle | null;
  /** Ready-to-use markup (24×24 viewBox, `currentColor`). Pass through the sanitizer before injecting. */
  svg: string;
}

export interface RemixIconCategory {
  name: string;
  count: number;
}

export interface RemixIconsParams {
  search?: string;
  /** Ignored: react-icons has no categories (see module docs). */
  category?: string;
  style?: RemixIconStyle;
  limit?: number;
  offset?: number;
}

export interface RemixIconsResponse {
  icons: RemixIcon[];
  /** Matches for the current filters (for pagination). */
  total: number;
  categories: RemixIconCategory[];
  /** Size of the whole library. */
  totalIcons: number;
  limit: number;
  offset: number;
}

interface CatalogEntry {
  exportName: string;
  name: string;
  /** `name` without dashes, lower-case — the search key. */
  key: string;
  style: RemixIconStyle | null;
}

interface Catalog {
  entries: CatalogEntry[];
  render(exportName: string): string;
}

/** `RiHome2Line` → `{ name: "home-2-line", style: "line" }`. */
export function describeRemixExport(exportName: string): {
  name: string;
  style: RemixIconStyle | null;
} {
  const base = exportName.replace(/^Ri/, "");
  const style: RemixIconStyle | null = base.endsWith("Fill")
    ? "fill"
    : base.endsWith("Line")
      ? "line"
      : null;
  const stem = style ? base.slice(0, -4) : base;
  const kebab = stem
    .replace(/([A-Z])/g, "-$1")
    .replace(/([a-zA-Z])(\d)/g, "$1-$2")
    .replace(/^-/, "")
    .toLowerCase();
  return { name: style ? `${kebab}-${style}` : kebab, style };
}

const normalizeSearch = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, "");

let catalogPromise: Promise<Catalog> | null = null;

function loadCatalog(): Promise<Catalog> {
  if (!catalogPromise) {
    catalogPromise = (async () => {
      const [ri, react, server] = await Promise.all([
        import("react-icons/ri"),
        import("react"),
        import("react-dom/server"),
      ]);
      const components = ri as unknown as Record<string, React.ComponentType<{ size?: number }>>;
      const entries = Object.keys(components)
        .filter((k) => /^Ri[A-Z0-9]/.test(k) && typeof components[k] === "function")
        .map((exportName): CatalogEntry => {
          const { name, style } = describeRemixExport(exportName);
          return { exportName, name, key: normalizeSearch(name), style };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
      const cache = new Map<string, string>();
      return {
        entries,
        render(exportName: string) {
          let svg = cache.get(exportName);
          if (svg === undefined) {
            svg = server.renderToStaticMarkup(
              react.createElement(components[exportName], { size: 24 }),
            );
            cache.set(exportName, svg);
          }
          return svg;
        },
      };
    })().catch((error) => {
      catalogPromise = null; // allow a retry after a transient chunk-load failure
      throw error;
    });
  }
  return catalogPromise;
}

export async function fetchRemixIcons(
  params: RemixIconsParams = {},
): Promise<RemixIconsResponse> {
  const catalog = await loadCatalog();
  const limit = Math.max(1, Math.min(params.limit ?? 100, 500));
  const offset = Math.max(0, params.offset ?? 0);
  const query = params.search ? normalizeSearch(params.search) : "";

  const matches = catalog.entries.filter(
    (e) =>
      (!params.style || e.style === params.style) && (!query || e.key.includes(query)),
  );

  return {
    icons: matches.slice(offset, offset + limit).map((e) => ({
      source: "remix",
      name: e.name,
      category: "",
      style: e.style,
      svg: catalog.render(e.exportName),
    })),
    total: matches.length,
    categories: [],
    totalIcons: catalog.entries.length,
    limit,
    offset,
  };
}
