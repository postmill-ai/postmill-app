import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { buildTextEditCommit, TextEditingOverlay } from './text-editing';
import { createDesignerStore, type DesignerElement, type TextRun } from './designer.store';
import { adjustSelectedTextFontSize } from './text-shortcuts';

const el = {
  id: 't1',
  type: 'text',
  x: 0,
  y: 0,
  width: 200,
  height: 50,
  fill: '#000000',
  fontFamily: 'Arial',
  fontSize: 16,
  fontWeight: 400,
  text: 'Big sale today',
  richText: [
    { text: 'Big sale', fontWeight: 700 },
    { text: ' today' },
  ],
} as unknown as DesignerElement;

describe('buildTextEditCommit', () => {
  it('clears richText when the edit collapses to a single base-styled run', () => {
    // The user deleted the bold "Big sale" — only plain " today" remains.
    const commit = buildTextEditCommit([{ text: ' today' } as TextRun], el);
    expect(commit.text).toBe(' today');
    expect(commit.richText).toBeUndefined();
  });

  it('clears richText for a single plain run even when none was set before', () => {
    const commit = buildTextEditCommit(
      [{ text: 'Big sale today' } as TextRun],
      { ...el, richText: undefined } as DesignerElement
    );
    expect(commit.richText).toBeUndefined();
  });

  it('keeps richText when multiple runs remain', () => {
    const runs = [
      { text: 'Big', fontWeight: 700 },
      { text: ' sale today' },
    ] as TextRun[];
    const commit = buildTextEditCommit(runs, el);
    expect(commit.text).toBe('Big sale today');
    expect(commit.richText).toEqual(runs);
  });

  it('keeps richText for a single styled run', () => {
    const runs = [{ text: 'Sale', fill: '#ff0000' }] as TextRun[];
    const commit = buildTextEditCommit(runs, el);
    expect(commit.richText).toEqual(runs);
  });

  it('auto-fits height after a flat text edit without shrinking a manual box', () => {
    const flat = {
      ...el,
      text: '',
      richText: undefined,
      width: 100,
      height: 20,
      fontSize: 20,
    } as DesignerElement;
    const measure = (text: string, size: number) => text.length * size * 0.5;
    expect(buildTextEditCommit([{ text: 'hello world' } as TextRun], flat, measure).height).toBe(48);
    expect(buildTextEditCommit(
      [{ text: 'hello world' } as TextRun],
      { ...flat, height: 200 },
      measure
    ).height).toBeUndefined();
  });

  it('widens only for one unwrapped overflow word', () => {
    const flat = {
      ...el,
      text: '',
      richText: undefined,
      width: 100,
      height: 20,
      fontSize: 20,
    } as DesignerElement;
    const measure = (text: string, size: number) => text.length * size * 0.5;
    expect(buildTextEditCommit(
      [{ text: 'supercalifragilistic' } as TextRun],
      flat,
      measure
    ).width).toBe(200);
    expect(buildTextEditCommit([{ text: 'hello world' } as TextRun], flat, measure).width).toBeUndefined();
  });
});

describe('TextEditingOverlay font-size shortcuts', () => {
  it('handles a focused contenteditable once without bubbling a duplicate history commit', () => {
    const store = createDesignerStore();
    store.getState().addElement({ ...el, locked: false, hidden: false });
    const history = store.getState().history.length;
    const onAdjustFontSize = vi.fn((delta: number) => {
      adjustSelectedTextFontSize(store, delta);
    });
    const onParentKeyDown = vi.fn((event: React.KeyboardEvent) => {
      adjustSelectedTextFontSize(store, event.key === '>' ? 1 : -1);
    });
    const { container } = render(
      React.createElement(
        'div',
        { onKeyDown: onParentKeyDown },
        React.createElement(TextEditingOverlay, {
          element: el,
          stageRect: { x: 0, y: 0, scale: 1 },
          onUpdate: vi.fn(),
          onAdjustFontSize,
          onComplete: vi.fn(),
        })
      )
    );
    const editor = container.querySelector<HTMLElement>('[data-text-editor-id="t1"]')!;
    editor.focus();
    expect(document.activeElement).toBe(editor);

    fireEvent.keyDown(editor, { key: '>', ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(editor, { key: '<', metaKey: true, shiftKey: true });

    expect(onAdjustFontSize.mock.calls).toEqual([[1], [-1]]);
    expect(onParentKeyDown).not.toHaveBeenCalled();
    expect(store.getState().history).toHaveLength(history + 2);
    expect(store.getState().doc.outputs[0]).toMatchObject({ children: [{ fontSize: 16 }] });
  });
});
