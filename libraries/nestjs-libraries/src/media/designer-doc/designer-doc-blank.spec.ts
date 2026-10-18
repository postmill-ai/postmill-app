import { describe, it, expect } from 'vitest';
import { isBlankDoc } from './designer-doc-blank';

describe('isBlankDoc', () => {
  it('treats a missing/empty doc as blank', () => {
    expect(isBlankDoc(null)).toBe(true);
    expect(isBlankDoc(undefined)).toBe(true);
    expect(isBlankDoc({})).toBe(true);
    expect(isBlankDoc({ outputs: [] })).toBe(true);
  });

  it('is true for an image output with no elements anywhere', () => {
    expect(
      isBlankDoc({
        outputs: [
          { children: [], pages: [{ children: [] }, { children: [] }] },
        ],
      })
    ).toBe(true);
  });

  it('is true when image outputs have no pages at all and empty children', () => {
    expect(isBlankDoc({ outputs: [{ children: [] }] })).toBe(true);
  });

  it('is false when page 1 has an element', () => {
    expect(
      isBlankDoc({ outputs: [{ children: [{ type: 'text' }] }] })
    ).toBe(false);
  });

  it('is false when only a later page has an element', () => {
    expect(
      isBlankDoc({
        outputs: [
          { children: [], pages: [{ children: [] }, { children: [{ type: 'image' }] }] },
        ],
      })
    ).toBe(false);
  });

  it('is true for a video output whose tracks are all clip-less', () => {
    expect(
      isBlankDoc({
        outputs: [{ tracks: [{ clips: [] }, { clips: [] }] }],
      })
    ).toBe(true);
    expect(isBlankDoc({ outputs: [{ tracks: [] }] })).toBe(true);
  });

  it('is false when any video track holds a clip', () => {
    expect(
      isBlankDoc({
        outputs: [{ tracks: [{ clips: [] }, { clips: [{ id: 'c1' }] }] }],
      })
    ).toBe(false);
  });

  it('requires EVERY output to be content-free', () => {
    expect(
      isBlankDoc({
        outputs: [{ children: [] }, { children: [{ type: 'shape' }] }],
      })
    ).toBe(false);
    expect(
      isBlankDoc({
        outputs: [{ children: [] }, { tracks: [{ clips: [] }] }],
      })
    ).toBe(true);
  });

  it('survives null/garbage leaves defensively', () => {
    expect(
      isBlankDoc({
        outputs: [
          { children: null, pages: null },
          { tracks: [{ clips: null }] },
          { pages: [{ children: null }] },
        ],
      })
    ).toBe(true);
    expect(isBlankDoc({ outputs: [null] })).toBe(true);
  });
});
