import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ElementsPanel } from './elements-panel';
import { STOCK_MEDIA_DRAG_MIME } from '../stock-media-drag';

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));

function browser(name: string) {
  return function MockStockBrowser({ onSelectFull, onDragStart }: any) {
    const selection = {
      url: 'https://cdn.example.test/asset.png',
      width: 1200,
      height: 800,
      thumbnail: 'https://cdn.example.test/thumb.png',
      type: 'image',
      source: 'unsplash',
      attribution: { author: 'QA' },
      name: 'QA asset',
    };
    return (
      <div>
        <input aria-label={`${name} query`} defaultValue="" />
        <button onClick={() => onSelectFull(selection)}>Select {name} asset</button>
        <button onDragStart={(event) => onDragStart(selection, event)}>Drag {name} asset</button>
      </div>
    );
  };
}

vi.mock('@postmill-ai/frontend/components/media-tools/stock-photos', () => ({ StockPhotos: browser('photos') }));
vi.mock('@postmill-ai/frontend/components/media-tools/stock-videos', () => ({ StockVideos: browser('videos') }));
vi.mock('@postmill-ai/frontend/components/media-tools/stock-vectors', () => ({ StockVectors: browser('vectors') }));
vi.mock('@postmill-ai/frontend/components/media-tools/stock-icons', () => ({ StockIcons: browser('icons') }));
vi.mock('@postmill-ai/frontend/components/media-tools/stock-stickers', () => ({ StockStickers: browser('stickers') }));
vi.mock('@postmill-ai/frontend/components/media-tools/stock-audio', () => ({ StockAudio: browser('audio') }));

const selection = {
  url: 'https://cdn.example.test/asset.png',
  width: 1200,
  height: 800,
  source: 'unsplash',
};

describe('ElementsPanel', () => {
  it('lazy-mounts categories and retains their search state', () => {
    const { container } = render(<ElementsPanel onInsertMedia={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Select videos asset' })).toBeNull();

    fireEvent.change(screen.getByRole('textbox', { name: 'photos query' }), { target: { value: 'mountains' } });
    fireEvent.click(screen.getAllByRole('tab', { name: 'Videos', exact: true })[0]);
    expect(screen.getByRole('button', { name: 'Select videos asset' })).toBeDefined();
    expect(container.querySelector('[data-elements-category="photos"]')).toHaveProperty('hidden', true);

    fireEvent.click(screen.getAllByRole('tab', { name: 'Photos', exact: true })[0]);
    expect(screen.getByRole('textbox', { name: 'photos query' })).toHaveProperty('value', 'mountains');
  });

  it('offers every Content Pack category', () => {
    render(<ElementsPanel onInsertMedia={vi.fn()} />);
    for (const name of ['Photos', 'Videos', 'Vectors', 'Icons', 'Stickers', 'Audio']) {
      expect(screen.getAllByRole('tab', { name, exact: true }).length).toBeGreaterThan(0);
    }
  });

  it('normalizes click selections for the shared insertion callback', () => {
    const onInsertMedia = vi.fn().mockResolvedValue(undefined);
    render(<ElementsPanel onInsertMedia={onInsertMedia} />);
    fireEvent.click(screen.getByRole('button', { name: 'Select photos asset' }));

    expect(onInsertMedia).toHaveBeenCalledWith('image', expect.objectContaining({
      source: 'stock',
      stockSource: 'unsplash',
      url: selection.url,
      width: 1200,
      height: 800,
      attribution: { author: 'QA' },
    }));
  });

  it('writes a metadata-only copy drag payload', () => {
    render(<ElementsPanel onInsertMedia={vi.fn()} />);
    const dataTransfer = { setData: vi.fn(), effectAllowed: 'none' };
    fireEvent.dragStart(screen.getByRole('button', { name: 'Drag photos asset' }), { dataTransfer });

    expect(dataTransfer.effectAllowed).toBe('copy');
    const [mime, raw] = dataTransfer.setData.mock.calls[0];
    expect(mime).toBe(STOCK_MEDIA_DRAG_MIME);
    expect(JSON.parse(raw)).toMatchObject({
      version: 1,
      kind: 'image',
      item: { source: 'stock', url: selection.url, type: 'image' },
    });
    expect(raw).not.toContain('apiKey');
  });
});
