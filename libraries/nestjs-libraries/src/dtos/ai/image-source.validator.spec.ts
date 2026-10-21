import { describe, expect, it } from 'vitest';
import { IMAGE_SOURCE_MAX_BYTES, isImageSource } from './image-source.validator';

const tinyPng = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64')}`;

describe('isImageSource', () => {
  it('accepts absolute http(s) URLs', () => {
    expect(isImageSource('https://app.postmill.ai/uploads/org/2026/10/20/abc.jpg')).toBe(true);
    expect(isImageSource('http://localhost:4200/uploads/x.png')).toBe(true);
  });

  it('accepts relative /uploads/ paths', () => {
    expect(isImageSource('/uploads/org/2026/10/20/abc123.jpg')).toBe(true);
  });

  it('accepts data:image URIs within the size cap', () => {
    expect(isImageSource(tinyPng)).toBe(true);
    expect(isImageSource('data:image/jpeg;base64,/9j/4AAQ')).toBe(true);
    expect(isImageSource('data:image/webp;base64,UklGRg==')).toBe(true);
  });

  it('rejects non-image data URIs and malformed base64 payloads', () => {
    expect(isImageSource('data:text/html;base64,PHNjcmlwdA==')).toBe(false);
    expect(isImageSource('data:image/svg+xml;base64,PHN2Zz4=')).toBe(false);
    expect(isImageSource('data:image/png;base64,not valid base64!')).toBe(false);
    expect(isImageSource('data:image/png;utf8,<png>')).toBe(false);
  });

  it('rejects data URIs over the size cap without decoding them', () => {
    const oversized = `data:image/png;base64,${'A'.repeat(Math.floor((IMAGE_SOURCE_MAX_BYTES / 3) * 4) + 4)}`;
    expect(isImageSource(oversized)).toBe(false);
  });

  it('rejects traversal-shaped upload paths', () => {
    expect(isImageSource('/uploads/../../etc/passwd')).toBe(false);
    expect(isImageSource('/uploads/')).toBe(false);
  });

  it('rejects everything else', () => {
    expect(isImageSource('ftp://example.com/x.png')).toBe(false);
    expect(isImageSource('example.com/x.png')).toBe(false);
    expect(isImageSource('/other/path.png')).toBe(false);
    expect(isImageSource('')).toBe(false);
    expect(isImageSource(undefined)).toBe(false);
    expect(isImageSource(42)).toBe(false);
  });
});
