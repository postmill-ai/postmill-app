import { describe, it, expect } from 'vitest';
import { markdownToHtml } from './markdown-lite';

describe('markdownToHtml', () => {
  it('renders bold, italic, and code', () => {
    expect(markdownToHtml('**bold** and *em* and `code`')).toBe(
      '<p><strong>bold</strong> and <em>em</em> and <code>code</code></p>'
    );
  });

  it('keeps bold/italic markers inside code spans literal', () => {
    expect(markdownToHtml('run `a ** b` now')).toBe(
      '<p>run <code>a ** b</code> now</p>'
    );
    expect(markdownToHtml('`*not em*`')).toBe('<p><code>*not em*</code></p>');
  });

  it('keeps snake_case inside code spans untouched', () => {
    expect(markdownToHtml('`snake_case_name`')).toBe(
      '<p><code>snake_case_name</code></p>'
    );
  });

  it('does not italicize snake_case outside code', () => {
    expect(markdownToHtml('call my_var_name here')).toBe(
      '<p>call my_var_name here</p>'
    );
  });

  it('still italicizes whole underscore-wrapped words', () => {
    expect(markdownToHtml('this is _important_')).toBe(
      '<p>this is <em>important</em></p>'
    );
  });

  it('restricts links to http(s) URLs', () => {
    expect(markdownToHtml('[x](https://example.com)')).toBe(
      '<p><a href="https://example.com" target="_blank" rel="noopener noreferrer">x</a></p>'
    );
    expect(markdownToHtml('[x](javascript:alert(1))')).toBe(
      '<p>[x](javascript:alert(1))</p>'
    );
  });

  it('escapes HTML before building tags', () => {
    expect(markdownToHtml('<script>alert(1)</script>')).toBe(
      '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>'
    );
    expect(markdownToHtml('`<b>`')).toBe('<p><code>&lt;b&gt;</code></p>');
  });

  it('does not ReDoS on unclosed bracket pumps', () => {
    const pump = '['.repeat(50000);
    const start = performance.now();
    const result = markdownToHtml(pump);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50);
    expect(result).toBe(`<p>${pump}</p>`);
  });

  it('does not ReDoS on repeated malformed link pumps', () => {
    // Calibrated to stay well under a CI-safe bound while still representing
    // the original 20000-repeat pump that blocked for seconds with the old regex.
    const pump = '[x](http://a'.repeat(2000);
    const start = performance.now();
    const result = markdownToHtml(pump);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(200);
    expect(result).toBe(`<p>${pump}</p>`);
  });

  it('still links well-formed URLs after the regex hardening', () => {
    expect(markdownToHtml('[a](https://b)')).toBe(
      '<p><a href="https://b" target="_blank" rel="noopener noreferrer">a</a></p>'
    );
  });
});
