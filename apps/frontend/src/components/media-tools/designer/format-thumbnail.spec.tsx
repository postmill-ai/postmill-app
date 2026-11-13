import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import type { DesignerOutput } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.schema';
import { FormatThumbnail } from './format-thumbnail';

const renderThumbnail = vi.hoisted(() =>
  vi.fn(async () => 'data:image/jpeg;base64,thumbnail')
);

vi.mock('./output-thumbnail', () => ({
  renderOutputThumbnail: renderThumbnail,
}));

const output = (text: string): DesignerOutput => ({
  id: 'out', formatId: 'ig-post', name: 'Post', width: 1080, height: 1080,
  background: '#ffffff', children: [{
    id: 'text', type: 'text', text, x: 0, y: 0, width: 100, height: 30,
    rotation: 0, opacity: 1, locked: false, hidden: false,
  }],
});

describe('FormatThumbnail scheduling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    renderThumbnail.mockClear();
    vi.stubGlobal('IntersectionObserver', class {
      constructor(private callback: (entries: { isIntersecting: boolean }[]) => void) {}
      observe() {
        this.callback([{ isIntersecting: true }]);
      }
      disconnect() {}
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('debounces drag-time document changes into one bounded capture', async () => {
    const view = render(<FormatThumbnail output={output('0')} maxDim={72} />);
    for (let frame = 1; frame <= 5; frame++) {
      view.rerender(<FormatThumbnail output={output(String(frame))} maxDim={72} />);
    }
    expect(renderThumbnail).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(179);
    });
    expect(renderThumbnail).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(renderThumbnail).toHaveBeenCalledTimes(1);
    expect(renderThumbnail.mock.calls[0][0].children[0].text).toBe('5');
    expect(renderThumbnail.mock.calls[0][2]).toBe(72);
  });

  it('does not render off-screen thumbnails until the observer intersects', async () => {
    let intersect: ((entries: { isIntersecting: boolean }[]) => void) | undefined;
    vi.stubGlobal('IntersectionObserver', class {
      constructor(private callback: (entries: { isIntersecting: boolean }[]) => void) {
        intersect = callback;
      }
      observe() {}
      disconnect() {}
    });
    render(<FormatThumbnail output={output('off-screen')} maxDim={72} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(renderThumbnail).not.toHaveBeenCalled();

    act(() => intersect?.([{ isIntersecting: true }]));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(180);
    });
    expect(renderThumbnail).toHaveBeenCalledTimes(1);
  });
});


describe('FormatThumbnail identity cache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    renderThumbnail.mockClear();
    vi.stubGlobal('IntersectionObserver', class {
      constructor(private callback: (entries: { isIntersecting: boolean }[]) => void) {}
      observe() {
        this.callback([{ isIntersecting: true }]);
      }
      disconnect() {}
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('reuses matching object references, invalidates new symbols, and never stringifies output content', async () => {
    const stringify = vi.spyOn(JSON, 'stringify');
    const stableOutput = output('stable');
    const stableSymbols: never[] = [];
    const first = render(
      <FormatThumbnail output={stableOutput} symbols={stableSymbols} maxDim={72} />
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(180);
    });
    expect(renderThumbnail).toHaveBeenCalledTimes(1);
    first.unmount();

    const second = render(
      <FormatThumbnail output={stableOutput} symbols={stableSymbols} maxDim={72} />
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(180);
    });
    expect(renderThumbnail).toHaveBeenCalledTimes(1);

    second.rerender(
      <FormatThumbnail output={stableOutput} symbols={[]} maxDim={72} />
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(180);
    });
    expect(renderThumbnail).toHaveBeenCalledTimes(2);
    expect(stringify).not.toHaveBeenCalled();
    stringify.mockRestore();
  });

  it('invalidates only the edited page and accepts structurally identical undo views', async () => {
    const initial = output('page-one');
    initial.pages = [{
      id: 'page-two', children: [{
        ...initial.children[0], id: 'page-two-text', text: 'page-two',
      }],
    }];
    const view = render(<FormatThumbnail output={initial} pageNumber={1} maxDim={72} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(180);
    });
    expect(renderThumbnail).toHaveBeenCalledTimes(1);

    view.rerender(<FormatThumbnail output={structuredClone(initial)} pageNumber={1} maxDim={72} />);
    const pageOneEdit = {
      ...initial,
      children: [{ ...initial.children[0], text: 'edited-page-one' }],
    };
    view.rerender(<FormatThumbnail output={pageOneEdit} pageNumber={1} maxDim={72} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(360);
    });
    expect(renderThumbnail).toHaveBeenCalledTimes(1);

    const pageTwoEdit = {
      ...pageOneEdit,
      pages: [{
        ...initial.pages![0],
        children: [{ ...initial.pages![0].children[0], text: 'edited-page-two' }],
      }],
    };
    view.rerender(<FormatThumbnail output={pageTwoEdit} pageNumber={1} maxDim={72} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(180);
    });
    expect(renderThumbnail).toHaveBeenCalledTimes(2);
  });
});
