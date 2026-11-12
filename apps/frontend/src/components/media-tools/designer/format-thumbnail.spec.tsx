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
});
