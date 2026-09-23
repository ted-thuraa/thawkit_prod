/**
 * Utilities for pages and folders
 */

import type { IconProps } from "@/components/ui/icon";
import type { Page, PageSettings, FieldVariable } from "../types/funnel";

/**
 * Reserved slugs that cannot be used at the root level (null parent folder)
 * These conflict with the app's routing structure
 */
export const RESERVED_ROOT_SLUGS = ["ycode"] as const;

/**
 * Check if a slug is reserved at root level
 */
export function isReservedRootSlug(slug: string): boolean {
  return RESERVED_ROOT_SLUGS.includes(
    slug.toLowerCase().trim() as (typeof RESERVED_ROOT_SLUGS)[number],
  );
}

export interface PageTreeNode {
  id: string;
  type: "page";
  data: Page;
  children?: PageTreeNode[];
}

export interface FlattenedPageNode {
  id: string;
  type: "page";
  data: Page;
  depth: number;
  parentId: string | null;
  index: number;
  collapsed?: boolean;
}

/**
 * Find the homepage from a list of pages
 */
export function findHomepage(pages: Page[]): Page | null {
  return pages.find(isHomepage) || null;
}

/**
 * Check if a page is the homepage
 */
export function isHomepage(page: Page): boolean {
  return page.pageType === "landing_page";
}

/**
 * Strip leading/trailing slashes from a single slug segment so it doesn't
 * collapse into an empty path or introduce double slashes when joined.
 * Preserves interior slashes (legacy nested slugs like `foo/bar`).
 */
export function normalizeSlugSegment(slug: string | null | undefined): string {
  return (slug ?? "").replace(/^\/+|\/+$/g, "");
}

/**
 * Build the full slug path for a page or folder
 * Returns the full URL path starting with "/"
 *
 * @example
 * buildSlugPath(page, folders) // "/products/item-1"
 * buildSlugPath(indexPage, folders) // "/products" (index pages don't have slug)
 * buildSlugPath(folder, folders) // "/products"
 */
export function buildSlugPath(
  item: Page | null,
  itemType: "page",
  slugFieldKey: string = "{slug}",
): string {
  if (!item) return "/";

  const slugParts: string[] = [];

  const page = item as Page;

  if (page.is_dynamic) {
    slugParts.push(slugFieldKey);
  } else if (page.pageType !== "landing_page" && page.slug) {
    slugParts.push(page.slug);
  }

  // Legacy data sometimes stores an index page slug as the literal `/`. Without
  // normalisation that produces paths like `/blog//` when concatenated.
  return "/" + slugParts.map(normalizeSlugSegment).filter(Boolean).join("/");
}

/**
 * Get icon name based on node type and data
 */
export function getNodeIcon(
  node: FlattenedPageNode | PageTreeNode,
): IconProps["name"] {
  return getPageIcon(node.data as Page);
}

/**
 * Get icon name based on node type and data
 */
export function getPageIcon(page: Page): IconProps["name"] {
  if (page.pageType === "landing_page") return "homepage";
  if (page.is_dynamic) return "dynamicPage";
  return "page";
}

/**
 * Build a tree structure from pages and folders
 */
export function buildPageTree(pages: Page[]) {
  return;
}

/**
 * Flatten a page tree structure into a linear array with depth information
 */
export function flattenPageTree(
  nodes: PageTreeNode[],
  parentId: string | null = null,
  depth: number = 0,
  collapsedIds: Set<string> = new Set(),
): FlattenedPageNode[] {
  const flattened: FlattenedPageNode[] = [];

  nodes.forEach((node, index) => {
    const isCollapsed = collapsedIds.has(node.id);

    flattened.push({
      id: node.id,
      type: node.type,
      data: node.data,
      depth,
      parentId,
      index,
      collapsed: isCollapsed,
    });

    // Only flatten children if not collapsed and has children
    if (node.children && node.children.length > 0 && !isCollapsed) {
      flattened.push(
        ...flattenPageTree(node.children, node.id, depth + 1, collapsedIds),
      );
    }
  });

  return flattened;
}

