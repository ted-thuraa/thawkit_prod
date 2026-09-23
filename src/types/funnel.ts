// path: src/types/PageCMS/layerSchema.ts

// Collection link field types (simplified for CMS fields)
export type CollectionLinkType = "url" | "page" | "asset";

// Collection Link Field Value (stored as JSON in collection item values)
// Note: Link behavior (target, rel) is set on the layer, not in the CMS value
export interface CollectionLinkValue {
  type: CollectionLinkType;

  // URL link - simple string URL
  url?: string;

  // Page link - link to a page (static or dynamic with static item)
  page?: {
    id: string; // Page ID
    collection_item_id?: string | null; // Static collection item ID (no current-page/current-collection)
    anchor_layer_id?: string | null; // Optional layer ID for anchor links
  };

  // Asset link - link to a downloadable asset
  asset?: {
    id: string | null;
  };
}
// Collection Types (EAV Architecture)
export type CollectionFieldType =
  | "text"
  | "number"
  | "boolean"
  | "date"
  | "date_only"
  | "color"
  | "reference"
  | "multi_reference"
  | "rich_text"
  | "image"
  | "audio"
  | "video"
  | "document"
  | "link"
  | "email"
  | "phone"
  | "option"
  | "count"
  | "status";

export type CollectionSortDirection = "asc" | "desc" | "manual";

export interface CollectionSorting {
  field: string; // field ID or 'manual_order'
  direction: CollectionSortDirection;
}

export interface Collection {
  id: string; // UUID
  name: string;
  uuid: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  sorting: CollectionSorting | null;
  order: number;
  is_published: boolean;
  draft_items_count?: number;
  has_published_version?: boolean;
}

export interface CreateCollectionData {
  name: string;
  sorting?: CollectionSorting | null;
  order?: number;
  is_published?: boolean;
}

export interface UpdateCollectionData {
  name?: string;
  sorting?: CollectionSorting | null;
  order?: number;
}

/** Field-specific settings stored in the data column */
export interface CollectionFieldData {
  multiple?: boolean; // For asset fields - allow multiple files
  options?: { id: string; name: string }[]; // For option fields - selectable values
  // For count fields: which child collection / reference field to count back from
  count?: { collectionId: string; fieldId: string };
}

export interface CreateCollectionFieldData {
  name: string;
  key?: string | null;
  type: CollectionFieldType;
  default?: string | null;
  fillable?: boolean;
  order: number;
  collection_id: string; // UUID
  reference_collection_id?: string | null; // UUID
  hidden?: boolean;
  is_computed?: boolean;
  data?: CollectionFieldData;
  is_published?: boolean;
}

export interface UpdateCollectionFieldData {
  name?: string;
  key?: string | null;
  type?: CollectionFieldType;
  default?: string | null;
  fillable?: boolean;
  order?: number;
  reference_collection_id?: string | null; // UUID
  hidden?: boolean;
  data?: CollectionFieldData;
}

export interface CollectionField {
  id: string; // UUID
  name: string;
  key: string | null; // Built-in fields have a key to identify them
  type: CollectionFieldType;
  default: string | null;
  fillable: boolean;
  order: number;
  collection_id: string; // UUID
  reference_collection_id: string | null; // UUID
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  hidden: boolean;
  is_computed: boolean;
  data: CollectionFieldData;
  is_published: boolean;
}

export interface CollectionItem {
  id: string; // UUID
  collection_id: string; // UUID
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  manual_order: number;
  is_published: boolean;
  is_publishable: boolean;
  content_hash: string | null;
}

// Helper type for working with items + values
export interface CollectionItemWithValues extends CollectionItem {
  values: Record<string, string>; // field_id (UUID) -> value
  publish_status?: "new" | "updated" | "deleted"; // Status badge for publish modal
}

// Global Variables (site-wide typed singletons)
//
// A global combines a field-like schema (name + type) and its value in one
// row. Its type is a subset of CollectionFieldType so it can ride the same
// FieldVariable binding/resolution/formatting rails as collection fields.
export type GlobalVariableType = Extract<
  CollectionFieldType,
  "text" | "rich_text" | "number" | "date" | "color" | "image" | "link"
>;

export const GLOBAL_VARIABLE_TYPES: readonly GlobalVariableType[] = [
  "text",
  "rich_text",
  "number",
  "date",
  "color",
  "image",
  "link",
] as const;

/** Runtime guard for an allowed global variable type (used by API validation). */
export function isValidGlobalVariableType(
  type: unknown,
): type is GlobalVariableType {
  return (
    typeof type === "string" &&
    (GLOBAL_VARIABLE_TYPES as readonly string[]).includes(type)
  );
}

