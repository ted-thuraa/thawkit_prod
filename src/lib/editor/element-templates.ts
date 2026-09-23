import type { Layer } from "@/types/funnel";

export type EditorElementType =
  | "section"
  | "div"
  | "heading"
  | "text"
  | "button"
  | "link"
  | "image"
  | "video"
  | "form"
  | "input"
  | "textarea"
  | "select"
  | "checkbox"
  | "hr";

export interface ElementTemplateDefinition {
  type: EditorElementType;
  label: string;
  description: string;
  create: () => Omit<Layer, "id">;
}

const definitions: ElementTemplateDefinition[] = [
  {
    type: "section",
    label: "Section",
    description: "A top-level page section",
    create: () => ({
      name: "section",
      classes: "w-full py-12 px-6",
      children: [],
    }),
  },
  {
    type: "div",
    label: "Block",
    description: "A generic layout container",
    create: () => ({ name: "div", classes: "p-4", children: [] }),
  },
  {
    type: "heading",
    label: "Heading",
    description: "A heading with editable text",
    create: () => ({
      name: "heading",
      classes: "text-3xl font-bold",
      content: "Heading",
      children: [],
    }),
  },
  {
    type: "text",
    label: "Text",
    description: "A paragraph of text",
    create: () => ({
      name: "text",
      classes: "text-base",
      content: "Edit this text",
      children: [],
    }),
  },
  {
    type: "button",
    label: "Button",
    description: "A call-to-action button",
    create: () => ({
      name: "button",
      classes:
        "inline-flex items-center rounded-md bg-primary px-4 py-2 text-primary-foreground",
      content: "Button",
      children: [],
    }),
  },
  {
    type: "link",
    label: "Link",
    description: "A text link",
    create: () => ({
      name: "link",
      classes: "text-primary underline",
      content: "Link",
      settings: { tag: "a" },
      children: [],
    }),
  },
  {
    type: "image",
    label: "Image",
    description: "An image placeholder",
    create: () => ({
      name: "image",
      classes: "block max-w-full",
      attributes: { alt: "Image" },
      children: [],
    }),
  },
  {
    type: "video",
    label: "Video",
    description: "A video element",
    create: () => ({
      name: "video",
      classes: "w-full",
      attributes: { controls: true },
      children: [],
    }),
  },
  {
    type: "form",
    label: "Form",
    description: "A form container",
    create: () => ({
      name: "form",
      classes: "flex flex-col gap-4",
      children: [],
    }),
  },
  {
    type: "input",
    label: "Input",
    description: "A text input field",
    create: () => ({
      name: "input",
      classes: "w-full rounded-md border px-3 py-2",
      attributes: { type: "text", placeholder: "Enter text" },
      children: [],
    }),
  },
  {
    type: "textarea",
    label: "Textarea",
    description: "A multi-line input field",
    create: () => ({
      name: "textarea",
      classes: "min-h-24 w-full rounded-md border px-3 py-2",
      attributes: { placeholder: "Enter text" },
      children: [],
    }),
  },
  {
    type: "select",
    label: "Select",
    description: "A select field",
    create: () => ({
      name: "select",
      classes: "w-full rounded-md border px-3 py-2",
      children: [],
    }),
  },
  {
    type: "checkbox",
    label: "Checkbox",
    description: "A checkbox control",
    create: () => ({
      name: "checkbox",
      classes: "size-4",
      attributes: { type: "checkbox" },
      children: [],
    }),
  },
  {
    type: "hr",
    label: "Divider",
    description: "A horizontal divider",
    create: () => ({ name: "hr", classes: "my-4 border-border", children: [] }),
  },
];

export function getElementTemplateDefinitions(): ElementTemplateDefinition[] {
  return definitions;
}

export function createElementFromTemplate(
  type: EditorElementType,
): Omit<Layer, "id"> | null {
  return (
    definitions.find((definition) => definition.type === type)?.create() ?? null
  );
}
