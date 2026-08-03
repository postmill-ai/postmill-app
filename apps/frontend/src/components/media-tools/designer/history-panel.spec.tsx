import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import { HistoryPanel } from './panels/history-panel';
import { createDesignerStore, type DesignerElement } from './designer.store';

/**
 * The History panel exposes snapshots the store was already keeping. What is
 * worth pinning is that the labels stay in step with the snapshots — an
 * off-by-one there sends a click to the wrong document state.
 */

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT:
    () =>
    (_k: string, d: string, vars?: Record<string, unknown>) =>
      vars ? d.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(vars[k])) : d,
}));

afterEach(cleanup);

const shape = (name: string): DesignerElement =>
  ({
    id: '',
    type: 'shape',
    shape: 'rect',
    x: 0, y: 0, width: 10, height: 10,
    rotation: 0, opacity: 1, locked: false, hidden: false,
    name,
  }) as DesignerElement;

describe('history labels', () => {
  it('starts with the document being opened', () => {
    const store = createDesignerStore();
    expect(store.getState().historyLabels).toEqual(['Open']);
  });

  it('stays exactly as long as the snapshot list', () => {
    const store = createDesignerStore();
    store.getState().pushHistory('Add shape');
    store.getState().pushHistory('Move');
    expect(store.getState().historyLabels).toHaveLength(store.getState().history.length);
  });

  it('falls back to a generic label — no caller is forced to name its edit', () => {
    const store = createDesignerStore();
    store.getState().pushHistory();
    expect(store.getState().historyLabels[1]).toBe('Edit');
  });

  it('truncates the redo tail with the snapshots, not separately', () => {
    const store = createDesignerStore();
    store.getState().pushHistory('One');
    store.getState().pushHistory('Two');
    store.getState().undo();
    store.getState().pushHistory('Three');

    expect(store.getState().historyLabels).toEqual(['Open', 'One', 'Three']);
    expect(store.getState().history).toHaveLength(3);
  });

  it('resets to a single entry on a new document', () => {
    const store = createDesignerStore();
    store.getState().pushHistory('One');
    store.getState().reset();
    expect(store.getState().historyLabels).toEqual(['New']);
  });
});

describe('jumpToHistory', () => {
  it('restores the document at that entry', () => {
    const store = createDesignerStore();
    store.getState().addElement(shape('first'));
    const afterFirst = store.getState().historyIndex;
    store.getState().addElement(shape('second'));

    expect(store.getState().doc.outputs[0].children).toHaveLength(2);
    store.getState().jumpToHistory(afterFirst);
    expect(store.getState().doc.outputs[0].children).toHaveLength(1);
  });

  it('goes forwards as readily as backwards', () => {
    const store = createDesignerStore();
    store.getState().addElement(shape('a'));
    store.getState().addElement(shape('b'));
    const end = store.getState().historyIndex;

    store.getState().jumpToHistory(0);
    store.getState().jumpToHistory(end);
    expect(store.getState().doc.outputs[0].children).toHaveLength(2);
  });

  it('ignores an index that is not there', () => {
    const store = createDesignerStore();
    const before = store.getState().historyIndex;
    store.getState().jumpToHistory(99);
    store.getState().jumpToHistory(-1);
    expect(store.getState().historyIndex).toBe(before);
  });

  it('clears the selection, since the selected layer may not exist there', () => {
    const store = createDesignerStore();
    store.getState().addElement(shape('a'));
    const id = store.getState().doc.outputs[0].children[0].id;
    store.getState().setSelectedIds([id]);

    store.getState().jumpToHistory(0);
    expect(store.getState().selectedIds).toEqual([]);
  });
});

describe('HistoryPanel', () => {
  const withHistory = () => {
    const store = createDesignerStore();
    store.getState().pushHistory('Add shape');
    store.getState().pushHistory('Move');
    return store;
  };

  it('lists every state, oldest first', () => {
    const store = withHistory();
    render(<HistoryPanel store={store} />);
    const options = screen.getAllByRole('option').map((o) => o.textContent);
    expect(options[0]).toContain('Open');
    expect(options[2]).toContain('Move');
  });

  it('marks the current state', () => {
    const store = withHistory();
    render(<HistoryPanel store={store} />);
    const options = screen.getAllByRole('option');
    expect(options[2].getAttribute('aria-selected')).toBe('true');
  });

  it('jumps when a state is clicked', () => {
    const store = withHistory();
    render(<HistoryPanel store={store} />);

    fireEvent.click(screen.getAllByRole('option')[0]);
    expect(store.getState().historyIndex).toBe(0);
  });

  it('keeps the undone states listed rather than hiding them', () => {
    // Seeing what you are about to lose is the difference between a history
    // panel and an undo button.
    const store = withHistory();
    store.getState().undo();
    render(<HistoryPanel store={store} />);
    expect(screen.getAllByRole('option')).toHaveLength(3);
  });
});
