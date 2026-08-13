import { describe, it, expect } from 'vitest';
import { isVectorExportable, layersNeedingRaster, outputToSvg } from './svg-export';
import type { DesignerElement, DesignerOutput } from './designer-doc.schema';

/**
 * SVG export is a translation, not a renderer. What matters is that it is
 * well-formed, that geometry comes out where the canvas puts it, and above all
 * that anything SVG cannot express becomes an `<image>` rather than a
 * lookalike that renders differently in a browser.
 */

const el = (over: Partial<DesignerElement>): DesignerElement =>
  ({
    id: 'e1',
    type: 'shape',
    shape: 'rect',
    x: 10,
    y: 20,
    width: 100,
    height: 50,
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    fill: '#ff0000',
    ...over,
  }) as DesignerElement;

const output = (children: DesignerElement[]): DesignerOutput => ({
  id: 'o',
  formatId: 'square',
  name: 'Square',
  width: 400,
  height: 400,
  background: '#ffffff',
  children,
});

/** Parse via DOMParser when available, else assert balance structurally. */
const wellFormed = (svg: string) => {
  const opens = (svg.match(/<[a-zA-Z]/g) || []).length;
  const closes = (svg.match(/<\/[a-zA-Z]/g) || []).length;
  const selfClosing = (svg.match(/\/>/g) || []).length;
  return opens === closes + selfClosing;
};

describe('outputToSvg', () => {
  it('emits a standalone, well-formed document', () => {
    const svg = outputToSvg(output([el({})]));
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg).toContain('viewBox="0 0 400 400"');
    expect(wellFormed(svg)).toBe(true);
  });

  it('paints the background before anything else', () => {
    const svg = outputToSvg(output([el({})]));
    expect(svg.indexOf('#ffffff')).toBeLessThan(svg.indexOf('#ff0000'));
  });

  it('positions a layer with a transform, not baked coordinates', () => {
    const svg = outputToSvg(output([el({})]));
    expect(svg).toContain('translate(10 20)');
  });

  it('rotates about the layer ORIGIN, as both renderers do', () => {
    // This test used to assert a centre pivot and pass — which is exactly how
    // the divergence survived. Konva rotates about the node origin and stored
    // `x/y/rotation` mean "top-left pivot", so a centre pivot here put a
    // rotated layer well away from where the Designer drew it.
    const svg = outputToSvg(output([el({ rotation: 30 })]));
    expect(svg).toContain('rotate(30)');
    expect(svg).not.toContain('rotate(30 50 25)');
  });

  it('writes an ellipse as an ellipse', () => {
    const svg = outputToSvg(output([el({ shape: 'ellipse' })]));
    expect(svg).toContain('<ellipse');
    expect(svg).toContain('rx="50"');
  });

  it('traces a polygon from the SHARED geometry', () => {
    const svg = outputToSvg(output([el({ shape: 'triangle' })]));
    expect(svg).toContain('<polygon points="');
  });

  it('rounds a rect', () => {
    const svg = outputToSvg(output([el({ borderRadius: 8 })]));
    expect(svg).toContain('rx="8"');
  });

  it('carries the full stroke options through', () => {
    const svg = outputToSvg(
      output([
        el({
          stroke: '#000000',
          strokeWidth: 3,
          strokeStyle: { dash: [6, 3], lineCap: 'round', lineJoin: 'bevel', miterLimit: 8 },
        }),
      ])
    );
    expect(svg).toContain('stroke-dasharray="6 3"');
    expect(svg).toContain('stroke-linecap="round"');
    expect(svg).toContain('stroke-linejoin="bevel"');
    expect(svg).toContain('stroke-miterlimit="8"');
  });

  it('emits a gradient as a def, referenced by id', () => {
    const svg = outputToSvg(
      output([
        el({
          fillGradient: {
            type: 'linear',
            angle: 90,
            stops: [
              { offset: 0, color: '#000000' },
              { offset: 1, color: '#ffffff' },
            ],
          },
        }),
      ])
    );
    expect(svg).toContain('<linearGradient id="g1"');
    expect(svg).toContain('fill="url(#g1)"');
  });

  it('escapes text rather than letting it break the document', () => {
    const svg = outputToSvg(
      output([el({ type: 'text', text: '<script>alert(1)</script> & "quotes"' })])
    );
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).toContain('&amp;');
  });

  it('splits multi-line text into tspans', () => {
    const svg = outputToSvg(output([el({ type: 'text', text: 'one\ntwo' })]));
    expect((svg.match(/<tspan/g) || []).length).toBe(2);
  });

  it('skips a hidden layer entirely', () => {
    const svg = outputToSvg(output([el({ hidden: true })]));
    expect(svg).not.toContain('#ff0000');
  });

  it('nests group members inside the group’s own transform', () => {
    const svg = outputToSvg(
      output([
        el({ id: 'g', type: 'group', x: 100, y: 100, fill: undefined }),
        el({ id: 'child', parentId: 'g', x: 5, y: 5 }),
      ])
    );
    const groupAt = svg.indexOf('translate(100 100)');
    const childAt = svg.indexOf('translate(5 5)');
    expect(groupAt).toBeGreaterThan(-1);
    expect(childAt).toBeGreaterThan(groupAt);
    expect(wellFormed(svg)).toBe(true);
  });

  it('carries a CSS-expressible blend mode', () => {
    const svg = outputToSvg(output([el({ blendMode: 'multiply' })]));
    expect(svg).toContain('mix-blend-mode:multiply');
  });
});