/**
 * Rebuild tree structure after reordering
 */
export function rebuildPageTree(
  flattenedNodes: FlattenedPageNode[],
  movedId: string,
  newParentId: string | null,
  newOrder: number,
): PageTreeNode[] {
  // Create a copy of all nodes
  const nodeCopy = flattenedNodes.map((n) => ({
    ...n,
    data: { ...n.data },
  }));

  // Find and update the moved node
  const movedNode = nodeCopy.find((n) => n.id === movedId);
  if (!movedNode) {
    console.error("❌ REBUILD ERROR: Moved node not found!");
    return [];
  }

  // Update moved node's parent and index
  movedNode.parentId = newParentId;
  movedNode.index = newOrder;

  // Group nodes by parent
  const byParent = new Map<string | null, FlattenedPageNode[]>();
  nodeCopy.forEach((node) => {
    const parent = node.parentId;
    if (!byParent.has(parent)) {
      byParent.set(parent, []);
    }
    byParent.get(parent)!.push(node);
  });

  // Sort each group by index and reassign indices
  byParent.forEach((children, parentId) => {
    // Sort by current index first
    children.sort((a, b) => a.index - b.index);

    // If this group contains the moved node, reorder it
    const movedNodeInGroup = children.find((n) => n.id === movedId);
    if (movedNodeInGroup) {
      // Remove moved node from its current position
      const movedIndex = children.findIndex((n) => n.id === movedId);
      children.splice(movedIndex, 1);

      // Insert at new position
      let insertIndex = 0;
      for (let i = 0; i < children.length; i++) {
        if (children[i].index < newOrder) {
          insertIndex = i + 1;
        } else {
          break;
        }
      }

      children.splice(insertIndex, 0, movedNodeInGroup);
    }

    // Reassign sequential indices
    children.forEach((child, idx) => {
      child.index = idx;
    });
  });

  // Build tree recursively
  function buildNode(nodeId: string): PageTreeNode {
    const node = nodeCopy.find((n) => n.id === nodeId)!;
    const childNodes = byParent.get(nodeId) || [];

    const result: PageTreeNode = {
      id: node.id,
      type: node.type,
      data: node.data,
    };

    if (childNodes.length > 0) {
      result.children = childNodes.map((child) => buildNode(child.id));
    }

    return result;
  }

  // Build root level
  const rootNodes = byParent.get(null) || [];
  const result = rootNodes.map((node) => buildNode(node.id));

  return result;
}

/**
 * Check if a node is a descendant of another
 */
export function isDescendant(
  node: FlattenedPageNode,
  target: FlattenedPageNode,
  allNodes: FlattenedPageNode[],
): boolean {
  if (node.id === target.id) return true;

  const parent = allNodes.find((n) => n.id === target.parentId);
  if (!parent) return false;

  return isDescendant(node, parent, allNodes);
}

/**
 * Generate a URL-safe slug from a name
 * @example generateSlug('About Us') // 'about-us'
 */
/**
 * Transliteration map for international characters to ASCII equivalents
 * Supports Cyrillic, Latin Extended, Greek, and other common characters
 */