export interface GlobalVariable {
  id: string; // UUID
  name: string;
  key: string | null; // Stable slug used for resolution/imports
  type: GlobalVariableType;
  value: string | null; // Stored as text, cast based on type (same as collection values)
  data: CollectionFieldData; // Type-specific config (format, options)
  order: number;
  is_published: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface CreateGlobalVariableData {
  name: string;
  key?: string | null;
  type: GlobalVariableType;
  value?: string | null;
  data?: CollectionFieldData;
  order?: number;
}

export interface UpdateGlobalVariableData {
  name?: string;
  key?: string | null;
  type?: GlobalVariableType;
  value?: string | null;
  data?: CollectionFieldData;
  order?: number;
}

// Pagination Layer Definition (partial Layer for styling pagination controls)
export interface PaginationLayerConfig {
  classes?: string;
  design?: DesignProperties;
}

// Layer Variable Types
export interface CollectionPaginationConfig {
  enabled: boolean;
  mode: "pages" | "load_more";
  items_per_page: number;
  // Stylable pagination layer configurations
  wrapperLayer?: PaginationLayerConfig;
  prevButtonLayer?: PaginationLayerConfig;
  nextButtonLayer?: PaginationLayerConfig;
  pageInfoLayer?: PaginationLayerConfig;
}

export interface CollectionVariable {
  id: string; // Collection ID
  sort_by?: "none" | "manual" | "random" | string; // 'none', 'manual', 'random', or field ID
  sort_order?: "asc" | "desc"; // Only used when sort_by is a field ID
  sort_by_inputLayerId?: string; // Linked filter input controlling sort_by at runtime
  sort_order_inputLayerId?: string; // Linked filter input controlling sort_order at runtime
  limit?: number; // Maximum number of items to show (deprecated when pagination enabled)
  offset?: number; // Number of items to skip (deprecated when pagination enabled)
  source_field_id?: string; // Field ID from parent item (reference or multi-asset field), or field ID on child collection (inverse_reference)
  source_field_type?:
    | "reference"
    | "multi_reference"
    | "multi_asset"
    | "inverse_reference"; // Type of source field
  source_field_source?: "page" | "collection"; // Source of the field (page data or collection layer)
  filters?: ConditionalVisibility; // Filter conditions to apply to collection items
  pagination?: CollectionPaginationConfig; // Pagination settings for collection
}

// Runtime pagination metadata (attached to layer during SSR, not saved to database)
export interface CollectionPaginationMeta {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  itemsPerPage: number;
  layerId: string; // To identify which collection layer this belongs to
  collectionId: string; // Collection ID for fetching more pages
  mode?: "pages" | "load_more"; // Pagination mode
  itemIds?: string[]; // For multi-reference filtering in load_more mode
  layerTemplate?: Layer[]; // Layer template for rendering new items in load_more mode
  // Full collection layer (sans children) — used by load-more (and filter)
  // to rebuild proper item wrappers (link/action/attributes) when items are
  // re-rendered client-side.
  collectionLayer?: Omit<Layer, "children">;
  // Whether SSR rendered this collection from published data. The client
  // must fetch load-more items from the same source so draft previews
  // don't accidentally append published rows (or vice versa).
  isPublished?: boolean;
  // Sort applied by SSR — load-more must mirror it or offset-based
  // paging will return overlapping (duplicate) items.
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  // Optional cap from `collectionVariable.limit` when pagination is enabled.
  // Treated as a max total: clamps `totalItems` and stops `load_more` once
  // reached, even if the underlying collection has more matching rows.
  maxTotal?: number;
  // The collection's configured `offset` — number of leading records to skip
  // BEFORE paginating. `totalItems` already excludes these, and the client
  // (load_more) must forward it so continued paging stays past the offset.
  baseOffset?: number;
}

// ─── Shared primitives ──────────────────────────────────────────────────────

export type UIState =
  | "neutral"
  | "hover"
  | "focus"
  | "active"
  | "disabled"
  | "current";
export type Breakpoint = "mobile" | "tablet" | "desktop";
export type StringAssetId = string;

// ─── Design property interfaces ─────────────────────────────────────────────
// Structured, per-category CSS properties. Ported verbatim from Ycode — this
// is generic CSS-shape modeling with no CMS/tenancy coupling of any kind.

export interface LayoutDesign {
  isActive?: boolean;
  display?: string;
  flexDirection?: string;
  flexWrap?: string;
  justifyContent?: string;
  alignItems?: string;
  alignSelf?: string;
  gap?: string;
  columnGap?: string;
  rowGap?: string;
  gapMode?: "all" | "individual";
  gridTemplateColumns?: string;
  gridTemplateRows?: string;
}

export interface TypographyDesign {
  isActive?: boolean;
  fontSize?: string;
  fontWeight?: string;
  fontFamily?: string;
  fontStyle?: string;
  lineHeight?: string;
  letterSpacing?: string;
  textAlign?: string;
  textWrap?: string;
  fontVariantNumeric?: string;
  textTransform?: string;
  textDecoration?: string;
  lineClamp?: string;
  textDecorationColor?: string;
  textDecorationThickness?: string;
  underlineOffset?: string;
  verticalAlign?: string;
  color?: string;
  placeholderColor?: string;
  textShadow?: string;
}

export interface SpacingDesign {
  isActive?: boolean;
  margin?: string;
  marginTop?: string;
  marginRight?: string;
  marginBottom?: string;
  marginLeft?: string;
  marginMode?: "all" | "individual";
  padding?: string;
  paddingTop?: string;
  paddingRight?: string;
  paddingBottom?: string;
  paddingLeft?: string;
  paddingMode?: "all" | "individual";
}

export interface SizingDesign {
  isActive?: boolean;
  width?: string;
  height?: string;
  minWidth?: string;
  minHeight?: string;
  maxWidth?: string;
  maxHeight?: string;
  overflow?: string;
  aspectRatio?: string | null;
  objectFit?: string | null;
  objectPosition?: string | null;
  gridColumnSpan?: string | null;
  gridRowSpan?: string | null;
}

export interface BordersDesign {
  isActive?: boolean;
  borderWidth?: string;
  borderTopWidth?: string;
  borderRightWidth?: string;
  borderBottomWidth?: string;
  borderLeftWidth?: string;
  borderWidthMode?: "all" | "individual";
  borderStyle?: string;
  borderColor?: string;
  borderRadius?: string;
  borderTopLeftRadius?: string;
  borderTopRightRadius?: string;
  borderBottomLeftRadius?: string;
  borderBottomRightRadius?: string;
  borderRadiusMode?: "all" | "individual";
  divideX?: string;
  divideY?: string;
  divideStyle?: string;
  divideColor?: string;
  outlineWidth?: string;
  outlineColor?: string;
  outlineOffset?: string;
}

export interface BackgroundsDesign {
  isActive?: boolean;
  backgroundColor?: string;
  backgroundImage?: string;
  backgroundSize?: string;
  backgroundPosition?: string;
  backgroundRepeat?: string;
  backgroundClip?: string;
  /** CSS variable values for background image per breakpoint/state, e.g. { '--bg-img': 'url(...)' } */
  bgImageVars?: Record<string, string>;
  /** CSS variable values for background gradient per breakpoint/state, e.g. { '--bg-img': 'linear-gradient(...)' } */
  bgGradientVars?: Record<string, string>;
}

export interface EffectsDesign {
  isActive?: boolean;
  opacity?: string;
  boxShadow?: string;
  blur?: string;
  backdropBlur?: string;
  filter?: string;
  backdropFilter?: string;
  mixBlendMode?: string;
  cursor?: string;
}

export interface PositioningDesign {
  isActive?: boolean;
  position?: string;
  top?: string;
  right?: string;
  bottom?: string;
  left?: string;
  zIndex?: string;
}

export interface TransformsDesign {
  isActive?: boolean;
  scale?: string;
  rotate?: string;
  translateX?: string;
  translateY?: string;
  skewX?: string;
  skewY?: string;
  transformOrigin?: string;
}

export interface TransitionsDesign {
  isActive?: boolean;
  transitionProperty?: string;
  duration?: string;
  easing?: string;
  delay?: string;
}

export interface DesignProperties {
  layout?: LayoutDesign;
  typography?: TypographyDesign;
  spacing?: SpacingDesign;
  sizing?: SizingDesign;
  borders?: BordersDesign;
  backgrounds?: BackgroundsDesign;
  effects?: EffectsDesign;
  positioning?: PositioningDesign;
  transforms?: TransformsDesign;
  transitions?: TransitionsDesign;
}

// ─── Forms (lead capture — core funnel functionality, not CMS-bound) ───────

export type FormType = "standard" | "password_protected";

export type PasswordProtectionContext = {
  pageId?: string;
  redirectUrl: string;
  isPublished: boolean;
};

export interface FormSettings {
  form_type?: FormType;
  success_action?: "message" | "redirect";
  success_message?: string;
  error_message?: string;
  redirect_url?: LinkSettingsValue;
  email_notification?: {
    enabled: boolean;
    to: string;
    subject?: string;
  };
}

// ─── Links ──────────────────────────────────────────────────────────────────
// Pruned to statically-authored link targets. Dropped vs. Ycode: the
// 'asset' variant (no asset system yet) and the 'field' variant (CMS-bound
// href from a collection field).

export type LinkType = "url" | "email" | "phone" | "page";

export interface LinkSettings {
  type: LinkType;
  url?: DynamicTextVariable;
  email?: DynamicTextVariable;
  phone?: DynamicTextVariable;
  // Asset link - link to downloadable asset
  asset?: {
    id: StringAssetId | null;
  };

