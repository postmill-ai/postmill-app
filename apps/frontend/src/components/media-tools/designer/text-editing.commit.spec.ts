import { describe, it, expect } from 'vitest';
import { buildTextEditCommit } from './text-editing';
import type { DesignerElement, TextRun } from './designer.store';

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
});
