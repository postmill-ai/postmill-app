import { describe, expect, it, vi } from 'vitest';
import { mediaItemFromStockSelection, readStockMediaDrag, STOCK_MEDIA_DRAG_MIME, writeStockMediaDrag } from './stock-media-drag';

const selection = {
  url: 'https://cdn.example.test/vector.svg',
  width: 640,
  height: 480,
  thumbnail: 'https://cdn.example.test/vector.png',
  type: 'image' as const,
  source: 'pixabay',
  attribution: { author: 'QA' },
  downloadLocation: 'https://provider.example.test/download',
  name: 'Vector',
};

describe('stock media drag payloads', () => {
  it('normalizes stock metadata without changing provider attribution', () => {
    expect(mediaItemFromStockSelection(selection)).toEqual({
      source: 'stock',
      stockSource: 'pixabay',
      url: selection.url,
      width: 640,
      height: 480,
      thumbnail: selection.thumbnail,
      type: 'image',
      attribution: { author: 'QA' },
      downloadLocation: selection.downloadLocation,
      name: 'Vector',
    });
  });

  it('round-trips a validated versioned payload', () => {
    const data = new Map<string, string>();
    const dataTransfer = {
      setData: vi.fn((mime: string, value: string) => data.set(mime, value)),
      getData: vi.fn((mime: string) => data.get(mime) || ''),
    };

    writeStockMediaDrag(dataTransfer, 'vector', selection);
    expect(readStockMediaDrag(dataTransfer)).toEqual({
      kind: 'vector',
      item: mediaItemFromStockSelection(selection),
    });
  });

  const validItem = { source: 'stock', url: selection.url, type: 'image', width: 640, height: 480 };

  it.each([
    ['malformed JSON', '{broken'],
    ['the wrong version', JSON.stringify({ version: 2, kind: 'image', item: validItem })],
    ['an unknown kind', JSON.stringify({ version: 1, kind: 'executable', item: validItem })],
    ['an empty URL', JSON.stringify({ version: 1, kind: 'image', item: { ...validItem, url: '' } })],
    ['invalid dimensions', JSON.stringify({ version: 1, kind: 'image', item: { ...validItem, width: -1 } })],
  ])('rejects %s', (_name, raw) => {
    expect(readStockMediaDrag({ getData: () => raw })).toBeNull();
  });

  it('ignores unrelated drag data', () => {
    expect(readStockMediaDrag({ getData: (mime: string) => mime === STOCK_MEDIA_DRAG_MIME ? '' : 'other' })).toBeNull();
  });
});