  // Page link - link to a page (static or dynamic)
  page?: {
    id: string; // Page ID (static or dynamic)
    collection_item_id?: string | null; // Collection item ID (for dynamic pages)
  };

  // Field link - href from collection field (CMS field containing URL)
  field?: FieldVariable;
  /** Reference to a layer ID within the target to scroll to (#anchor). */
  anchor_layer_id?: string | null;
  target?: "_blank" | "_self" | "_parent" | "_top";
  download?: boolean;
  rel?: string;
}

export type LinkSettingsValue = LinkSettings;

export type SwiperAnimationEffect =
  | "slide"
  | "fade"
  | "cube"
  | "flip"
  | "coverflow"
  | "cards";
export type SliderLoopMode = "none" | "loop" | "rewind";
export type SliderPaginationType = "bullets" | "fraction";
export type LightboxOverlay = "light" | "dark";
export type LightboxFilesSource = "files" | "cms";

export interface LightboxSettings {
  files: string[]; // Asset IDs or external URLs (used when filesSource is 'files')
  filesSource: LightboxFilesSource; // Whether files come from manual selection or a CMS field
  filesField?: FieldVariable | null; // CMS field binding for dynamic images (used when filesSource is 'cms')
  thumbnails: boolean;
  navigation: boolean;
  pagination: boolean;
  zoom: boolean; // Pinch-to-zoom on touch devices
  doubleTapZoom: boolean; // Double-tap/click to zoom
  mousewheel: boolean; // Navigate slides with scroll wheel
  overlay: LightboxOverlay;
  groupId: string; // Links multiple lightboxes into one shared gallery
  animationEffect: SwiperAnimationEffect;
  easing: string;
  duration: string; // Transition duration in seconds
}

/**
 * A value that can either be a single number (applies to every breakpoint) or
 * an object of per-breakpoint overrides. Desktop is the base; tablet/mobile
 * fall back to larger breakpoints when unset (desktop-first).
 */
export type ResponsiveNumber = number | Partial<Record<Breakpoint, number>>;

// ─── Layer settings (element-specific configuration) ───────────────────────
// Pruned vs. Ycode: dropped `locale` (localization), `slider`/`lightbox`
// (deferred widget features), `map` (third-party integration), and the
// collection-bound select-options fields (`optionsSource`,
// `selectOptionsMode`, `sortByCollectionId`, `sortByFieldIds`,
// `isPlaceholder`).
export interface SliderSettings {
  navigation: boolean;
  groupSlide: ResponsiveNumber; // Slides visible per view (responsive)
  slidesPerGroup: ResponsiveNumber; // Slides advanced per navigation step (responsive)
  loop: SliderLoopMode;
  centered: boolean;
  touchEvents: boolean;
  slideToClicked: boolean;
  mousewheel: boolean;

