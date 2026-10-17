// path: src/lib/editor/element-catalog.ts

/**
 * Element Library "Elements" tab: category → template keys.
 *
 * Every key MUST resolve in the block registry (`lib/templates/blocks`),
 * because insertion (`addLayerFromTemplate` → `buildLayerFromTemplate`) resolves
 * templates from there. The regression test in
 * `tests/editor-insertion/insertion.test.ts` enforces this.
 */
export const elementCategories: Record<string, string[]> = {
  Structure: [
    "section",
    "container",
    "div",
    "hr",
    "columns",
    "rows",
    "grid",
    "collection",
  ],
  Content: ["heading", "text", "richText"],
  Actions: ["button"],
  Media: ["image", "icon", "video", "audio"],
  Form: [
    "form",
    "filter",
    "input",
    "textarea",
    "select",
    "checkbox",
    "radio",
    "label",
  ],
  Table: ["table", "thead", "tbody", "tr", "th", "td"],
  Utilities: ["map", "slider", "lightbox", "localeSelector", "htmlEmbed"],
};
