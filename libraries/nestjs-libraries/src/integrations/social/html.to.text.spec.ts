import { describe, it, expect } from 'vitest';
import { decodeHtmlEntities, htmlToText } from '@gitroom/helpers/utils/html.to.text';

describe('decodeHtmlEntities', () => {
  it('returns empty string for nullish input', () => {
    expect(decodeHtmlEntities(undefined)).toBe('');
    expect(decodeHtmlEntities(null)).toBe('');
    expect(decodeHtmlEntities('')).toBe('');
  });

  it('decodes named entities', () => {
    expect(decodeHtmlEntities('a &amp; b &lt;c&gt; &quot;d&quot;')).toBe('a & b <c> "d"');
  });

  it('decodes numeric and hex entities', () => {
    expect(decodeHtmlEntities('&#39;quote&#39; &#x2F;slash&#x2F;')).toBe("'quote' /slash/");
  });

  it('leaves unknown entities intact', () => {
    expect(decodeHtmlEntities('&unknownentity;')).toBe('&unknownentity;');
  });
});

describe('htmlToText', () => {
  it('returns empty string for nullish input', () => {
    expect(htmlToText(undefined)).toBe('');
    expect(htmlToText('')).toBe('');
  });

  it('strips tags and decodes entities', () => {
    expect(htmlToText('<p>Hello <b>world</b> &amp; friends</p>')).toBe('Hello world & friends');
  });

  it('converts <br> and block closes to newlines', () => {
    expect(htmlToText('line1<br>line2')).toBe('line1\nline2');
    expect(htmlToText('<p>a</p><p>b</p>')).toBe('a\nb');
  });

  it('keeps the real href for truncated link text', () => {
    const html = '<a href="https://example.com/very/long/path">example.com/very/lo…</a>';
    expect(htmlToText(html)).toBe('https://example.com/very/long/path');
  });

  it('keeps the visible label for mention/hashtag anchors', () => {
    const mention = '<a href="https://m.social/@bob" class="u-url mention">@bob</a>';
    expect(htmlToText(mention)).toBe('@bob');
  });

  it('keeps inner text when it already matches the href', () => {
    const html = '<a href="https://example.com">https://example.com</a>';
    expect(htmlToText(html)).toBe('https://example.com');
  });

  it('collapses excessive blank lines', () => {
    expect(htmlToText('<p>a</p><br><br><br><p>b</p>')).toBe('a\n\nb');
  });
});