  pagination: boolean;
  paginationType: SliderPaginationType;
  paginationClickable: boolean;
  autoplay: boolean;
  pauseOnHover: boolean;
  delay: string; // Autoplay delay in seconds
  animationEffect: SwiperAnimationEffect;
  easing: string;
  duration: string; // Transition duration in seconds
}

export interface LayerSettings {
  id?: string; // Custom HTML id attribute
  tag?: string; // HTML tag override (e.g., 'h1', 'h2')
  hidden?: boolean; // Element visibility in canvas
  customAttributes?: Record<string, string>;
  locale?: {
    format?: "locale" | "code"; // Display format for `localeSelector` layers (locale => 'English', code => 'EN')
  };
  htmlEmbed?: {
    code?: string;
  };
  slider?: SliderSettings; // Slider-specific settings (only for slider layers)
  lightbox?: LightboxSettings; // Lightbox-specific settings (only for lightbox layers)
  form?: FormSettings; // Only meaningful on form layers
  filterOnChange?: boolean; // For filter layers: trigger filtering on every input change (debounced)
  optionsSource?: {
    collectionId: string;
    defaultItemId?: string; // item ID to pre-select as default (select elements)
    defaultItemIds?: string[]; // item IDs to pre-check as defaults (checkbox groups)
    sortFieldId?: string; // field ID to sort options by (undefined = manual/insertion order)
    sortOrder?: "asc" | "desc"; // sort direction (defaults to 'asc')
  };
  selectOptionsMode?: "list" | "sort_by" | "sort_order"; // Builder source mode for select options
  sortByCollectionId?: string; // Collection to source sort-by field options from
  sortByFieldIds?: string[]; // Which field IDs are enabled as sort-by options
  isPlaceholder?: boolean; // Marks an <option> child as a placeholder (disabled, hidden, selected)
  map?: MapSettings; // Map-specific settings (only for map layers)
}

export type MapProvider = "mapbox" | "google";
export type MapStyle = "streets" | "satellite" | "light" | "dark" | "outdoors";
export type GoogleMapStyle = "roadmap" | "satellite";

export interface MapProviderSettings {
  style: string;
  interactive: boolean;
  scrollZoom: boolean;
  showNavControl: boolean;
  showScaleBar: boolean;
}

export interface MapSettings {
  provider: MapProvider;
  latitude: number;
  longitude: number;
  zoom: number;
  markerColor: string | null;
  search?: string;
  mapbox: MapProviderSettings;
  google: MapProviderSettings;
}
// ─── Layer styles (reusable combo-class chips) ─────────────────────────────
// Lean shape shared with design-system-schema.ts's `layerStyle` table.
// Versioning fields (`content_hash`, `is_published`, `deleted_at`) dropped —
// see file header. `group` renamed `styleGroup` to sidestep MySQL's
// reserved `GROUP` keyword as an identifier.

export interface LayerStyle {
  id: string;
  name: string;
  /** Element category (e.g. "text", "block", "button") for scoped filtering in the UI. */
  styleGroup?: string;
  /** Role within a combo-class stack: base style, combo addition, or a synced global. */
  kind?: "base" | "combo" | "global";
  classes: string;
  design?: DesignProperties;
}

export interface TextStyle {
  label?: string;
  classes?: string;
  design?: DesignProperties;
  styleId?: string;
  styleOverrides?: { classes?: string; design?: DesignProperties };
}

// ─── Interactions / animations (GSAP-driven, self-contained) ───────────────

export interface LayerInteraction {
  id: string;
  trigger: "click" | "hover" | "scroll-into-view" | "while-scrolling" | "load";
  timeline: InteractionTimeline;
  tweens: InteractionTween[];
}

export interface InteractionTimeline {
  breakpoints: Breakpoint[];
  repeat: number; // -1 = infinite, 0 = none, n = repeat n times
  yoyo: boolean;
  scrollStart?: string; // e.g. 'top 80%'
  scrollEnd?: string; // e.g. 'bottom top' (while-scrolling only)
  scrub?: boolean | number;
  toggleActions?: string; // scroll-into-view: GSAP toggleActions
}

export type TweenPropertyKey =
  | "x"
  | "y"
  | "rotation"
  | "scale"
  | "skewX"
  | "skewY"
  | "autoAlpha"
  | "display"
  | "width"
  | "height"
  | "backgroundColor"
  | "filterBlur"
  | "filterBrightness"
  | "filterGrayscale";

export type ApplyStyles = "on-load" | "on-trigger";
export type InteractionApplyStyles = Partial<
  Record<TweenPropertyKey, ApplyStyles>
>;
export type TweenProperties = { [K in TweenPropertyKey]?: string | null };

export interface InteractionTween {
  id: string;
  layer_id: string;
  position: number | string; // GSAP position: number (seconds), ">" (after previous), "<" (with previous)
  duration: number;
  ease: string; // GSAP ease, e.g. 'power1.out'
  from: TweenProperties;
  to: TweenProperties;
  apply_styles: InteractionApplyStyles;
  splitText?: {
    type: "chars" | "words" | "lines";
    stagger: { amount: number };
  };
}

// ─── Component overrides ────────────────────────────────────────────────────
// Narrowed value union — see file header for rationale on the deferred
// rich_text/audio/video/icon kinds.

export interface ImageSettingsValue {
  src?: string;
  alt?: string;
  width?: string;
  height?: string;
  loading?: "lazy" | "eager";
}

export interface AudioSettingsValue {
  src?: AssetVariable | DynamicTextVariable | FieldVariable;
  controls?: boolean;
  loop?: boolean;
  muted?: boolean;
  volume?: number;
}

export interface VideoSettingsValue {
  src?: AssetVariable | VideoVariable | FieldVariable | DynamicTextVariable;
  poster?: AssetVariable | FieldVariable;
  controls?: boolean;
  loop?: boolean;
  muted?: boolean;
  autoplay?: boolean;
  youtubePrivacyMode?: boolean;
}

export interface IconSettingsValue {
  src?: AssetVariable | StaticTextVariable;
}

export interface VariantSettingsValue {
  variant_id: string;
}

// Component variable value type (text, image, link, audio, video, icon, and variant variables)
export type ComponentVariableValue =
  | DynamicTextVariable
  | DynamicRichTextVariable
  | ImageSettingsValue
  | LinkSettingsValue
  | AudioSettingsValue
  | VideoSettingsValue
  | IconSettingsValue
  | VariantSettingsValue;

export interface ComponentVariable {
  id: string;
  name: string;
  /** Full kind list kept for forward-compatibility; only text/image/link/variant have a modeled value today — see file header. */
  type?:
    | "text"
    | "rich_text"
    | "image"
    | "link"
    | "audio"
    | "video"
    | "icon"
    | "variant";
  placeholder?: string;
  default_value?: ComponentVariableValue;
}

/** A named layer-tree variant of a component (e.g. "Default", "Small", "Large"). All variants share the component's `variables`. */
export interface ComponentVariant {
  id: string;
  name: string;
  layers: Layer[];
}

export interface Component {
  id: string;
  name: string;
  /** Mirrors `variants[0].layers` for convenience; `variants` is the source of truth once present. */
  layers: Layer[];
  variants?: ComponentVariant[];
  variables?: ComponentVariable[];
  thumbnailUrl?: string | null;
}

// ─── Layer (the recursive tree node) ────────────────────────────────────────

export interface Layer {
  id: string;
  key?: string; // Optional internal/stable id for special layers (e.g. form success alert)
  name: string; // Element type name: 'div', 'section', 'text', etc.
  customName?: string; // User-defined name for display in the layers tree

