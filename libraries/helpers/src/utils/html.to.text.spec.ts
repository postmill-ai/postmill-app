import { describe, it, expect } from 'vitest';
import { decodeHtmlEntities, htmlToText } from './html.to.text';

describe('decodeHtmlEntities', () => {
  it('decodes named and numeric entities', () => {
    expect(decodeHtmlEntities('&gt;&amp;&#39;&#x27;')).toBe(">&''");
  });

  it('leaves unknown entities intact', () => {
    expect(decodeHtmlEntities('&unknown;')).toBe('&unknown;');
  });
});

describe('htmlToText', () => {
  it('converts breaks and block closers to newlines and strips tags', () => {
    expect(htmlToText('<p>one<br>two</p><p>three</p>')).toBe(
      'one\ntwo\nthree'
    );
  });

  it('keeps the real href for truncated anchors', () => {
    expect(
      htmlToText(
        '<a href="https://example.com/very/long/path">example.com/very/lo…</a>'
      )
    ).toBe('https://example.com/very/long/path');
  });

  it('keeps the label for mention anchors', () => {
    expect(
      htmlToText('<a href="https://social/@user" class="u-url mention">@user</a>')
    ).toBe('@user');
  });

  it('strips nested/split tag fragments to a fixpoint', () => {
    // A single-pass strip would turn "<scr<b>ipt>" into "<script>".
    expect(htmlToText('a<scr<b>ipt>alert(1)</scr</b>ipt>b')).not.toContain(
      '<script>'
    );
    expect(htmlToText('<<i>b</i>>x')).toBe('b>x');
  });

  it('returns empty string for null/undefined', () => {
    expect(htmlToText(null)).toBe('');
    expect(htmlToText(undefined)).toBe('');
  });
});
