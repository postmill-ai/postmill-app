import { describe, it, expect } from 'vitest';
import {
  isSvgMarkupSrc,
  renderableSrc,
  wrapIconSvgDataUrl,
} from './svg-src';

describe('isSvgMarkupSrc', () => {
  it('detects raw SVG markup', () => {
    expect(isSvgMarkupSrc('<path d="M0 0h1v1z"/>')).toBe(true);
    expect(isSvgMarkupSrc('  <circle cx="1" cy="1" r="1"/>')).toBe(true);
  });

  it('passes URLs through as not-markup', () => {
    expect(isSvgMarkupSrc('data:image/svg+xml,%3Csvg%3E')).toBe(false);
    expect(isSvgMarkupSrc('https://api.iconify.design/mdi/rocket.svg')).toBe(
      false
    );
    expect(isSvgMarkupSrc('http://localhost:3000/uploads/a.png')).toBe(false);
  });
});

describe('wrapIconSvgDataUrl', () => {
  it('wraps the body with viewBox, size and fill, URL-encoded', () => {
    const url = wrapIconSvgDataUrl('<path d="M0 0h1v1z"/>', 120, 120, '#2B5CD3');
    expect(url.startsWith('data:image/svg+xml,')).toBe(true);
    const svg = decodeURIComponent(url.slice('data:image/svg+xml,'.length));
    expect(svg).toContain('viewBox="0 0 24 24"');
    expect(svg).toContain('width="120"');
    expect(svg).toContain('height="120"');
    expect(svg).toContain('fill="#2B5CD3"');
    expect(svg).toContain('<path d="M0 0h1v1z"/>');
  });

  it('defaults fill to black, matching the client IconNode', () => {
    const url = wrapIconSvgDataUrl('<rect width="1" height="1"/>', 10, 10);
    expect(decodeURIComponent(url)).toContain('fill="#000000"');
  });
});

describe('renderableSrc', () => {
  it('wraps raw SVG only for icon elements', () => {
    const icon = renderableSrc({
      type: 'icon',
      src: '<path d="M0 0h1v1z"/>',
      width: 48,
      height: 48,
      fill: '#fff',
    });
    expect(icon?.startsWith('data:image/svg+xml,')).toBe(true);

    const image = renderableSrc({
      type: 'image',
      src: '<path d="M0 0h1v1z"/>',
      width: 48,
      height: 48,
    });
    expect(image).toBe('<path d="M0 0h1v1z"/>');
  });

  it('passes URL srcs through unchanged', () => {
    expect(
      renderableSrc({
        type: 'icon',
        src: 'https://api.iconify.design/mdi/rocket.svg',
        width: 48,
        height: 48,
      })
    ).toBe('https://api.iconify.design/mdi/rocket.svg');
    expect(renderableSrc({ type: 'icon', width: 48, height: 48 })).toBeUndefined();
  });
});
