import { describe, it, expect } from 'vitest';
import { stripHtmlValidation } from './strip.html.validation';

describe('stripHtmlValidation', () => {
  it('decodes &amp; last so a literal &amp;nbsp; stays as &nbsp;', () => {
    expect(stripHtmlValidation('none', '&amp;nbsp;')).toBe('&nbsp;');
  });

  it('still decodes an ordinary &amp; into &', () => {
    expect(stripHtmlValidation('none', 'A &amp; B')).toBe('A & B');
  });

  it('preserves allowed tags in html mode', () => {
    expect(stripHtmlValidation('html', '<p>Hello <strong>world</strong></p>')).toBe(
      '<p>Hello <strong>world</strong></p>'
    );
  });

  it('keeps mention spans long enough for convertMention to run in html mode', () => {
    expect(
      stripHtmlValidation(
        'html',
        '<div><span data-mention-id="u-1">@user</span></div>',
        false,
        false,
        false,
        (id, name) => `@${name} (id:${id})`
      )
    ).toBe('@@user (id:u-1)');
  });

  it('converts headings to markdown', () => {
    expect(stripHtmlValidation('markdown', '<h1>Title</h1>').trim()).toBe('# Title');
  });

  it('normalizes unwrapped text', () => {
    expect(stripHtmlValidation('normal', 'plain text')).toBe('plain text');
  });
});