  restrictions?: {
    copy?: boolean;
    delete?: boolean;
    ancestor?: string; // The ancestor `layer.name` this layer must be a child of
    editText?: boolean;
  };

  classes?: string | string[]; // Tailwind classes

  /**
   * ADDED (Phase 5, correcting a Phase 1 gap): plain, static, author-typed
   * text content for text-bearing layers (text/heading/span/label; also
   * used as a plain-text fallback for richText until real rich-text
   * editing lands). Phase 1 excluded `Layer.variables` entirely as
   * CMS-bound — correct for the actual CMS/collection-binding parts of
   * it, but that also silently removed the ONLY place Ycode stores
   * static text (`variables.text` with a static/dynamic discriminant).
   * This field is the narrow, non-CMS-bound replacement: no variable
   * system, no CMS binding, just a string. A future CMS pass can add a
   * separate binding field alongside this one without touching it.
   */
  content?: string;

  textStyles?: Record<string, TextStyle>;

  children?: Layer[];

  open?: boolean; // Expanded/collapsed state in the layers tree
  hidden?: boolean;
  hiddenGenerated?: boolean; // Hidden by default, shown via form success/error actions
  alertType?: "success" | "error";

  attributes?: Record<string, unknown> & {
    id?: string;
    // Media element attributes (video/audio) — generic HTML5, no CMS coupling
    muted?: boolean;
    controls?: boolean;
    loop?: boolean;
    autoplay?: boolean;
    volume?: string;
    preload?: string;
    youtubePrivacyMode?: boolean;
  };

  design?: DesignProperties;
  settings?: LayerSettings;

  // Applied LayerStyle stack, low to high priority (base first, combos after).
  styleIds?: string[];
  styleOverrides?: {
    classes?: string;
    design?: DesignProperties;
  };
  /** Per-style local overrides, keyed by the LayerStyle id in the stack — replaces that style's classes for this layer only. */
  styleOverridesByStyle?: Record<
    string,
    { classes?: string; design?: DesignProperties }
  >;

