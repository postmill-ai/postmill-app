import { describe, expect, it } from 'vitest';
import { stripHtmlTags } from '@gitroom/helpers/utils/strip.tags';

describe('stripHtmlTags', () => {
  it('removes simple tags', () => {
    expect(stripHtmlTags('<p>hello</p>')).toBe('hello');
  });

  it('removes nested and partial tags that survive a single pass', () => {
    expect(stripHtmlTags('<scr<script>ipt>x')).not.toContain('<');
  });

  it('handles empty/null input', () => {
    expect(stripHtmlTags('')).toBe('');
    expect(stripHtmlTags(null)).toBe('');
    expect(stripHtmlTags(undefined)).toBe('');
  });

  it('returns plain text unchanged', () => {
    expect(stripHtmlTags('plain text')).toBe('plain text');
  });
});