const TRANSLITERATION_MAP: Record<string, string> = {
  // Lithuanian
  ą: "a",
  č: "c",
  ę: "e",
  ė: "e",
  į: "i",
  š: "s",
  ų: "u",
  ū: "u",
  ž: "z",
  Ą: "A",
  Č: "C",
  Ę: "E",
  Ė: "E",
  Į: "I",
  Š: "S",
  Ų: "U",
  Ū: "U",
  Ž: "Z",

  // Russian/Cyrillic
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "yo",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "h",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "shch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
  А: "A",
  Б: "B",
  В: "V",
  Г: "G",
  Д: "D",
  Е: "E",
  Ё: "Yo",
  Ж: "Zh",
  З: "Z",
  И: "I",
  Й: "Y",
  К: "K",
  Л: "L",
  М: "M",
  Н: "N",
  О: "O",
  П: "P",
  Р: "R",
  С: "S",
  Т: "T",
  У: "U",
  Ф: "F",
  Х: "H",
  Ц: "Ts",
  Ч: "Ch",
  Ш: "Sh",
  Щ: "Shch",
  Ъ: "",
  Ы: "Y",
  Ь: "",
  Э: "E",
  Ю: "Yu",
  Я: "Ya",

  // Polish (unique characters not in Lithuanian)
  ć: "c",
  ł: "l",
  ń: "n",
  ó: "o",
  ś: "s",
  ź: "z",
  ż: "z",
  Ć: "C",
  Ł: "L",
  Ń: "N",
  Ó: "O",
  Ś: "S",
  Ź: "Z",
  Ż: "Z",

  // German
  ä: "ae",
  ö: "oe",
  ü: "ue",
  ß: "ss",
  Ä: "Ae",
  Ö: "Oe",
  Ü: "Ue",

  // French (unique characters not in other languages)
  à: "a",
  â: "a",
  é: "e",
  è: "e",
  ê: "e",
  ë: "e",
  î: "i",
  ï: "i",
  ô: "o",
  ù: "u",
  û: "u",
  ÿ: "y",
  ç: "c",
  À: "A",
  Â: "A",
  É: "E",
  È: "E",
  Ê: "E",
  Ë: "E",
  Î: "I",
  Ï: "I",
  Ô: "O",
  Ù: "U",
  Û: "U",
  Ÿ: "Y",
  Ç: "C",

  // Spanish (unique characters not in French)
  á: "a",
  í: "i",
  ú: "u",
  ñ: "n",
  Á: "A",
  Í: "I",
  Ú: "U",
  Ñ: "N",

  // Portuguese
  ã: "a",
  õ: "o",
  Ã: "A",
  Õ: "O",

  // Czech/Slovak
  ě: "e",
  ř: "r",
  ť: "t",
  ů: "u",
  ý: "y",
  Ě: "E",
  Ř: "R",
  Ť: "T",
  Ů: "U",
  Ý: "Y",

  // Romanian (unique characters)
  ă: "a",
  ș: "s",
  ț: "t",
  Ă: "A",
  Ș: "S",
  Ț: "T",

  // Turkish
  ğ: "g",
  ı: "i",
  ş: "s",
  Ğ: "G",
  İ: "I",
  Ş: "S",

  // Greek
  α: "a",
  β: "b",
  γ: "g",
  δ: "d",
  ε: "e",
  ζ: "z",
  η: "i",
  θ: "th",
  ι: "i",
  κ: "k",
  λ: "l",
  μ: "m",
  ν: "n",
  ξ: "x",
  ο: "o",
  π: "p",
  ρ: "r",
  σ: "s",
  ς: "s",
  τ: "t",
  υ: "y",
  φ: "f",
  χ: "ch",
  ψ: "ps",
  ω: "o",
  Α: "A",
  Β: "B",
  Γ: "G",
  Δ: "D",
  Ε: "E",
  Ζ: "Z",
  Η: "I",
  Θ: "Th",
  Ι: "I",
  Κ: "K",
  Λ: "L",
  Μ: "M",
  Ν: "N",
  Ξ: "X",
  Ο: "O",
  Π: "P",
  Ρ: "R",
  Σ: "S",
  Τ: "T",
  Υ: "Y",
  Φ: "F",
  Χ: "Ch",
  Ψ: "Ps",
  Ω: "O",

  // Scandinavian
  å: "a",
  æ: "ae",
  ø: "o",
  Å: "A",
  Æ: "Ae",
  Ø: "O",

  // Latvian
  ā: "a",
  ē: "e",
  ģ: "g",
  ī: "i",
  ķ: "k",
  ļ: "l",
  ņ: "n",
  Ā: "A",
  Ē: "E",
  Ģ: "G",
  Ī: "I",
  Ķ: "K",
  Ļ: "L",
  Ņ: "N",

  // Ukrainian (additional to Russian)
  є: "ye",
  і: "i",
  ї: "yi",
  ґ: "g",
  Є: "Ye",
  І: "I",
  Ї: "Yi",
  Ґ: "G",

  // Serbian (additional to Russian/Cyrillic)
  ђ: "dj",
  ј: "j",
  љ: "lj",
  њ: "nj",
  ћ: "c",
  џ: "dz",
  Ђ: "Dj",
  Ј: "J",
  Љ: "Lj",
  Њ: "Nj",
  Ћ: "C",
  Џ: "Dz",
};