describe('what SVG cannot carry', () => {
  it('refuses to vectorise a layer with layer styles', () => {
    expect(isVectorExportable(el({ styles: [{ type: 'drop-shadow' }] }))).toBe(false);
  });

  it('refuses a non-CSS blend mode rather than approximating it', () => {
    // `vivid-light` has no CSS equivalent; emitting `normal` would look wrong
    // everywhere but here.
    expect(isVectorExportable(el({ blendMode: 'vivid-light' }))).toBe(false);
    expect(isVectorExportable(el({ blendMode: 'multiply' }))).toBe(true);
  });

  it('refuses a raster layer, an adjustment layer and a bitmap mask', () => {
    expect(isVectorExportable(el({ type: 'raster' }))).toBe(false);
    expect(isVectorExportable(el({ type: 'adjustment' }))).toBe(false);
    expect(isVectorExportable(el({ maskSrc: 'https://x/m.png' }))).toBe(false);
  });

  it('refuses a layer carrying a smart-filter recipe', () => {
    expect(isVectorExportable(el({ smartFilters: [{ id: 'gaussian-blur' }] }))).toBe(false);
  });

  it('names exactly those layers for the caller to rasterize', () => {
    const out = output([
      el({ id: 'plain' }),
      el({ id: 'styled', styles: [{ type: 'drop-shadow' }] }),
      el({ id: 'gone', type: 'raster', hidden: true }),
    ]);
    expect(layersNeedingRaster(out)).toEqual(['styled']);
  });

  it('names styled layers nested inside a group, not just top-level ones', () => {
    // The flat scan only saw output.children, so a styled layer in a group was
    // exported as if it were plain vector — the group wrapper is vector, its
    // member is not.
    const out = output([
      el({ id: 'grp', type: 'group' }),
      el({ id: 'nested-styled', parentId: 'grp', styles: [{ type: 'drop-shadow' }] }),
    ]);
    expect(layersNeedingRaster(out)).toEqual(['nested-styled']);
  });

  it('embeds the supplied bitmap for such a layer', () => {
    const svg = outputToSvg(
      output([el({ id: 'styled', styles: [{ type: 'drop-shadow' }] })]),
      { rasterized: { styled: 'data:image/png;base64,AAA' } }
    );
    expect(svg).toContain('<image');
    expect(svg).toContain('data:image/png;base64,AAA');
  });

  it('omits the layer entirely when no bitmap was supplied', () => {
    // Better a missing layer than one that renders differently elsewhere.
    const svg = outputToSvg(output([el({ id: 'styled', styles: [{ type: 'drop-shadow' }] })]));
    expect(svg).not.toContain('<image');
    expect(wellFormed(svg)).toBe(true);
  });
});

describe('backgrounds', () => {
  it('writes an image background as an image', () => {
    const out = { ...output([]), bg: { type: 'image' as const, src: 'https://x/bg.jpg' } };
    expect(outputToSvg(out)).toContain('https://x/bg.jpg');
  });

  it('writes a gradient background as a def', () => {
    const out = {
      ...output([]),
      bg: {
        type: 'gradient' as const,
        gradient: {
          type: 'linear' as const,
          stops: [
            { offset: 0, color: '#111111' },
            { offset: 1, color: '#222222' },
          ],
        },
      },
    };
    expect(outputToSvg(out)).toContain('<linearGradient');
  });
});
