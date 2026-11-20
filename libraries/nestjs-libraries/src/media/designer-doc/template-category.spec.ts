import { describe, expect, it } from 'vitest';
import {
  templateCategoryKey,
  templateCategoryLabel,
  templateCategorySearchAliases,
} from './template-category';

describe('templateCategory', () => {
  it.each([
    ['instagram-post', 'image', 'ig-post', 'IG Post'],
    ['Instagram Post', 'image', 'ig-post', 'IG Post'],
    ['custom-video', 'video', 'custom', 'Custom'],
    [null, 'video', 'video', 'Video'],
    ['', 'image', 'other', 'Other'],
    ['  Seasonal Campaign  ', 'image', 'seasonal campaign', 'Seasonal Campaign'],
  ])('normalizes %s without changing custom labels', (category, mode, key, label) => {
    expect(templateCategoryKey(category, mode)).toBe(key);
    expect(templateCategoryLabel(category, mode)).toBe(label);
  });

  it('searches both stored and canonical IG Post aliases', () => {
    expect(templateCategorySearchAliases('IG Post')).toEqual(
      expect.arrayContaining(['IG Post', 'ig-post', 'instagram-post', 'instagram post']),
    );
  });
});
