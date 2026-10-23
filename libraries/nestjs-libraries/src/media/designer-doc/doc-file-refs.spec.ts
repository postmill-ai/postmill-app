import { describe, it, expect } from 'vitest';
import {
  collectDocFileIds,
  collectDocFontFamilies,
  rewriteDocFileRefs,
} from './doc-file-refs';

describe('collectDocFontFamilies', () => {
  it('collects fontFamily values from anywhere in the doc', () => {
    const doc = {
      outputs: [
        {
          children: [
            { type: 'text', fontFamily: 'Acme' },
            { type: 'text', runs: [{ fontFamily: 'Inter' }, { text: 'no font' }] },
          ],
        },
        { tracks: [{ clips: [{ type: 'text', fontFamily: 'Acme' }] }] },
      ],
      symbols: [{ children: [{ type: 'text', fontFamily: 'Bebas' }] }],
    };
    expect(collectDocFontFamilies(doc)).toEqual(new Set(['Acme', 'Inter', 'Bebas']));
  });

  it('returns an empty set for empty input', () => {
    expect(collectDocFontFamilies(null)).toEqual(new Set());
    expect(collectDocFontFamilies({})).toEqual(new Set());
  });
});

describe('rewriteDocFileRefs', () => {
  const map = new Map([
    ['old-1', { id: 'new-1', path: '/uploads/org-b/aaaa.mp4' }],
    ['old-2', { id: 'new-2', path: 'https://host.example/uploads/org-b/bbbb.png' }],
  ]);

  it('rewrites fileId/originalFileId/maskFileId and their paired uploads srcs', () => {
    const doc = {
      outputs: [
        {
          children: [
            { id: 'e1', fileId: 'old-1', src: '/uploads/org-a/zzzz' },
            { id: 'e2', originalFileId: 'old-2', originalSrc: 'https://old.example/uploads/org-a/yyyy.png' },
            { id: 'e3', maskFileId: 'old-1', maskSrc: 'uploads/org-a/mask.png' },
          ],
        },
        { tracks: [{ clips: [{ id: 'c1', fileId: 'old-1', src: '/uploads/org-a/zzzz', mediaType: 'video' }] }] },
      ],
    };

    const out = rewriteDocFileRefs(doc, map) as any;

    expect(out.outputs[0].children[0]).toEqual({ id: 'e1', fileId: 'new-1', src: '/uploads/org-b/aaaa.mp4' });
    expect(out.outputs[0].children[1]).toEqual({
      id: 'e2',
      originalFileId: 'new-2',
      originalSrc: 'https://host.example/uploads/org-b/bbbb.png',
    });
    expect(out.outputs[0].children[2]).toEqual({ id: 'e3', maskFileId: 'new-1', maskSrc: '/uploads/org-b/aaaa.mp4' });
    expect(out.outputs[1].tracks[0].clips[0].fileId).toBe('new-1');
    expect(out.outputs[1].tracks[0].clips[0].src).toBe('/uploads/org-b/aaaa.mp4');
    // Input untouched.
    expect(doc.outputs[0].children[0].fileId).toBe('old-1');
  });

  it('leaves remote and data: srcs untouched even when the fileId remaps', () => {
    const doc = {
      outputs: [
        {
          children: [
            { fileId: 'old-1', src: 'https://cdn.stock.example/photo.jpg' },
            { fileId: 'old-2', src: 'data:image/png;base64,AAAA' },
          ],
        },
      ],
    };
    const out = rewriteDocFileRefs(doc, map) as any;
    expect(out.outputs[0].children[0]).toEqual({
      fileId: 'new-1',
      src: 'https://cdn.stock.example/photo.jpg',
    });
    expect(out.outputs[0].children[1]).toEqual({
      fileId: 'new-2',
      src: 'data:image/png;base64,AAAA',
    });
  });

  it('leaves unmapped ids and their srcs alone', () => {
    const doc = { outputs: [{ children: [{ fileId: 'elsewhere', src: '/uploads/org-a/keep.png' }] }] };
    const out = rewriteDocFileRefs(doc, map) as any;
    expect(out.outputs[0].children[0]).toEqual({ fileId: 'elsewhere', src: '/uploads/org-a/keep.png' });
  });

  it('is a no-op with an empty map', () => {
    const doc = { outputs: [{ children: [{ fileId: 'old-1' }] }] };
    expect(rewriteDocFileRefs(doc, new Map())).toBe(doc);
  });
});
