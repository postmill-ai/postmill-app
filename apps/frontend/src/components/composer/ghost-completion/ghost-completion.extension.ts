import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/**
 * Inline ghost-text completion for the composer.
 *
 * The suggestion is rendered as a ProseMirror **decoration**, never as a node or
 * a mark. That is the load-bearing property of this whole feature: decorations
 * live in the view's render pass only, so `editor.getHTML()` — which serializes
 * `state.doc` — cannot see them, and a show/hide transaction has
 * `docChanged === false`, so TipTap's `onUpdate` (and therefore
 * `onChange(getHTML())` → the launch store → the published post) never fires for
 * one. Re-implementing this as a node would leak grey placeholder prose into
 * people's actual posts.
 *
 * This extension holds no timers and issues no requests — see
 * `use-ghost-completion.ts`. It stays dependency-free so it can be tested
 * against a real headless editor with no mocks.
 */

export interface GhostCompletionState {
  /** The text to show, already including any joining space. */
  text: string | null;
  /** Document position the ghost hangs off. */
  from: number | null;
  /** Set by Escape; blocks re-suggesting until the user types again. */
  suppressed: boolean;
}

export const GHOST_CLASS = 'ghost-suggestion';

export const GhostCompletionPluginKey = new PluginKey<GhostCompletionState>(
  'ghostCompletion'
);

const EMPTY: GhostCompletionState = { text: null, from: null, suppressed: false };

type GhostMeta =
  | { type: 'set'; text: string; from: number }
  | { type: 'clear' }
  | { type: 'suppress' };

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    ghostCompletion: {
      setGhostSuggestion: (text: string, from: number) => ReturnType;
      clearGhostSuggestion: () => ReturnType;
      dismissGhostSuggestion: () => ReturnType;
      acceptGhostSuggestion: () => ReturnType;
    };
  }
}

export const getGhostState = (state: any): GhostCompletionState =>
  GhostCompletionPluginKey.getState(state) ?? EMPTY;

/** True when the caret sits at the end of its text block with nothing selected. */
export const caretAtEndOfBlock = (state: any): boolean => {
  const { selection } = state;
  if (!selection.empty) return false;
  const { $head } = selection;
  if (!$head.parent.isTextblock) return false;
  return $head.parentOffset === $head.parent.content.size;
};

export const GhostCompletion = Extension.create({
  name: 'ghostCompletion',

  addCommands() {
    return {
      setGhostSuggestion:
        (text: string, from: number) =>
        ({ state, dispatch }: any) => {
          if (!text) return false;
          if (dispatch) {
            dispatch(
              state.tr.setMeta(GhostCompletionPluginKey, {
                type: 'set',
                text,
                from,
              } satisfies GhostMeta)
            );
          }
          return true;
        },

      clearGhostSuggestion:
        () =>
        ({ state, dispatch }: any) => {
          if (!getGhostState(state).text) return false;
          if (dispatch) {
            dispatch(
              state.tr.setMeta(GhostCompletionPluginKey, {
                type: 'clear',
              } satisfies GhostMeta)
            );
          }
          return true;
        },

      dismissGhostSuggestion:
        () =>
        ({ state, dispatch }: any) => {
          if (!getGhostState(state).text) return false;
          if (dispatch) {
            dispatch(
              state.tr.setMeta(GhostCompletionPluginKey, {
                type: 'suppress',
              } satisfies GhostMeta)
            );
          }
          return true;
        },

      acceptGhostSuggestion:
        () =>
        ({ state, dispatch }: any) => {
          const ghost = getGhostState(state);
          if (!ghost.text || ghost.from === null) return false;
          if (dispatch) {
            const tr = state.tr.insertText(ghost.text, ghost.from);
            const end = ghost.from + ghost.text.length;
            tr.setSelection(TextSelection.create(tr.doc, end));
            // Ride along on the same transaction: the plugin reads meta before
            // its docChanged branch, so the ghost is gone in one step.
            tr.setMeta(GhostCompletionPluginKey, { type: 'clear' } satisfies GhostMeta);
            dispatch(tr.scrollIntoView());
          }
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    // These MUST fall through when no ghost is showing. Nothing else in the
    // composer handles Tab, so swallowing it unconditionally would trap keyboard
    // focus inside the editor.
    const accept = () => this.editor.commands.acceptGhostSuggestion();
    return {
      Tab: accept,
      ArrowRight: () => {
        // Only steal ArrowRight at the end of a block; anywhere else it has to
        // keep moving the caret.
        if (!caretAtEndOfBlock(this.editor.state)) return false;
        return accept();
      },
      Escape: () => this.editor.commands.dismissGhostSuggestion(),
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<GhostCompletionState>({
        key: GhostCompletionPluginKey,

        state: {
          init: () => EMPTY,
          apply(tr, value, oldState) {
            const meta = tr.getMeta(GhostCompletionPluginKey) as
              | GhostMeta
              | undefined;

            if (meta) {
              if (meta.type === 'set') {
                return { text: meta.text, from: meta.from, suppressed: false };
              }
              if (meta.type === 'suppress') {
                return { text: null, from: null, suppressed: true };
              }
              return EMPTY;
            }

            // Any real edit or caret move invalidates the suggestion — it was
            // computed for a document that no longer exists. Typing also lifts
            // an Escape suppression, which is what makes Escape mean "not this
            // one" rather than "never again".
            if (tr.docChanged) {
              return EMPTY;
            }
            if (!tr.selection.eq(oldState.selection)) {
              return { ...value, text: null, from: null };
            }

            return value;
          },
        },

        props: {
          decorations(state) {
            const ghost = this.getState(state);
            if (!ghost?.text || ghost.from === null) return null;
            if (ghost.from > state.doc.content.size) return null;

            const widget = Decoration.widget(
              ghost.from,
              () => {
                const span = document.createElement('span');
                span.className = GHOST_CLASS;
                span.setAttribute('contenteditable', 'false');
                span.setAttribute('aria-hidden', 'true');
                span.textContent = ghost.text as string;
                return span;
              },
              {
                // side:1 keeps the widget after the caret rather than before it.
                side: 1,
                // Re-create only when the suggestion itself changes.
                key: `ghost-${ghost.from}-${ghost.text}`,
                // Never let a tap on the ghost reach the editor: on iOS that
                // steals the caret and closes the keyboard.
                stopEvent: () => true,
                ignoreSelection: true,
              }
            );

            return DecorationSet.create(state.doc, [widget]);
          },
        },
      }),
    ];
  },
});