/**
 * Transliterate international characters to ASCII equivalents
 * @param text - Text to transliterate
 * @returns Transliterated text with ASCII characters
 */
function transliterate(text: string): string {
  let result = "";

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const transliterated = TRANSLITERATION_MAP[char];

    if (transliterated !== undefined) {
      result += transliterated;
    } else {
      result += char;
    }
  }

  return result;
}

/**
 * Sanitize slug to only allow [a-z0-9-] characters
 * Replaces invalid characters with "-" and removes consecutive dashes
 * Transliterates international characters first (Lithuanian, Russian, etc.)
 * @param slug - The slug to sanitize
 * @param allowTrailingDash - If true, allows trailing dashes (for real-time input). Defaults to false.
 */
export function sanitizeSlug(
  slug: string,
  allowTrailingDash: boolean = false,
): string {
  // First, transliterate international characters
  let sanitized = transliterate(slug);

  // Convert to lowercase and replace invalid chars with dash
  sanitized = sanitized
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-") // Replace invalid chars with dash
    .replace(/-+/g, "-"); // Replace multiple consecutive dashes with single dash

  // Remove leading dashes
  sanitized = sanitized.replace(/^-+/, "");

  // Remove trailing dashes only if not allowed (for final validation)
  if (!allowTrailingDash) {
    sanitized = sanitized.replace(/-+$/, "");
  }

  return sanitized;
}

export function generateSlug(name: string): string {
  return sanitizeSlug(name);
}

/**
 * Generate a unique page slug, appending -2, -3, etc. if duplicates exist in the same folder
 * @param excludePageId - Optional page ID to exclude when checking duplicates (for editing)
 */
export function generateUniqueSlug(
  baseName: string,
  pages: Page[],
  folderId: string | null = null,
  isPublished: boolean = false,
  excludePageId?: string,
): string {
  const baseSlug = generateSlug(baseName);

  if (!baseSlug) return "";

  // Check if base slug exists in the same folder and published state
  const existingSlugs = pages
    .filter(
      (p) =>
        p.id !== excludePageId && // Exclude current page if editing
        p.is_published === isPublished, // Same published state
    )
    .map((p) => p.slug.toLowerCase());

  // Check if base slug is available (not duplicate and not reserved at root)
  const isBaseSlugReserved = folderId === null && isReservedRootSlug(baseSlug);
  if (!existingSlugs.includes(baseSlug) && !isBaseSlugReserved) {
    return baseSlug;
  }

  // Otherwise, find the next available number
  let counter = 2;
  let uniqueSlug = `${baseSlug}-${counter}`;

  while (existingSlugs.includes(uniqueSlug)) {
    counter++;
    uniqueSlug = `${baseSlug}-${counter}`;
  }

  return uniqueSlug;
}

/**
 * Find the highest number in names matching "Prefix N" pattern and return next number
 * @example getNextNumberFromNames([{ name: 'Page 5' }], 'Page') // 6
 */
export function getNextNumberFromNames(
  items: Array<{ name: string }>,
  prefix: string,
): number {
  // Extract numbers from names that match the pattern "Prefix N"
  const numbers = items
    .map((item) => {
      const match = item.name.match(new RegExp(`^${prefix}\\s+(\\d+)$`, "i"));
      return match ? parseInt(match[1], 10) : 0;
    })
    .filter((num) => num > 0);

  // If no numbered items exist, start at 1
  if (numbers.length === 0) {
    return 1;
  }

  // Return the highest number + 1
  return Math.max(...numbers) + 1;
}

