import { describe, it, expect } from 'vitest';
import {
  providerForFormatId,
  variantProviders,
  groupFilesByProvider,
} from './export-channels';

describe('providerForFormatId', () => {
  it('maps a social preset to its provider', () => {
    expect(providerForFormatId('ig-post')).toBe('instagram');
    expect(providerForFormatId('x-post')).toBe('x');
    expect(providerForFormatId('linkedin-post')).toBe('linkedin');
  });

  it('maps video presets to their provider', () => {
    expect(providerForFormatId('reel')).toBe('instagram');
    expect(providerForFormatId('tiktok-video')).toBe('tiktok');
  });

  it('returns null for custom formats (not postable)', () => {
    expect(providerForFormatId('custom')).toBeNull();
    expect(providerForFormatId('custom-video')).toBeNull();
  });

  it('returns null for unknown or missing format ids', () => {
    expect(providerForFormatId('no-such-format')).toBeNull();
    expect(providerForFormatId(undefined)).toBeNull();
    expect(providerForFormatId('')).toBeNull();
  });
});

describe('variantProviders', () => {
  it('collects distinct providers in first-appearance order', () => {
    const outputs = [
      { id: 'o1', formatId: 'x-post' },
      { id: 'o2', formatId: 'ig-post' },
      { id: 'o3', formatId: 'ig-story' },
    ];
    expect(variantProviders(outputs)).toEqual(['x', 'instagram']);
  });

  it('skips variants with no provider', () => {
    const outputs = [
      { id: 'o1', formatId: 'custom' },
      { id: 'o2', formatId: 'ig-post' },
    ];
    expect(variantProviders(outputs)).toEqual(['instagram']);
  });

  it('returns an empty list when no variant maps to a provider', () => {
    expect(
      variantProviders([
        { id: 'o1', formatId: 'custom' },
        { id: 'o2', formatId: 'unknown-format' },
      ])
    ).toEqual([]);
    expect(variantProviders([])).toEqual([]);
  });
});

describe('groupFilesByProvider', () => {
  const outputs = [
    { id: 'o-ig-post', formatId: 'ig-post' },
    { id: 'o-ig-story', formatId: 'ig-story' },
    { id: 'o-x', formatId: 'x-post' },
    { id: 'o-custom', formatId: 'custom' },
  ];

  it('groups files by provider; all variants of one provider attach together', () => {
    const files = [
      { outputId: 'o-ig-post', path: '/a.jpg' },
      { outputId: 'o-ig-story', path: '/b.jpg' },
      { outputId: 'o-x', path: '/c.jpg' },
      { outputId: 'o-custom', path: '/d.jpg' },
    ];
    const groups = groupFilesByProvider(files, outputs);
    expect(groups.instagram).toEqual([
      { outputId: 'o-ig-post', path: '/a.jpg' },
      { outputId: 'o-ig-story', path: '/b.jpg' },
    ]);
    expect(groups.x).toEqual([{ outputId: 'o-x', path: '/c.jpg' }]);
    // Custom-format variant exports to /files but is never postable.
    expect(groups.custom).toBeUndefined();
    expect(Object.keys(groups).sort()).toEqual(['instagram', 'x']);
  });

  it('drops files whose output is missing from the outputs list', () => {
    const files = [{ outputId: 'o-ghost', path: '/ghost.jpg' }];
    expect(groupFilesByProvider(files, outputs)).toEqual({});
  });

  it('handles an empty file list', () => {
    expect(groupFilesByProvider([], outputs)).toEqual({});
  });
});
