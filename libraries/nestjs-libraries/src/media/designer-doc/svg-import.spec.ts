import { describe, it, expect } from 'vitest';
import { parseSvgDocument, svgToPathElements } from './svg-import';

/**
 * Dropping an SVG on the Designer used to produce a RASTER — uploaded, loaded
 * as an `<img>`, placed as an `image` element — so a vector arrived as pixels
 * and could be neither recoloured nor reshaped.
 */

const box = { x: 100, y: 100, width: 200, height: 200 };

describe('parseSvgDocument', () => {
  it('reads the viewBox, and falls back to width/height', () => {
    expect(parseSvgDocument('<svg viewBox="0 0 24 24"></svg>').viewBox).toEqual({
      width: 24,
      height: 24,
    });
    expect(parseSvgDocument('<svg width="48" height="32"></svg>').viewBox).toEqual({
      width: 48,
      height: 32,
    });
    expect(parseSvgDocument('<svg></svg>').viewBox).toBeNull();
  });

  it('translates every primitive, not just <path>', () => {
    const svg = `<svg viewBox="0 0 100 100">
      <path d="M0 0 L10 0 L10 10 Z"/>
      <rect x="0" y="0" width="10" height="10"/>
      <circle cx="50" cy="50" r="20"/>
      <ellipse cx="50" cy="50" rx="20" ry="10"/>
      <line x1="0" y1="0" x2="10" y2="10"/>
      <polyline points="0,0 5,5 10,0"/>
      <polygon points="0,0 10,0 5,10"/>
    </svg>`;
    expect(parseSvgDocument(svg).shapes).toHaveLength(7);
  });

  it('rounds a rect the way the rx/ry attributes ask for', () => {
    const square = parseSvgDocument('<svg><rect width="10" height="10"/></svg>').shapes[0];
    const rounded = parseSvgDocument(
      '<svg><rect width="10" height="10" rx="2"/></svg>'
    ).shapes[0];
    expect(square.nodes).toHaveLength(4);
    expect(rounded.nodes.length).toBeGreaterThan(4);
  });

  it('distinguishes an absent fill from fill="none"', () => {
    // SVG's initial fill is black; `none` means no paint at all, and treating
    // the two alike would flood every stroked outline.
    const [implicit] = parseSvgDocument('<svg><rect width="9" height="9"/></svg>').shapes;
    const [explicit] = parseSvgDocument(
      '<svg><rect width="9" height="9" fill="none" stroke="#ff0000" stroke-width="2"/></svg>'
    ).shapes;
    expect(implicit.fill).toBe('#000000');
    expect(explicit.fill).toBeUndefined();
    expect(explicit.stroke).toBe('#ff0000');
    expect(explicit.strokeWidth).toBe(2);
  });

  it('does not pretend to import what it cannot express', () => {
    const svg = '<svg><text x="0" y="0">hi</text><image href="x.png"/><rect width="9" height="9"/></svg>';
    const result = parseSvgDocument(svg);
    expect(result.shapes).toHaveLength(1);
    expect(result.skipped.sort()).toEqual(['image', 'text']);
  });

  it('ignores a gradient reference rather than filling with the raw url()', () => {
    const [shape] = parseSvgDocument(
      '<svg><rect width="9" height="9" fill="url(#grad)"/></svg>'
    ).shapes;
    expect(shape.fill).toBeUndefined();
  });
});

describe('svgToPathElements', () => {
  it('keeps shapes in the right places relative to each other', () => {
    // Two 10×10 squares at opposite corners of a 100×100 viewBox: after import
    // the second must still be down and to the right of the first.
    const svg = `<svg viewBox="0 0 100 100">
      <rect x="0" y="0" width="10" height="10"/>
      <rect x="90" y="90" width="10" height="10"/>
    </svg>`;
    const { elements } = svgToPathElements(svg, box);
    expect(elements).toHaveLength(2);
    expect(elements[1].x).toBeGreaterThan(elements[0].x);
    expect(elements[1].y).toBeGreaterThan(elements[0].y);
    // Scaled 2× (200px box / 100 viewBox) and anchored at the box origin.
    expect(elements[0].x).toBeCloseTo(100, 3);
    expect(elements[0].width).toBeCloseTo(20, 3);
  });

  it('scales uniformly, so nothing is distorted by a non-square box', () => {
    const svg = '<svg viewBox="0 0 100 100"><rect x="0" y="0" width="50" height="50"/></svg>';
    const { elements } = svgToPathElements(svg, { x: 0, y: 0, width: 400, height: 200 });
    expect(elements[0].width).toBeCloseTo(elements[0].height, 3);
    // Centred on the long axis, like a `contain` fit.
    expect(elements[0].x).toBeCloseTo(100, 3);
  });

  it(`falls back to the shapes own extent when there is no viewBox`, () => {
    const svg = '<svg><rect x="1000" y="1000" width="100" height="100"/></svg>';
    const { elements } = svgToPathElements(svg, box);
    expect(elements).toHaveLength(1);
    expect(elements[0].x).toBeCloseTo(100, 3);
    expect(elements[0].width).toBeCloseTo(200, 3);
  });

  it('returns nothing, and no crash, for a file with no shapes', () => {
    expect(svgToPathElements('<svg></svg>', box).elements).toEqual([]);
    expect(svgToPathElements('not svg at all', box).elements).toEqual([]);
  });
});
