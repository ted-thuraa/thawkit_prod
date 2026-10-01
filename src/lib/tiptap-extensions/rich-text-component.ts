import { Node, mergeAttributes } from "@tiptap/core";
import type { Layer, CollectionField, Collection } from "@/types/funnel";
import type { FieldGroup } from "@/lib/collection-field-utils";

export type RichTextComponentOverrides = Layer["componentOverrides"];

/** Context data stored in editor.storage.richTextComponent for node views. */
export interface RichTextComponentEditorContext {
  fieldGroups?: FieldGroup[];
  allFields?: Record<string, CollectionField[]>;
  collections?: Collection[];
  isInsideCollectionLayer?: boolean;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    richTextComponent: {
      /** Insert a component block into the editor */
      insertComponent: (attrs: { componentId: string }) => ReturnType;
      /** Update overrides on the currently selected component node */
      updateComponentOverrides: (
        overrides: RichTextComponentOverrides,
      ) => ReturnType;
    };
  }
}

/**
 * Block-level Tiptap node for embedding components in rich-text content.
 * Stores componentId and componentOverrides as data attributes.
 * Node view rendering is handled by the consuming editor via extend().
 */
export const RichTextComponent = Node.create({
  name: "richTextComponent",
  group: "block",
  atom: true,
  draggable: false,

  addStorage() {
    return {
      editorContext: {} as RichTextComponentEditorContext,
      /** Move cursor after the component node, creating a paragraph if needed. */
      handleArrowAfter(editor: any, typeName: string): boolean {
        const { selection } = editor.state;
        const node = editor.state.doc.nodeAt(selection.from);
        if (node?.type.name !== typeName) return false;

        const pos = selection.from + node.nodeSize;
        const after = editor.state.doc.nodeAt(pos);

        if (!after) {
          editor
            .chain()
            .insertContentAt(pos, { type: "paragraph" })
            .setTextSelection(pos + 1)
            .run();
          return true;
        }
        return false;
      },
      /** Move cursor before the component node, creating a paragraph if needed. */
      handleArrowBefore(editor: any, typeName: string): boolean {
        const { selection } = editor.state;
        const node = editor.state.doc.nodeAt(selection.from);
        if (node?.type.name !== typeName) return false;

        const pos = selection.from;
        const $pos = editor.state.doc.resolve(pos);

        if ($pos.index() === 0) {
          editor.chain().insertContentAt(pos, { type: "paragraph" }).run();
          return true;
        }
        return false;
      },
    };
  },

  addAttributes() {
    return {
      componentId: {
        default: null,
        parseHTML: (element) =>
          element.getAttribute("data-component-id") || null,
        renderHTML: (attributes) => {
          if (!attributes.componentId) return {};
          return { "data-component-id": attributes.componentId };
        },
      },
      componentOverrides: {
        default: null,
        parseHTML: (element) => {
          const attr = element.getAttribute("data-component-overrides");
          if (!attr) return null;
          try {
            return JSON.parse(attr);
          } catch {
            return null;
          }
        },
        renderHTML: (attributes) => {
          if (!attributes.componentOverrides) return {};
          return {
            "data-component-overrides": JSON.stringify(
              attributes.componentOverrides,
            ),
          };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-component-id]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        class: "rich-text-component-block",
        "data-type": "richTextComponent",
      }),
      "Component",
    ];
  },

  addCommands() {
    return {
      insertComponent:
        (attrs) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: {
              componentId: attrs.componentId,
              componentOverrides: null,
            },
          });
        },

      updateComponentOverrides:
        (overrides) =>
        ({ tr, state, dispatch }) => {
          const { selection } = state;
          const node = state.doc.nodeAt(selection.from);

          if (!node || node.type.name !== this.name) {
            return false;
          }

          if (dispatch) {
            tr.setNodeMarkup(selection.from, undefined, {
              ...node.attrs,
              componentOverrides: overrides,
            });
          }

          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { selection } = editor.state;
        const node = editor.state.doc.nodeAt(selection.from);
        if (node?.type.name !== this.name) return false;

        const pos = selection.from + node.nodeSize;
        const after = editor.state.doc.nodeAt(pos);

        if (!after) {
          editor
            .chain()
            .insertContentAt(pos, { type: "paragraph" })
            .setTextSelection(pos + 1)
            .run();
        } else {
          editor
            .chain()
            .setTextSelection(pos + 1)
            .run();
        }
        return true;
      },

      ArrowDown: ({ editor }) =>
        this.storage.handleArrowAfter(editor, this.name),
      ArrowRight: ({ editor }) =>
        this.storage.handleArrowAfter(editor, this.name),
      ArrowUp: ({ editor }) =>
        this.storage.handleArrowBefore(editor, this.name),
      ArrowLeft: ({ editor }) =>
        this.storage.handleArrowBefore(editor, this.name),
    };
  },
});
