import { describe, expect, it, vi } from 'vitest';
import type { FileItem } from '@postmill-ai/frontend/components/files/file-manager';
import {
  STILL_IMAGE_DRAG_MIME,
  STOCK_MEDIA_DRAG_MIME,
  hasStillImageDrag,
  isStillImageMedia,
  mediaItemFromFileSelection,
  mediaItemFromStockSelection,
  readStockMediaDrag,
  writeDesignerMediaDrag,
  writeStockMediaDrag,
} from './stock-media-drag';

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
  it('normalizes File Library metadata and marks still images during dragover', () => {
    const file = {
      id: 'file-1',
      name: 'library.png',
      originalName: 'Library.png',
      path: '/uploads/library.png',
      thumbnail: '/uploads/thumb.png',
      type: 'image/png',
      metadata: { dimensions: { width: 1200, height: 600 } },
    } as FileItem;
    const item = mediaItemFromFileSelection(file);
    const data = new Map<string, string>();
    const dataTransfer = {
      setData: vi.fn((mime: string, value: string) => data.set(mime, value)),
      getData: vi.fn((mime: string) => data.get(mime) || ''),
      get types() { return [...data.keys()]; },
    };

    writeDesignerMediaDrag(dataTransfer, 'image', item);

    expect(item).toMatchObject({
      source: 'file', fileId: 'file-1', url: '/uploads/library.png',
      type: 'image', width: 1200, height: 600,
    });
    expect(data.has(STILL_IMAGE_DRAG_MIME)).toBe(true);
    expect(hasStillImageDrag(dataTransfer)).toBe(true);
    expect(readStockMediaDrag(dataTransfer)).toEqual({ kind: 'image', item });
  });

  it('does not mark vectors, videos, or audio as replacement sources', () => {
    const data = new Map<string, string>();
    const dataTransfer = {
      setData: (mime: string, value: string) => data.set(mime, value),
      get types() { return [...data.keys()]; },
    };

    writeStockMediaDrag(dataTransfer, 'vector', selection);
    expect(hasStillImageDrag(dataTransfer)).toBe(false);
    expect(isStillImageMedia('vector', mediaItemFromStockSelection(selection))).toBe(false);
    expect(isStillImageMedia('video', {
      ...mediaItemFromStockSelection(selection), type: 'video',
    })).toBe(false);
    expect(isStillImageMedia('audio', {
      ...mediaItemFromStockSelection(selection), type: 'audio',
    })).toBe(false);
  });

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