/**
 * Calculate the next order value for a new item
 * If selectedItemId is provided and it's a page, insert right after it
 * Otherwise, use max order of siblings + 1 (append to end)
 */
export function calculateNextOrder(
  parentFolderId: string | null,
  depth: number,
  pages: Page[],

  selectedItemId?: string | null,
): number {
  // If a page is selected, insert right after it
  if (selectedItemId) {
    const selectedPage = pages.find((p) => p.id === selectedItemId);
    if (
      selectedPage &&
      selectedPage.depth === depth &&
      selectedPage.deleted_at === null // Don't use deleted pages as reference
    ) {
      // Insert right after the selected page
      return (selectedPage.order || 0) + 1;
    }
  }

  // Append to end: find max order across pages and folders (exclude error pages and deleted items)
  const siblingPages = pages.filter(
    (p) => p.depth === depth && p.deleted_at === null, // Exclude deleted pages
  );

  // Combine all siblings and find the max order across both pages and folders
  const allSiblings = [...siblingPages.map((p) => ({ order: p.order || 0 }))];

  if (allSiblings.length === 0) {
    return 0; // First item in empty folder
  }

  const maxOrder = Math.max(...allSiblings.map((s) => s.order));
  return maxOrder + 1;
}

/**
 * Validation result type
 */
export interface ValidationResult {
  isValid: boolean;
  error?: string;
}

/**
 * Validate page name
 * @returns Validation result with error message if invalid
 */
export function validatePageName(name: string): ValidationResult {
  if (!name.trim()) {
    return { isValid: false, error: "Page name is required" };
  }
  return { isValid: true };
}

/**
 * Validate folder name
 * @returns Validation result with error message if invalid
 */
export function validateFolderName(name: string): ValidationResult {
  if (!name.trim()) {
    return { isValid: false, error: "Folder name is required" };
  }
  return { isValid: true };
}

/**
 * Validate page slug based on page type
 * @param slug - The slug to validate
 * @param isIndex - Whether the page is an index page
 * @param isErrorPage - Whether the page is an error page
 * @returns Validation result with error message if invalid
 */
export function validatePageSlug(
  slug: string,
  isIndex: boolean,
  isErrorPage: boolean,
): ValidationResult {
  // Error pages must have empty slug
  if (isErrorPage && slug.trim()) {
    return { isValid: false, error: "Error pages must have an empty slug" };
  }

  // Index pages must have empty slug
  if (isIndex && slug.trim()) {
    return { isValid: false, error: "Index pages must have an empty slug" };
  }

  // Non-index, non-error pages must have non-empty slug
  if (!isIndex && !isErrorPage && !slug.trim()) {
    return { isValid: false, error: "Slug is required for non-index pages" };
  }

  return { isValid: true };
}

/**
 * Validate folder slug
 * @returns Validation result with error message if invalid
 */
export function validateFolderSlug(slug: string): ValidationResult {
  if (!slug.trim()) {
    return { isValid: false, error: "Slug is required" };
  }
  return { isValid: true };
}

/**
 * Check for duplicate page slug in the same folder and published state
 * @param slug - The slug to check
 * @param pages - Array of all pages
 * @param folderId - The folder ID to check within
 * @param isPublished - The published state to check
 * @param excludePageId - Optional page ID to exclude from check (for editing)
 * @returns Validation result with error message if duplicate found
 */
export function checkDuplicatePageSlug(
  slug: string,
  pages: Page[],
  folderId: string | null,
  isPublished: boolean,
  excludePageId?: string,
): ValidationResult {
  const trimmedSlug = slug.trim();

  // Check for reserved slugs at root level
  if (folderId === null && isReservedRootSlug(trimmedSlug)) {
    return {
      isValid: false,
      error: `Slug "${trimmedSlug}" cannot be used inside the root folder.`,
    };
  }

  const duplicateSlug = pages.find(
    (p) =>
      p.id !== excludePageId &&
      p.slug === trimmedSlug &&
      p.is_published === isPublished,
  );

  if (duplicateSlug) {
    return {
      isValid: false,
      error: "This slug is already used by another page in this folder",
    };
  }

  return { isValid: true };
}

