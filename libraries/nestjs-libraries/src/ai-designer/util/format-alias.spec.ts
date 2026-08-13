import { describe, expect, it } from 'vitest';
import { resolveFormatAlias } from './format-alias';

const DOC_FORMATS = [
  { formatId: 'ig-post', name: 'Instagram Post' },
  { formatId: 'fb-post', name: 'Facebook Post' },
  { formatId: 'ig-story', name: 'Instagram Story' },
];

describe('resolveFormatAlias', () => {
  it('resolves the formatId itself', () => {
    expect(resolveFormatAlias('fb-post', DOC_FORMATS)).toBe('fb-post');
  });

  it('resolves the formatId case-insensitively', () => {
    expect(resolveFormatAlias('FB-Post', DOC_FORMATS)).toBe('fb-post');
  });

  it('resolves a full display name', () => {
    expect(resolveFormatAlias('Facebook Post', DOC_FORMATS)).toBe('fb-post');
    expect(resolveFormatAlias('instagram story', DOC_FORMATS)).toBe('ig-story');
  });

  it('resolves the channel provider on its own', () => {
    // The live case: "only change it on Facebook" pinned nothing at all.
    expect(resolveFormatAlias('Facebook', DOC_FORMATS)).toBe('fb-post');
  });

  it('resolves a token subset with the filler words dropped', () => {
    expect(resolveFormatAlias('the story', DOC_FORMATS)).toBe('ig-story');
    expect(resolveFormatAlias('the Facebook version', DOC_FORMATS)).toBe(
      'fb-post'
    );
  });

  it('prefers an exact id over a fuzzy name match', () => {
    const formats = [
      { formatId: 'story', name: 'Custom Story Board' },
      { formatId: 'ig-story', name: 'Instagram Story' },
    ];
    expect(resolveFormatAlias('story', formats)).toBe('story');
  });

  it('picks the doc-order match when a word covers several formats', () => {
    // "instagram" covers ig-post and ig-story; the primary output wins, which
    // is the same tie-break _resolveTargetOutputIndexes already applies.
    expect(resolveFormatAlias('instagram', DOC_FORMATS)).toBe('ig-post');
  });

  it('is restricted to the formats the doc actually carries', () => {
    expect(resolveFormatAlias('LinkedIn', DOC_FORMATS)).toBeUndefined();
    expect(resolveFormatAlias('Facebook', [DOC_FORMATS[0]])).toBeUndefined();
  });

  it('resolves a custom output by its own doc name', () => {
    const formats = [{ formatId: 'custom-800x600', name: 'Email Header' }];
    expect(resolveFormatAlias('Email Header', formats)).toBe('custom-800x600');
    expect(resolveFormatAlias('the email header', formats)).toBe(
      'custom-800x600'
    );
  });

  it('resolves nothing for empty, blank, or all-stopword input', () => {
    expect(resolveFormatAlias('', DOC_FORMATS)).toBeUndefined();
    expect(resolveFormatAlias('   ', DOC_FORMATS)).toBeUndefined();
    expect(resolveFormatAlias('the version', DOC_FORMATS)).toBeUndefined();
  });
});
