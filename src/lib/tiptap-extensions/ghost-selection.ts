/**
 * Ghost Selection
 *
 * Keeps a highlighted range visibly "selected" while the editor does not have
 * focus.
 *
 * The inline text editor lives inside the canvas iframe, but its formatting
 * toolbar and popovers (colour picker, link editor, size menu) live in the
 * parent document. Moving focus to one of them makes the browser grey out or
 * drop the native selection highlight in the iframe, even though ProseMirror
 * still holds the selection. Painting the range with an inline decoration
 * while blurred keeps it obvious what the toolbar is about to format.
 *
 * The decoration only exists while `!focused`; while focused the native
 * selection is shown as usual. It is purely visual: it never enters the
 * document or the serialised content.
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

interface GhostSelectionState {
  focused: boolean;
}

const ghostSelectionKey = new PluginKey<GhostSelectionState>("ghostSelection");

const GHOST_STYLE =
  "background-color: rgba(59, 130, 246, 0.35); border-radius: 2px;";

function setFocused(view: EditorView, focused: boolean) {
  // Blur can fire while the editor is being torn down.
  if (view.isDestroyed) return;
  if (ghostSelectionKey.getState(view.state)?.focused === focused) return;
  view.dispatch(
    view.state.tr
      .setMeta(ghostSelectionKey, { focused })
      .setMeta("addToHistory", false),
  );
}

export const GhostSelection = Extension.create({
  name: "ghostSelection",

  addProseMirrorPlugins() {
    return [
      new Plugin<GhostSelectionState>({
        key: ghostSelectionKey,
        state: {
          // The editor is focused right after mount, so start in that state.
          init: () => ({ focused: true }),
          apply: (tr, value) => {
            const meta = tr.getMeta(ghostSelectionKey) as
              | GhostSelectionState
              | undefined;
            return meta ?? value;
          },
        },
        props: {
          decorations(state) {
            const pluginState = ghostSelectionKey.getState(state);
            const { from, to, empty } = state.selection;
            if (!pluginState || pluginState.focused || empty) return null;
            return DecorationSet.create(state.doc, [
              Decoration.inline(from, to, { style: GHOST_STYLE }),
            ]);
          },
          handleDOMEvents: {
            focus: (view) => {
              setFocused(view, true);
              return false;
            },
            blur: (view) => {
              setFocused(view, false);
              return false;
            },
          },
        },
      }),
    ];
  },
});