  // Component instance
  componentId?: string;
  componentVariantId?: string;
  /** When set, this nested instance's variant is driven by the parent component's variable (by id), resolved at expansion time. */
  componentVariantVariableId?: string;
  componentOverrides?: {
    text?: Record<string, ComponentVariableValue>; // ComponentVariable.id → override value (text)
    rich_text?: Record<string, ComponentVariableValue>; // ComponentVariable.id → override value (rich text)
    image?: Record<string, ComponentVariableValue>; // ComponentVariable.id → override value (image)
    link?: Record<string, ComponentVariableValue>; // ComponentVariable.id → override value (link)
    audio?: Record<string, ComponentVariableValue>; // ComponentVariable.id → override value (audio)
    video?: Record<string, ComponentVariableValue>; // ComponentVariable.id → override value (video)
    icon?: Record<string, ComponentVariableValue>; // ComponentVariable.id → override value (icon)
    variant?: Record<string, ComponentVariableValue>; // ComponentVariable.id → override value (variant)
    variableLinks?: Record<string, string>; // childVariableId → parentVariableId (pass-through from nested component to parent)
  };
  // Layer variables (layer collection data & dynamic data for texts, assets, links)
  variables?: LayerVariables;

  interactions?: LayerInteraction[];
}

export interface LayerVariables {
  // Collection data
  collection?: CollectionVariable;
  conditionalVisibility?: ConditionalVisibility;

  // Variables by type
  text?: DynamicTextVariable | DynamicRichTextVariable;
  icon?: {
    src?: AssetVariable | StaticTextVariable; // Static Asset ID | Static Text (SVG code, internal use only)
  };
  image?: {
    src: AssetVariable | FieldVariable | DynamicTextVariable; // Static Asset ID | Field Variable | Dynamic Text (URL that allows inline variables)
    alt: DynamicTextVariable; // Image alt text with inline variables
  };
  audio?: {
    src: AssetVariable | FieldVariable | DynamicTextVariable; // Static Asset ID | Field Variable | Dynamic Text (URL that allows inline variables)
  };
  video?: {
    src?: AssetVariable | VideoVariable | FieldVariable | DynamicTextVariable; // Static Asset ID | Video provider + ID (YouTube) | Field Variable | Dynamic Text (URL that allows inline variables)
    poster?: AssetVariable | FieldVariable; // Poster image (asset or field variable)
  };
  iframe?: {
    src: DynamicTextVariable; // Embed URL (allow inline variables)
  };
  backgroundImage?: {
    src: AssetVariable | FieldVariable | DynamicTextVariable; // Static Asset ID | Field Variable | Dynamic Text (URL)
  };
  link?: LinkSettings;

