import { Node, mergeAttributes } from '@tiptap/core';

/**
 * Shared Tiptap node for inline dynamic variable badges.
 * Stores variable data in data-variable attribute as JSON-encoded string.
 *
 * Each editor (RichTextEditor, CanvasTextEditor) extends this with its own
 * addNodeView() for styling differences.
 */
export const DynamicVariable = Node.create({
  name: 'dynamicVariable',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      variable: {
        default: null,
        parseHTML: (element) => {
          const variableAttr = element.getAttribute('data-variable');
          if (variableAttr) {
            try {
              return JSON.parse(variableAttr);
            } catch {
              return null;
            }
          }
          return null;
        },
        renderHTML: (attributes) => {
          if (!attributes) return {};
          return { 'data-variable': JSON.stringify(attributes) };
        },
      },
      label: {
        default: null,
        parseHTML: (element) => element.textContent || null,
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-variable]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const label = node.attrs.label ||
      node.attrs.variable?.data?.field_id ||
      node.attrs.variable?.type || 'variable';

    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        class: 'inline-flex items-center justify-center gap-1 rounded-sm border px-1.5 py-0 text-[10px] font-medium whitespace-nowrap shrink-0 border-transparent bg-secondary text-secondary-foreground/70 mx-0.5',
        'data-variable': node.attrs.variable ? JSON.stringify(node.attrs.variable) : undefined,
      }),
      ['span', {}, label],
    ];
  },
});

/**
 * Helper to extract label from a DynamicVariable node's attrs
 */
export function getDynamicVariableLabel(node: { attrs: Record<string, any> }): string {
  const variable = node.attrs.variable;
  return node.attrs.label ||
    variable?.data?.field_id ||
    variable?.type || 'variable';
}