/**
 * Error page configuration
 */
export interface ErrorPageConfig {
  code: number;
  name: string;
  settings: PageSettings;
  layers: string;
}

/**
 * Default error pages configuration
 * Used for seeding database and creating new error pages.
 *
 * The 401 page ships with a password-protected form layer
 * (`settings.form.form_type === 'password_protected'`). At runtime,
 * `LayerRendererPublic` detects this marker and wires its submit handler to
 * `/api/page-auth/verify` instead of the standard form-submissions endpoint.
 * The form/input/button layers are marked `restrictions: { copy: false, delete: false }`
 * so the structure cannot be removed (only restyled). If the form is missing on
 * an existing 401 page, `PageRenderer` falls back to the hardcoded `PasswordForm`.
 */
export const DEFAULT_ERROR_PAGES: ErrorPageConfig[] = [
  {
    code: 401,
    name: "401 - Password required",
    settings: {
      seo: {
        title: "Error 401 - Password required",
        description:
          "This page is password protected. Please enter the password to continue.",
        image: null,
        noindex: true,
      },
    },
    layers: JSON.stringify([
      {
        id: "body",
        name: "body",
        classes: "",
        children: [
          {
            id: "layer-1762789137823-g2cdo46ld",
            name: "section",
            design: {
              layout: {
                display: "Flex",
                isActive: true,
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
              },
              sizing: { isActive: true, minHeight: "100vh" },
              spacing: {
                isActive: true,
                paddingTop: "4rem",
                paddingBottom: "4rem",
                paddingLeft: "1rem",
                paddingRight: "1rem",
              },
            },
            classes:
              "flex flex-col items-center justify-center min-h-[100vh] px-[1rem] py-[4rem]",
            children: [
              {
                id: "layer-1762789141753-zpz5jyobc",
                name: "div",
                design: {
                  layout: {
                    isActive: true,
                    display: "Flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "16",
                  },
                  sizing: { isActive: true, width: "100%", maxWidth: "32rem" },
                  typography: { isActive: true, textAlign: "center" },
                },
                classes:
                  "w-full max-w-[32rem] flex flex-col items-center text-center gap-[16px]",
                children: [
                  {
                    id: "layer-1762789150900-pw-icon",
                    name: "icon",
                    settings: { tag: "div" },
                    design: {
                      sizing: { isActive: true, width: "32", height: "32" },
                      typography: { isActive: true, color: "#9ca3af" },
                    },
                    classes: "text-[#9ca3af] w-[32px] h-[32px]",
                    children: [],
                    customName: "Lock icon",
                    variables: {
                      icon: {
                        src: {
                          type: "static_text",
                          data: {
                            content:
                              '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
                          },
                        },
                      },
                    },
                  },
                  {
                    id: "layer-1762789150930-pw-text-block",
                    name: "div",
                    design: {
                      layout: {
                        isActive: true,
                        display: "Flex",
                        flexDirection: "column",
                        gap: "0.5rem",
                        alignItems: "center",
                      },
                      sizing: { isActive: true, width: "100%" },
                    },
                    classes: "w-full flex flex-col items-center gap-[0.5rem]",
                    children: [
                      {
                        id: "layer-1762789150944-5qezgblbe",
                        name: "heading",
                        settings: { tag: "h1" },
                        design: {
                          typography: {
                            isActive: true,
                            color: "#111827",
                            fontSize: "30",
                            fontWeight: "700",
                          },
                        },
                        classes: "font-[700] text-[#111827] text-[30px]",
                        children: [],
                        customName: "Heading",
                        restrictions: { editText: true },
                        variables: {
                          text: {
                            type: "dynamic_rich_text",
                            data: {
                              content: "",
                              //getTiptapTextContent("Password protected"),
                            },
                          },
                        },
                      },
                      {
                        id: "layer-1762789197005-7z2wy597y",
                        name: "text",
                        settings: { tag: "p" },
                        design: {
                          typography: {
                            isActive: true,
                            fontSize: "12",
                            color: "#111827",
                          },
                        },
                        classes: "text-[12px] text-[#111827]",
                        children: [],
                        customName: "Subtitle",
                        restrictions: { editText: true },
                        variables: {
                          text: {
                            type: "dynamic_rich_text",
                            data: {
                              content:
                                "To access this page, please enter the required password below.",
                            },
                          },
                        },
                      },
                    ],
                    customName: "Text block",
                  },
                ],
                customName: "Container",
              },
            ],
            customName: "Section",
          },
        ],
      },
    ]),
  },
  {
    code: 404,
    name: "404 - Page not found",
    settings: {
      seo: {
        title: "Error 404 - Page not found",
        description: "The page you are looking for could not be found.",
        image: null,
        noindex: true,
      },
    },
    layers: JSON.stringify([
      {
        id: "body",
        name: "body",
        classes: "",
        children: [
          {
            id: "layer-1762789137823-g2cdo46ld",
            name: "section",
            design: {
              layout: {
                display: "Flex",
                isActive: true,
                flexDirection: "column",
              },
              sizing: { height: "100vh", isActive: true },
              spacing: {
                isActive: true,
                paddingTop: "3rem",
                paddingBottom: "3rem",
              },
            },
            classes: "flex flex-col gap-[1rem] py-[3rem] h-[100vh]",
            children: [
              {
                id: "layer-1762789141753-zpz5jyobc",
                name: "div",
                design: {
                  sizing: {
                    height: "100vh",
                    isActive: true,
                    maxWidth: "80rem",
                  },
                  spacing: {
                    isActive: true,
                    marginLeft: "auto",
                    marginRight: "auto",
                    paddingLeft: "1rem",
                    paddingRight: "1rem",
                  },
                },
                classes: "max-w-[80rem] mx-auto px-[1rem] h-[100vh]",
                children: [
                  {
                    id: "layer-1762789168560-icft8ynp5",
                    name: "div",
                    design: {
                      layout: {
                        gap: "6",
                        display: "flex",
                        isActive: true,
                        alignItems: "center",
                        flexDirection: "column",
                        justifyContent: "center",
                      },
                      sizing: { height: "100%", isActive: true },
                      typography: { isActive: true, textAlign: "center" },
                    },
                    classes:
                      "items-center text-center h-full flex flex-col justify-center gap-[6px]",
                    children: [
                      {
                        id: "layer-1762789150944-5qezgblbe",
                        name: "heading",
                        settings: {
                          tag: "h1",
                        },
                        design: {
                          typography: {
                            color: "#111827",
                            fontSize: "30",
                            isActive: true,
                            fontWeight: "700",
                          },
                        },
                        classes: "font-[700] text-[#111827] text-[30px]",
                        children: [],
                        customName: "Heading",
                        restrictions: { editText: true },
                        variables: {
                          text: {
                            type: "dynamic_rich_text",
                            data: {},
                          },
                        },
                      },
                      {
                        id: "layer-1762789197005-7z2wy597y",
                        name: "text",
                        settings: {
                          tag: "p",
                        },
                        design: {
                          typography: {
                            fontSize: "12",
                            color: "#111827",
                            isActive: true,
                          },
                        },
                        classes: "text-[12px] text-[#111827]",
                        children: [],
                        customName: "Text",
                        restrictions: { editText: true },
                        variables: {
                          text: {
                            type: "dynamic_rich_text",
                            data: {},
                          },
                        },
                      },
                      {
                        id: "layer-1762789197006-7z2wy597z",
                        name: "text",
                        settings: {
                          tag: "p",
                        },
                        design: {
                          typography: {
                            fontSize: "12",
                            color: "#111827",
                            isActive: true,
                          },
                        },
                        classes: "text-[12px] text-[#111827]",
                        children: [],
                        customName: "Text",
                        restrictions: { editText: true },
                        variables: {
                          text: {
                            type: "dynamic_rich_text",
                            data: {},
                          },
                        },
                      },
                    ],
                    customName: "Container",
                  },
                ],
                customName: "Container",
              },
            ],
            customName: "Section",
          },
        ],
      },
    ]),
  },
  {
    code: 500,
    name: "500 - Server error",
    settings: {
      seo: {
        title: "Error 500 - Server error",
        description: "An unexpected error occurred. Please try again later.",
        image: null,
        noindex: true,
      },
    },
    layers: JSON.stringify([
      {
        id: "body",
        name: "body",
        classes: "",
        children: [
          {
            id: "layer-1762789137823-g2cdo46ld",
            name: "section",
            design: {
              layout: {
                display: "Flex",
                isActive: true,
                flexDirection: "column",
              },
              sizing: { height: "100vh", isActive: true },
              spacing: {
                isActive: true,
                paddingTop: "3rem",
                paddingBottom: "3rem",
              },
            },
            classes: "flex flex-col gap-[1rem] py-[3rem] h-[100vh]",
            children: [
              {
                id: "layer-1762789141753-zpz5jyobc",
                name: "div",
                design: {
                  sizing: {
                    height: "100vh",
                    isActive: true,
                    maxWidth: "80rem",
                  },
                  spacing: {
                    isActive: true,
                    marginLeft: "auto",
                    marginRight: "auto",
                    paddingLeft: "1rem",
                    paddingRight: "1rem",
                  },
                },
                classes: "max-w-[80rem] mx-auto px-[1rem] h-[100vh]",
                children: [
                  {
                    id: "layer-1762789168560-icft8ynp5",
                    name: "div",
                    design: {
                      layout: {
                        gap: "6",
                        display: "flex",
                        isActive: true,
                        alignItems: "center",
                        flexDirection: "column",
                        justifyContent: "center",
                      },
                      sizing: { height: "100%", isActive: true },
                      typography: { isActive: true, textAlign: "center" },
                    },
                    classes:
                      "items-center text-center h-full flex flex-col justify-center gap-[6px]",
                    children: [
                      {
                        id: "layer-1762789150944-5qezgblbe",
                        name: "heading",
                        settings: {
                          tag: "h1",
                        },
                        design: {
                          typography: {
                            color: "#111827",
                            fontSize: "30",
                            isActive: true,
                            fontWeight: "700",
                          },
                        },
                        classes: "font-[700] text-[#111827] text-[30px]",
                        children: [],
                        customName: "Heading",
                        restrictions: { editText: true },
                        variables: {
                          text: {
                            type: "dynamic_rich_text",
                            data: {},
                          },
                        },
                      },
                      {
                        id: "layer-1762789197005-7z2wy597y",
                        name: "text",
                        settings: {
                          tag: "p",
                        },
                        design: {
                          typography: {
                            fontSize: "12",
                            color: "#111827",
                            isActive: true,
                          },
                        },
                        classes: "text-[12px] text-[#111827]",
                        children: [],
                        customName: "Text",
                        restrictions: { editText: true },
                        variables: {
                          text: {
                            type: "dynamic_rich_text",
                            data: {},
                          },
                        },
                      },
                      {
                        id: "layer-1762789197006-7z2wy597z",
                        name: "text",
                        settings: {
                          tag: "p",
                        },
                        design: {
                          typography: {
                            fontSize: "12",
                            color: "#111827",
                            isActive: true,
                          },
                        },
                        classes: "text-[12px] text-[#111827]",
                        children: [],
                        customName: "Text",
                        restrictions: { editText: true },
                        variables: {
                          text: {
                            type: "dynamic_rich_text",
                            data: {},
                          },
                        },
                      },
                    ],
                    customName: "Container",
                  },
                ],
                customName: "Container",
              },
            ],
            customName: "Section",
          },
        ],
      },
    ]),
  },
];