  // Design property bindings (CMS color fields)
  design?: {
    backgroundColor?: DesignColorVariable;
    color?: DesignColorVariable; // text color
    borderColor?: DesignColorVariable;
    divideColor?: DesignColorVariable;
    outlineColor?: DesignColorVariable;
    textDecorationColor?: DesignColorVariable;
    placeholderColor?: DesignColorVariable;
  };
}

export interface LayerUpdate {
  layer_id: string;
  user_id: string;
  changes: Partial<Layer>;
  timestamp: number;
}

/** A gradient stop with optional CMS field binding */
export interface BoundColorStop {
  id: string;
  position: number;
  color: string; // static fallback color
  field?: FieldVariable; // optional CMS binding for this stop
}

export interface DesignColorVariable {
  type: "color";
  mode: "solid" | "linear" | "radial";
  /** Solid mode: the CMS field binding */
  field?: FieldVariable;
  /** Linear gradient state (preserved across tab switches) */
  linear?: { angle?: number; stops?: BoundColorStop[] };
  /** Radial gradient state (preserved across tab switches) */
  radial?: { stops?: BoundColorStop[] };
}

/** A layer without a required `id` (children may also omit ids), for reusable templates. */
export interface LayerTemplate extends Omit<Layer, "id" | "children"> {
  id?: string;
  children?: LayerTemplate[];
}

// Template reference marker (lazy reference resolved during template instantiation)
export type LayerTemplateRef = { __ref: string } & Partial<
  Omit<LayerTemplate, "children">
> & {
    children?: Array<LayerTemplate | LayerTemplateRef>;
  };

// Block template definition (used in template collections)
export interface BlockTemplate {
  icon: string;
  name: string;
  template: LayerTemplate | LayerTemplateRef;
}

// Pagination Layer Definition (partial Layer for styling pagination controls)
export interface PaginationLayerConfig {
  classes?: string;
  design?: DesignProperties;
}

// Layer Variable Types
export interface CollectionPaginationConfig {
  enabled: boolean;
  mode: "pages" | "load_more";
  items_per_page: number;
  // Stylable pagination layer configurations
  wrapperLayer?: PaginationLayerConfig;
  prevButtonLayer?: PaginationLayerConfig;
  nextButtonLayer?: PaginationLayerConfig;
  pageInfoLayer?: PaginationLayerConfig;
}

export interface CollectionVariable {
  id: string; // Collection ID
  sort_by?: "none" | "manual" | "random" | string; // 'none', 'manual', 'random', or field ID
  sort_order?: "asc" | "desc"; // Only used when sort_by is a field ID
  sort_by_inputLayerId?: string; // Linked filter input controlling sort_by at runtime
  sort_order_inputLayerId?: string; // Linked filter input controlling sort_order at runtime
  limit?: number; // Maximum number of items to show (deprecated when pagination enabled)
  offset?: number; // Number of items to skip (deprecated when pagination enabled)
  source_field_id?: string; // Field ID from parent item (reference or multi-asset field), or field ID on child collection (inverse_reference)
  source_field_type?:
    | "reference"
    | "multi_reference"
    | "multi_asset"
    | "inverse_reference"; // Type of source field
  source_field_source?: "page" | "collection"; // Source of the field (page data or collection layer)
  filters?: ConditionalVisibility; // Filter conditions to apply to collection items
  pagination?: CollectionPaginationConfig; // Pagination settings for collection
}

export interface VisibilityCondition {
  id: string;
  source: "collection_field" | "page_collection" | "self";
  // For collection_field source
  fieldId?: string;
  fieldType?: CollectionFieldType;
  referenceCollectionId?: string; // For reference fields - the collection to fetch items from
  operator: VisibilityOperator;
  value?: string; // For is_one_of/is_not_one_of: JSON array of item IDs
  value2?: string; // For 'is_between' date operator
  // For page_collection source
  collectionLayerId?: string;
  collectionLayerName?: string; // Display name for the layer
  compareOperator?: "eq" | "lt" | "lte" | "gt" | "gte"; // For 'item_count' operator
  compareValue?: number; // For 'item_count' operator
  // For self source: when true, the current dynamic page item ID is injected
  // into the comparison set alongside any statically picked IDs in `value`.
  includesCurrentPageItem?: boolean;
  // How the compare value is sourced. Defaults to 'static' (uses `value`).
  // 'current_page' binds the compare value to the current dynamic page item:
  //   - reference/multi_reference fields compare against the page item's own ID
  //     (the "Current Category/Tag" pattern)
  //   - scalar fields compare against the value of `currentPageFieldId` on the
  //     current page item
  valueMode?: "static" | "current_page";
  // For scalar fields with valueMode 'current_page': the field on the current
  // dynamic page item whose value is used as the compare value.
  currentPageFieldId?: string;
  // For linking filter value to an input layer inside a Filter
  inputLayerId?: string;
  inputLayerId2?: string; // For second bound (e.g. 'is_between')
  // Date fields only: marks the value as sourced from a filter form input
  // (vs. a preset or custom date). Persisted so the UI stays in input mode
  // even before an input is linked. Absent on conditions created before this
  // existed — those fall back to linked-state/custom inference.
  dateInput?: boolean;
  // Same as `dateInput`, but for the second bound (`is_between`).
  dateInput2?: boolean;
}

export interface VisibilityConditionGroup {
  id: string;
  conditions: VisibilityCondition[];
}

export interface ConditionalVisibility {
  groups: VisibilityConditionGroup[];
}

/**
 * A single condition in a serialized dynamic-date visibility rule (static export).
 * Date-preset conditions are re-evaluated against the current date on the client;
 * all other conditions carry their export-time result, baked in.
 */
export type DynamicVisibilityCondition =
  | {
      dynamic: true;
      operator: VisibilityOperator;
      value: string;
      fieldValue: string;
      dateOnly?: boolean;
    }
  | { dynamic: false; result: boolean };

// Color Variables
export interface ColorVariable {
  id: string;
  name: string;
  value: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface VariableType {
  id?: string; // Reference to ComponentVariable.id (for component variable linking)
  type:
    | "field"
    | "asset"
    | "video"
    | "dynamic_rich_text"
    | "dynamic_text"
    | "static_text"
    | "pagination";
  data: object;
}

// CMS Field Variable, used for CMS data binding and inline variables
export interface FieldVariable extends VariableType {
  type: "field";
  data: {
    field_id: string | null;
    field_type: CollectionFieldType | null;
    relationships: string[];
    format?: string;
    /**
     * Source of the field data: 'page' for page collection, 'collection' for
     * collection layer, 'global' for a site-wide global variable.
     */
    source?: "page" | "collection" | "global";
    /** ID of the collection layer this field belongs to (for nested collections) */
    collection_layer_id?: string;
    /**
     * ID of the global variable this binding points to (only when source is
     * 'global'). When set, field_id mirrors this value so the existing
     * resolution helpers can key on it uniformly.
     */
    global_id?: string;
    /** Pre-resolved raw value from injectCollectionData (survives stripSSROnlyData) */
    _resolvedValue?: string;
  };
}

// Asset ID Variable, used for image, audio, video, etc.
export interface AssetVariable extends VariableType {
  type: "asset";
  data: {
    asset_id: StringAssetId | null;
  };
}

// Asset ID Variable, used for image, audio, video, etc.
export interface VideoVariable extends VariableType {
  type: "video";
  data: {
    provider: "youtube"; // | 'vimeo'
    video_id: string;
  };
}

// Dynamic Text Variable, contains text with inline variables (without formatting)
export interface DynamicTextVariable extends VariableType {
  type: "dynamic_text";
  data: {
    content: string; // String with inline variables (no HTML)
  };
}

// Dynamic Rich Text Variable, contains rich text with formatting (bold, italic, etc.) + inline variables
export interface DynamicRichTextVariable extends VariableType {
  type: "dynamic_rich_text";
  data: {
    content: object; // Tiptap JSON content with inline variables and formatting (bold, italic, etc.)
  };
}

// Static Text Variable, contains text without formatting and without inline variables
export interface StaticTextVariable extends VariableType {
  type: "static_text";
  data: {
    content: string; // String without inline variables (no HTML)
  };
}

// Pagination Variable, an inline variable that resolves to a live pagination
// number (items shown/total, current/total pages) at render time. Lets the
// pagination count/info texts ("Showing 6 of 20", "Page 1 of 3") be edited and
// translated while keeping the numbers dynamic.
export interface PaginationVariable extends VariableType {
  type: "pagination";
  data: {
    key: "shown" | "total" | "current" | "pages";
  };
}

export type InlineVariable = FieldVariable | PaginationVariable;

/** Live pagination numbers used to resolve `pagination` inline variables. */
export interface PaginationNumbers {
  shown: number;
  total: number;
  current: number;
  pages: number;
}

// Image settings value for component variables
export type TextOperator =
  | "is"
  | "is_not"
  | "contains"
  | "does_not_contain"
  | "is_present"
  | "is_empty";
export type NumberOperator = "is" | "is_not" | "lt" | "lte" | "gt" | "gte";
export type DateOperator =
  | "is"
  | "is_before"
  | "is_after"
  | "is_between"
  | "is_empty"
  | "is_not_empty";
export type BooleanOperator = "is";
export type ReferenceOperator =
  | "is_one_of"
  | "is_not_one_of"
  | "exists"
  | "does_not_exist";
export type MultiReferenceOperator =
  | "is_one_of"
  | "is_not_one_of"
  | "contains_all_of"
  | "contains_exactly"
  | "item_count"
  | "has_items"
  | "has_no_items";
export type PageCollectionOperator =
  | "item_count"
  | "has_items"
  | "has_no_items";
// Self filter: compare the item's own ID against a set of IDs (statically picked
// and/or the current dynamic page item). Mirrors reference field semantics.
export type SelfOperator = "is_one_of" | "is_not_one_of";

export type VisibilityOperator =
  | TextOperator
  | NumberOperator
  | DateOperator
  | BooleanOperator
  | ReferenceOperator
  | MultiReferenceOperator
  | PageCollectionOperator
  | SelfOperator;

export type PageType = "landing_page" | "normal_page" | "result_page";

export interface Page {
  id: string;
  slug: string;
  name: string;
  funnelId: string; // Reference to page_folders
  order: number; // Sort order
  depth: number; // Depth in hierarchy
  pageType: PageType; // Index of the root or parent folder
  is_dynamic: boolean; // Dynamic page (CMS-driven)
  layers: Layer;
  settings: PageSettings; // Page settings (CMS, auth, seo, custom code)
  content_hash?: string; // SHA-256 hash of page metadata for change detection
  is_published: boolean;
  is_publishable: boolean; // Whether the page goes live on publish (false = draft)
  has_published_version?: boolean; // Computed (builder listing only): a live row exists
  is_modified?: boolean; // Computed (builder listing only): draft differs from live
  created_at: string;
  updated_at: string;
  deleted_at: string | null; // Soft delete timestamp
}

export interface PageSettings {
  // cms?: {
  //   collection_id: string;
  //   slug_field_id: string;
  //   /**
  //    * Controls the order in which `next-item` / `previous-item` link keywords
  //    * traverse this dynamic page's collection. When omitted, items are sorted
  //    * by their `manual_order` ascending — the same default used elsewhere in
  //    * the system.
  //    */
  //   next_previous?: {
  //     sort_by?: "manual" | string; // 'manual' or a collection field id
  //     sort_order?: "asc" | "desc";
  //   };
  // };
  // auth?: {
  //   enabled: boolean;
  //   password: string;
  // };
  seo?: {
    image: StringAssetId | FieldVariable | null; // Asset ID or Field Variable (image field)
    title: string;
    description: string;
    noindex: boolean; // Prevent search engines from indexing the page
  };
  custom_code?: {
    head: string;
    body: string;
  };
}

/**
 * Locale option (predefined locale configuration)
 */
export interface LocaleOption {
  code: string; // Language code (ISO 639-1)
  label: string; // English label
  native_label: string; // Native language label
  rtl?: boolean; // Right-to-left language
}

/**
 * Locale (database entity)
 */
export interface Locale {
  id: string;
  code: string;
  label: string;
  is_default: boolean;
  is_published: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface CreateLocaleData {
  code: string;
  label: string;
  is_default?: boolean;
}

export interface UpdateLocaleData {
  code?: string;
  label?: string;
  is_default?: boolean;
}

// Asset Types
/**
 * Asset categories for validation
 */
export type AssetCategory =
  | "images"
  | "videos"
  | "audio"
  | "documents"
  | "icons";

/**
 * Category filter for file manager - supports single, multiple, or all categories
 */
export type AssetCategoryFilter =
  | AssetCategory
  | AssetCategory[]
  | "all"
  | null;

/**
 * Asset - Represents any uploaded file (images, videos, documents, etc.)
 *
 * The asset system is designed to handle any file type, not just images.
 * - Images will have width/height dimensions
 * - Non-images will have null width/height
 * - Use mime_type to determine asset type (e.g., image/, video/, application/pdf)
 */
export interface Asset {
  id: string;
  filename: string;
  storage_path: string | null; // Nullable for SVG icons with inline content
  public_url: string | null; // Nullable for SVG icons with inline content
  file_size: number;
  mime_type: string;
  width?: number | null;
  height?: number | null;
  source: string; // Required: identifies where the asset was uploaded from
  asset_folder_id?: string | null;
  content?: string | null; // Inline SVG content for icon assets
  content_hash?: string | null; // SHA-256 hash for change detection during publishing
  is_published: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface AssetFolder {
  id: string;
  asset_folder_id: string | null;
  name: string;
  depth: number;
  order: number;
  is_published: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export type TranslationSourceType = "page" | "folder" | "component" | "cms";
export type TranslationContentType = "text" | "richtext" | "asset_id";

export interface Translation {
  id: string;
  locale_id: string;
  source_type: TranslationSourceType;
  source_id: string;
  content_key: string;
  content_type: TranslationContentType;
  content_value: string;
  is_completed: boolean;
  is_published: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}
