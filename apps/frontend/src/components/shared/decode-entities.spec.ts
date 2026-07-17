import { describe, expect, it } from 'vitest';
import { decodeEntities } from './decode-entities';

describe('decodeEntities', () => {
  it('decodes &amp; into a literal ampersand without re-creating other entities', () => {
    expect(decodeEntities('&amp;quot;')).toBe('&quot;');
    expect(decodeEntities('&amp;lt;')).toBe('&lt;');
    expect(decodeEntities('&amp;gt;')).toBe('&gt;');
  });

  it('decodes decimal and hex numeric entities', () => {
    expect(decodeEntities('&#8220;')).toBe('“');
    expect(decodeEntities('&#x201D;')).toBe('”');
  });

  it('leaves out-of-range numeric entities raw', () => {
    expect(decodeEntities('&#999999999999;')).toBe('&#999999999999;');
  });

  it('returns an empty string for null or undefined', () => {
    expect(decodeEntities(null)).toBe('');
    expect(decodeEntities(undefined)).toBe('');
  });
});
