import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import {
  GhostCompletion,
  GhostCompletionPluginKey,
  GHOST_CLASS,
  getGhostState,
} from './ghost-completion.extension';

let editor: Editor | null = null;

const make = (content = '<p>Our new summer drop lands Friday.</p>') => {
  editor = new Editor({
    element: document.createElement('div'),
    extensions: [Document, Paragraph, Text, GhostCompletion],
    content,
  });
  return editor;
};

/** End of the only paragraph. */
const endPos = (e: Editor) => e.state.doc.content.size - 1;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe('GhostCompletion', () => {
  it('starts with no suggestion', () => {
    const e = make();
    expect(getGhostState(e.state).text).toBeNull();
  });

  it('NEVER lets the ghost reach the document', () => {
    // This is the whole safety story: getHTML() feeds onChange -> the launch
    // store -> the published post. If a suggestion can appear here, grey
    // placeholder prose ships to real social channels.
    const e = make();
    const before = e.getHTML();

    e.commands.setGhostSuggestion(' Grab yours early.', endPos(e));

    expect(getGhostState(e.state).text).toBe(' Grab yours early.');
    expect(e.getHTML()).toBe(before);
    expect(e.getText()).not.toContain('Grab yours early');
  });

  it('renders the suggestion as a decoration in the view', () => {
    const e = make();
    e.commands.setGhostSuggestion(' Grab yours early.', endPos(e));

    const node = e.view.dom.querySelector(`.${GHOST_CLASS}`);
    expect(node?.textContent).toBe(' Grab yours early.');
    // contenteditable=false keeps the caret out of it on touch devices.
    expect(node?.getAttribute('contenteditable')).toBe('false');
  });

  it('accepting writes the text for real and moves the caret past it', () => {
    const e = make();
    const at = endPos(e);
    e.commands.setGhostSuggestion(' Grab yours early.', at);

    expect(e.commands.acceptGhostSuggestion()).toBe(true);

    expect(e.getText()).toBe('Our new summer drop lands Friday. Grab yours early.');
    expect(getGhostState(e.state).text).toBeNull();
    expect(e.state.selection.head).toBe(at + ' Grab yours early.'.length);
    expect(e.view.dom.querySelector(`.${GHOST_CLASS}`)).toBeNull();
  });

  it('accept returns false with no ghost, so Tab keeps its default behaviour', () => {
    // Nothing else in the composer handles Tab. If this ever returns true,
    // keyboard focus is trapped in the editor.
    const e = make();
    expect(e.commands.acceptGhostSuggestion()).toBe(false);
  });

  it('drops the suggestion as soon as the document changes', () => {
    const e = make();
    e.commands.setGhostSuggestion(' Grab yours early.', endPos(e));

    e.commands.insertContent('!');

    expect(getGhostState(e.state).text).toBeNull();
  });

  it('drops the suggestion when the caret moves', () => {
    const e = make();
    e.commands.setGhostSuggestion(' Grab yours early.', endPos(e));

    e.commands.setTextSelection(3);

    expect(getGhostState(e.state).text).toBeNull();
  });

  it('Escape suppresses, and typing lifts the suppression', () => {
    const e = make();
    e.commands.setGhostSuggestion(' Grab yours early.', endPos(e));

    expect(e.commands.dismissGhostSuggestion()).toBe(true);
    expect(getGhostState(e.state).suppressed).toBe(true);
    expect(getGhostState(e.state).text).toBeNull();

    // Escape means "not this one", not "never again".
    e.commands.insertContent('!');
    expect(getGhostState(e.state).suppressed).toBe(false);
  });

  it('dismiss and clear are no-ops when nothing is showing', () => {
    const e = make();
    expect(e.commands.dismissGhostSuggestion()).toBe(false);
    expect(e.commands.clearGhostSuggestion()).toBe(false);
  });

  it('refuses an empty suggestion', () => {
    const e = make();
    expect(e.commands.setGhostSuggestion('', endPos(e))).toBe(false);
  });

  it('exposes its state under a stable plugin key', () => {
    const e = make();
    expect(GhostCompletionPluginKey.getState(e.state)).toEqual({
      text: null,
      from: null,
      suppressed: false,
    });
  });
});
