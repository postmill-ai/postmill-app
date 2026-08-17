import { describe, it, expect, vi } from 'vitest';
import sharp from 'sharp';

// The unreachable-mask test below asserts the renderer's behaviour when a remote
// mask fails to load. Left unmocked it reaches safeFetch, whose SSRF guard does an
// unbounded DNS lookup — fast locally, but slow enough on a CI runner under
// coverage instrumentation to blow vitest's 5s per-test budget. Failing the fetch
// here keeps the assertion identical and makes the timing deterministic.
vi.mock('@postmill-ai/nestjs-libraries/dtos/webhooks/safe.fetch', () => ({
  safeFetch: vi.fn(async () => {
    throw new Error('network disabled in tests');
  }),
}));

import { DesignRenderService } from './design-render.service';

class FakeFontLoaderService {
  async loadOrgFonts(_orgId?: string) {
    // no-op
  }
  async loadCuratedFonts(_children: unknown[]) {
    // no-op
  }
}

const makeService = () =>
  new DesignRenderService(new FakeFontLoaderService() as any);

const makeDoc = (): any => ({
  version: 2,
  mode: 'image',
  outputs: [
    {
      id: 'out-1',
      formatId: 'square',
      name: 'Square',
      width: 200,
      height: 200,
      background: '#ff0000',
      children: [],
    },
    {
      id: 'out-2',
      formatId: 'story',
      name: 'Story',
      width: 200,
      height: 400,
      background: '#00ff00',
      children: [],
    },
  ],
});

describe('DesignRenderService', () => {
  it('survives pathologically deep group nesting', async () => {
    // One page-size buffer per nesting level, and nesting is unbounded in the
    // document: each Group Layers wraps the previous group, so a deep chain is
    // trivial to author. Past the cap members draw inline instead.
    const service = makeService();
    const depth = 60;
    const children: any[] = [];
    for (let i = 0; i < depth; i++) {
      children.push({
        id: `g${i}`, type: 'group', name: `G${i}`,
        x: 0, y: 0, width: 0, height: 0,
        rotation: 0, opacity: 1, locked: false, hidden: false,
        parentId: i === 0 ? undefined : `g${i - 1}`,
      });
    }
    children.push({
      id: 'leaf', type: 'shape', shape: 'rect', parentId: `g${depth - 1}`,
      x: 10, y: 10, width: 80, height: 80,
      rotation: 0, opacity: 1, locked: false, hidden: false, fill: '#ff0000',
    });

    const doc: any = {
      version: 4, mode: 'image',
      outputs: [{
        id: 'out-1', formatId: 'square', name: 'Square',
        width: 100, height: 100, background: '#ffffff', children,
      }],
    };

    const png = await service.renderPage(doc, 0, { pixelRatio: 1 });
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const i = (50 * info.width + 50) * info.channels;
    // The deeply nested leaf still renders.
    expect(data[i]).toBeGreaterThan(200);
    expect(data[i + 1]).toBeLessThan(60);
  });

  it('composites a painted layer mask, hiding where the mask is black', async () => {
    // A 1x2 mask: left half transparent (hides), right half opaque (reveals).
    const raw = Buffer.alloc(2 * 1 * 4);
    raw[3] = 0;    // left pixel alpha
    raw[7] = 255;  // right pixel alpha
    raw[4] = raw[5] = raw[6] = 255;
    const maskPng = await sharp(raw, { raw: { width: 2, height: 1, channels: 4 } })
      .png()
      .toBuffer();

    const service = makeService();
    const doc: any = {
      version: 5,
      mode: 'image',
      outputs: [
        {
          id: 'o', formatId: 'square', name: 'S',
          width: 100, height: 100, background: '#ffffff',
          children: [
            {
              id: 'masked', type: 'shape', shape: 'rect',
              x: 0, y: 0, width: 100, height: 100,
              rotation: 0, opacity: 1, locked: false, hidden: false,
              fill: '#ff0000',
              maskSrc: `data:image/png;base64,${maskPng.toString('base64')}`,
            },
          ],
        },
      ],
    };

    const png = await service.renderPage(doc, 0, { pixelRatio: 1 });
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const at = (x: number, y: number) => {
      const i = (y * info.width + x) * info.channels;
      return [data[i], data[i + 1], data[i + 2]];
    };

    // Left half masked out -> the white background shows through.
    expect(at(20, 50)[0]).toBeGreaterThan(200);
    expect(at(20, 50)[1]).toBeGreaterThan(200);
    // Right half revealed -> red.
    expect(at(80, 50)[0]).toBeGreaterThan(200);
    expect(at(80, 50)[1]).toBeLessThan(80);
  });

  it('draws the layer unmasked rather than erasing it when the mask cannot load', async () => {
    const service = makeService();
    const doc: any = {
      version: 5,
      mode: 'image',
      outputs: [
        {
          id: 'o', formatId: 'square', name: 'S',
          width: 50, height: 50, background: '#ffffff',
          children: [
            {
              id: 'masked', type: 'shape', shape: 'rect',
              x: 0, y: 0, width: 50, height: 50,
              rotation: 0, opacity: 1, locked: false, hidden: false,
              fill: '#0000ff',
              maskSrc: 'https://unreachable.invalid/mask.png',
            },
          ],
        },
      ],
    };

    const png = await service.renderPage(doc, 0, { pixelRatio: 1 });
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const i = (25 * info.width + 25) * info.channels;
    // Blue, not white — a missing mask must not silently delete the layer.
    expect(data[i + 2]).toBeGreaterThan(200);
    expect(data[i]).toBeLessThan(80);
  });

  it('keeps a blend mode working on a layer that also has a layer style', async () => {
    // A styled layer is rendered into an offscreen buffer so its effects can
    // read its silhouette. Compositing that buffer back with a plain drawImage
    // drops the layer's own blend mode, so `multiply` silently rendered as
    // `normal` for any layer carrying an effect.
    const service = makeService();
    const doc = (blendMode?: string): any => ({
      version: 4,
      mode: 'image',
      outputs: [
        {
          id: 'out-1', formatId: 'square', name: 'Square',
          width: 100, height: 100, background: '#ffffff',
          children: [
            {
              id: 'base', type: 'shape', shape: 'rect',
              x: 0, y: 0, width: 100, height: 100,
              rotation: 0, opacity: 1, locked: false, hidden: false, fill: '#3a7bd5',
            },
            {
              id: 'top', type: 'shape', shape: 'rect',
              x: 20, y: 20, width: 60, height: 60,
              rotation: 0, opacity: 1, locked: false, hidden: false, fill: '#808080',
              blendMode,
              styles: [{ type: 'drop-shadow', color: '#000000', distance: 2, size: 2 }],
            },
          ],
        },
      ],
    });

    const centre = async (blendMode?: string) => {
      const png = await service.renderPage(doc(blendMode), 0, { pixelRatio: 1 });
      const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const i = (50 * info.width + 50) * info.channels;
      return [data[i], data[i + 1], data[i + 2]];
    };

    const plain = await centre(undefined);
    const multiplied = await centre('multiply');

    // Normal: the layer's own grey. Multiply against the blue below: darker on
    // every channel, and no longer neutral.
    expect(plain[0]).toBeGreaterThan(120);
    expect(multiplied[0]).toBeLessThan(plain[0]);
    expect(multiplied[1]).toBeLessThan(plain[1]);
    expect(multiplied[2]).toBeLessThan(plain[2]);
  });

  it('renders a warped shape deformed, and an unwarped one exactly as before', async () => {
    const service = makeService();
    const doc = (warp?: any): any => ({
      version: 4,
      mode: 'image',
      outputs: [
        {
          id: 'out-1', formatId: 'square', name: 'Square',
          width: 120, height: 120, background: '#ffffff',
          children: [
            {
              id: 'band', type: 'shape', shape: 'rect',
              x: 10, y: 50, width: 100, height: 20,
              rotation: 0, opacity: 1, locked: false, hidden: false,
              fill: '#000000', warp,
            },
          ],
        },
      ],
    });

    const png = async (warp?: any) => service.renderPage(doc(warp), 0, { pixelRatio: 1 });
    const inkTop = async (warp?: any) => {
      const { data, info } = await sharp(await png(warp)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      for (let y = 0; y < info.height; y++) {
        for (let x = 0; x < info.width; x++) {
          if (data[(y * info.width + x) * info.channels] < 128) return y;
        }
      }
      return -1;
    };

    // Unwarped: a plain band starting at its box top.
    expect(await inkTop(undefined)).toBe(50);
    // A preset with no bend is the identity — byte-for-byte the same render.
    expect(Buffer.compare(await png(undefined), await png({ preset: 'arc', bend: 0 }))).toBe(0);
    // Arched: the middle of the band lifts above the box.
    expect(await inkTop({ preset: 'arc', bend: 60 })).toBeLessThan(50);
  });

  it('rotates about the element origin, the way the canvas does', async () => {
    // Konva rotates about the node's x/y and nothing sets an offset, so that is
    // what a stored rotation has always meant. The server pivoted on the centre
    // instead, putting a 45° element ~158px from where it was authored — and
    // every other fixture in this file uses rotation 0, which is why nobody saw
    // it. These assert the geometry directly rather than eyeballing a render.
    const service = makeService();
    const doc = (rotation: number): any => ({
      version: 4,
      mode: 'image',
      outputs: [
        {
          id: 'out-1', formatId: 'square', name: 'Square',
          width: 400, height: 400, background: '#ffffff',
          children: [
            {
              id: 'r', type: 'shape', shape: 'rect',
              x: 100, y: 100, width: 200, height: 40,
              rotation, opacity: 1, locked: false, hidden: false, fill: '#000000',
            },
          ],
        },
      ],
    });

    const inkBox = async (rotation: number) => {
      const png = await service.renderPage(doc(rotation), 0, { pixelRatio: 1 });
      const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      let minX = Infinity, maxX = -1, minY = Infinity, maxY = -1;
      for (let y = 0; y < info.height; y++) {
        for (let x = 0; x < info.width; x++) {
          if (data[(y * info.width + x) * info.channels] < 128) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      return { minX, maxX, minY, maxY };
    };

    // Unrotated: exactly its box.
    const flat = await inkBox(0);
    expect(flat.minX).toBe(100);
    expect(flat.minY).toBe(100);

    // 90°: pivoting on the ORIGIN sweeps the bar down-left from (100,100), so
    // it occupies x 60..100, y 100..300. Pivoting on the centre would instead
    // leave it centred on (200,120) — a completely different place.
    const right = await inkBox(90);
    expect(right.minY).toBe(100);
    expect(right.maxY).toBeGreaterThanOrEqual(295);
    expect(right.maxX).toBeLessThanOrEqual(105);

    // 45°: the top-left corner stays pinned wherever the pivot is correct.
    const diagonal = await inkBox(45);
    expect(Math.abs(diagonal.minX - 71)).toBeLessThanOrEqual(3);
    expect(Math.abs(diagonal.minY - 100)).toBeLessThanOrEqual(3);
  });

  it('condenses text horizontally without changing its height', async () => {
    // No catalog font is narrow enough for some lockups, so `textScaleX` is the
    // only way to match one. The server has to squeeze the same way the canvas
    // does or the export undoes the design.
    const service = makeService();
    const doc = (textScaleX?: number): any => ({
      version: 4,
      mode: 'image',
      outputs: [
        {
          id: 'out-1', formatId: 'square', name: 'Square',
          width: 200, height: 100, background: '#ffffff',
          children: [
            {
              id: 't', type: 'text',
              x: 0, y: 0, width: 200, height: 100,
              rotation: 0, opacity: 1, locked: false, hidden: false,
              text: 'HHHH', fontSize: 60, fontFamily: 'sans-serif',
              fill: '#000000', align: 'left', textScaleX,
            },
          ],
        },
      ],
    });

    const inkBox = async (textScaleX?: number) => {
      const png = await service.renderPage(doc(textScaleX), 0, { pixelRatio: 1 });
      const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      let minX = Infinity, maxX = -1, minY = Infinity, maxY = -1;
      for (let y = 0; y < info.height; y++) {
        for (let x = 0; x < info.width; x++) {
          const i = (y * info.width + x) * info.channels;
          if (data[i] < 128) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      return { width: maxX - minX + 1, height: maxY - minY + 1, left: minX };
    };

    const plain = await inkBox(undefined);
    const condensed = await inkBox(0.5);

    expect(plain.width).toBeGreaterThan(0);
    // Half the width, same cap height, still starting at the same left edge.
    expect(condensed.width / plain.width).toBeGreaterThan(0.4);
    expect(condensed.width / plain.width).toBeLessThan(0.6);
    expect(Math.abs(condensed.height - plain.height)).toBeLessThanOrEqual(1);
    // Left-aligned from the same box edge. The ink starts a couple of px later
    // than the box because of the glyph's side bearing, and that bearing
    // condenses along with everything else.
    expect(Math.abs(condensed.left - plain.left)).toBeLessThanOrEqual(4);
  });

  it('paints every layer style, not just the three Konva could express', async () => {
    // Seven of the ten used to be inert on the canvas: `layerStyleProps` mapped
    // drop shadow, stroke and colour overlay and deferred the rest to a
    // component that did not exist. Both renderers now call the same shared
    // painter, so each of these has to leave a mark here AND on the canvas.
    const service = makeService();
    const doc = (styles?: any[]): any => ({
      version: 4,
      mode: 'image',
      outputs: [
        {
          id: 'out-1', formatId: 'square', name: 'Square',
          width: 100, height: 100, background: '#ffffff',
          children: [
            {
              id: 'box', type: 'shape', shape: 'rect',
              x: 20, y: 20, width: 60, height: 60,
              rotation: 0, opacity: 1, locked: false, hidden: false, fill: '#808080',
              styles,
            },
          ],
        },
      ],
    });

    const pixels = async (styles?: any[]) => {
      const png = await service.renderPage(doc(styles), 0, { pixelRatio: 1 });
      const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      return { data, info };
    };
    const at = (buf: any, x: number, y: number) => {
      const i = (y * buf.info.width + x) * buf.info.channels;
      return [buf.data[i], buf.data[i + 1], buf.data[i + 2]];
    };

    const plain = await pixels(undefined);
    // Inside the box, well clear of every edge effect.
    expect(at(plain, 50, 50)[0]).toBeGreaterThan(120);

    // Overlays and inner effects recolour inside the silhouette.
    for (const style of [
      { type: 'color-overlay', color: '#ff0000', opacity: 1 },
      { type: 'gradient-overlay', opacity: 1, angle: 90, gradient: { type: 'linear', stops: [{ offset: 0, color: '#ff0000' }, { offset: 1, color: '#ff0000' }] } },
      { type: 'pattern-overlay', opacity: 1, pattern: { preset: 'dots', scale: 1, color: '#ff0000', background: '#ff0000' } },
    ]) {
      const out = await pixels([style]);
      const [r, g, b] = at(out, 50, 50);
      expect(r, `${style.type} should paint red inside the layer`).toBeGreaterThan(150);
      expect(g).toBeLessThan(120);
      expect(b).toBeLessThan(120);
    }

    // Inner shadow and inner glow darken/lighten just inside the edge.
    const innerShadow = await pixels([
      { type: 'inner-shadow', color: '#000000', opacity: 1, distance: 0, size: 10 },
    ]);
    expect(at(innerShadow, 24, 50)[0]).toBeLessThan(at(plain, 24, 50)[0]);

    const innerGlow = await pixels([
      { type: 'inner-glow', color: '#ffffff', opacity: 1, size: 10 },
    ]);
    expect(at(innerGlow, 24, 50)[0]).toBeGreaterThan(at(plain, 24, 50)[0]);

    // Outer glow reaches OUTSIDE the box, where the page is otherwise white.
    const outerGlow = await pixels([
      { type: 'outer-glow', color: '#ff0000', opacity: 1, size: 12, spread: 60 },
    ]);
    const outside = at(outerGlow, 14, 50);
    expect(outside[1], 'outer glow should tint the page beside the layer').toBeLessThan(240);

    // Bevel lightens the highlight side.
    const bevel = await pixels([
      { type: 'bevel-emboss', opacity: 1, depth: 400, angle: 120, highlightColor: '#ffffff' },
    ]);
    expect(at(bevel, 24, 50)[0]).toBeGreaterThan(at(plain, 24, 50)[0]);

    // Satin is documented as rendering like a second inner shadow; pin that so
    // the simplification is a decision rather than a surprise.
    const satin = await pixels([
      { type: 'satin', color: '#000000', opacity: 1, distance: 6, size: 10 },
    ]);
    expect(at(satin, 24, 50)[0]).toBeLessThan(at(plain, 24, 50)[0]);
  });

  it('clips an adjustment to the base layer\'s pixels, not its bounding box', async () => {
    // The Designer canvas clips by filtering the base layer's own cached
    // bitmap, so an ellipse's transparent bbox corners keep the backdrop. The
    // server has to agree or the exported PNG stops matching the canvas.
    const service = makeService();
    const doc: any = {
      version: 4,
      mode: 'image',
      outputs: [
        {
          id: 'out-1',
          formatId: 'square',
          name: 'Square',
          width: 200,
          height: 200,
          background: '#ffffff',
          children: [
            {
              id: 'base', type: 'shape', shape: 'rect',
              x: 0, y: 0, width: 200, height: 200,
              rotation: 0, opacity: 1, locked: false, hidden: false, fill: '#000000',
            },
            {
              id: 'disc', type: 'shape', shape: 'ellipse',
              x: 40, y: 40, width: 120, height: 120,
              rotation: 0, opacity: 1, locked: false, hidden: false, fill: '#000000',
            },
            {
              id: 'adj', type: 'adjustment', name: 'Invert',
              x: 0, y: 0, width: 0, height: 0,
              rotation: 0, opacity: 1, locked: false, hidden: false,
              clipped: true, adjustment: { type: 'invert' },
            },
          ],
        },
      ],
    };

    const png = await service.renderPage(doc, 0, { pixelRatio: 1 });
    const { data, info } = await sharp(png)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const at = (x: number, y: number) => {
      const i = (y * info.width + x) * info.channels;
      return [data[i], data[i + 1], data[i + 2]];
    };

    // Centre of the disc: inverted black -> white.
    expect(at(100, 100)[0]).toBeGreaterThan(200);
    // Inside the disc's bounding box but outside the disc itself: untouched.
    expect(at(45, 45)[0]).toBeLessThan(55);
    // Well outside: untouched.
    expect(at(10, 10)[0]).toBeLessThan(55);
  });

  it('renders a contact sheet as a PNG buffer', async () => {
    const service = makeService();
    const sheet = await service.renderContactSheet(makeDoc());

    expect(Buffer.isBuffer(sheet)).toBe(true);
    expect(sheet.length).toBeGreaterThan(0);
    expect(sheet.toString('hex', 0, 8)).toBe('89504e470d0a1a0a');
  });

  it('renders all pages', async () => {
    const service = makeService();
    const pages = await service.renderAllPages(makeDoc());

    expect(pages).toHaveLength(2);
    for (const page of pages) {
      expect(Buffer.isBuffer(page)).toBe(true);
      expect(page.toString('hex', 0, 8)).toBe('89504e470d0a1a0a');
    }
  });

  it('cover-crops image backgrounds instead of stretching them', async () => {
    const service = makeService();
    // 400x200 source into a 200x200 output: cover keeps the full height and
    // crops 100px from each side (centered).
    (service as any).loadImageSafe = async () => ({ width: 400, height: 200 });

    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      drawImage: vi.fn(),
      fillRect: vi.fn(),
    };
    await (service as any).drawBackground(ctx, {
      width: 200,
      height: 200,
      bg: { type: 'image', src: 'https://example.com/bg.png' },
    });

    expect(ctx.drawImage).toHaveBeenCalledWith(
      expect.anything(),
      100, 0, 200, 200,
      0, 0, 200, 200
    );
  });

  it('cover-crops tall image backgrounds toward the vertical center', async () => {
    const service = makeService();
    // 200x400 source into a 200x200 output: crop 100px from top and bottom.
    (service as any).loadImageSafe = async () => ({ width: 200, height: 400 });

    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      drawImage: vi.fn(),
      fillRect: vi.fn(),
    };
    await (service as any).drawBackground(ctx, {
      width: 200,
      height: 200,
      bg: { type: 'image', src: 'https://example.com/bg.png' },
    });

    expect(ctx.drawImage).toHaveBeenCalledWith(
      expect.anything(),
      0, 100, 200, 200,
      0, 0, 200, 200
    );
  });
});

describe('DesignRenderService.auditTextContrast', () => {
  // Tiny canvas keeps the render + sharp sampling fast.
  const textEl = (fill: string, box: Record<string, number> = {}): any => ({
    id: 't1',
    originId: 'headline',
    type: 'text',
    x: 20,
    y: 20,
    width: 160,
    height: 80,
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    text: 'Hi',
    fontSize: 40,
    fill,
    ...box,
  });

  const gradientDoc = (fill: string, children?: any[]): any => ({
    version: 2,
    mode: 'image',
    outputs: [
      {
        id: 'o1',
        formatId: 'square',
        name: 'Sq',
        width: 200,
        height: 200,
        background: '#ffffff',
        // A bright gradient counts as imagery — sampled from the render.
        bg: {
          type: 'gradient',
          gradient: {
            type: 'linear',
            angle: 90,
            stops: [
              { color: '#ffffff', offset: 0 },
              { color: '#e8e8e8', offset: 1 },
            ],
          },
        },
        children: children ?? [textEl(fill)],
      },
    ],
  });

  // A backdrop painted from a data-URL PNG: `bg.type === 'image'` is what
  // makes the audit sample the render at all.
  const imageBgDoc = async (
    fill: string,
    pixels: (x: number, y: number) => [number, number, number],
    children?: any[]
  ) => {
    const size = 200;
    const raw = Buffer.alloc(size * size * 3);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const [r, g, b] = pixels(x, y);
        const i = (y * size + x) * 3;
        raw[i] = r;
        raw[i + 1] = g;
        raw[i + 2] = b;
      }
    }
    const png = await sharp(raw, {
      raw: { width: size, height: size, channels: 3 },
    })
      .png()
      .toBuffer();
    const doc = gradientDoc(fill, children);
    doc.outputs[0].bg = {
      type: 'image',
      src: `data:image/png;base64,${png.toString('base64')}`,
    };
    return doc;
  };

  // Deterministic 1px checkerboard — an exact 50/50 split, so the mean is
  // predictable while the per-channel stdev and the edge energy are both
  // enormous. `dark`/`light` tune where the MEAN (and so the ratio) lands.
  const checker =
    (dark: number, light: number) =>
    (x: number, y: number): [number, number, number] => {
      const v = (x + y) % 2 === 0 ? dark : light;
      return [v, v, v];
    };

  // SPATIALLY VARYING backdrop: 1px checkerboard above `splitY`, flat mid grey
  // (the checkerboard's own mean) below it. Both halves share a mean, so only
  // a sampler that actually honours the per-element crop can tell them apart.
  // A uniform fixture cannot — which is exactly why the whole suite passed
  // while `.extract().stats()` was silently measuring the whole page.
  const halfBusy =
    (dark: number, light: number, splitY = 100) =>
    (x: number, y: number): [number, number, number] => {
      const flat = Math.round((dark + light) / 2);
      const v = y < splitY ? ((x + y) % 2 === 0 ? dark : light) : flat;
      return [v, v, v];
    };

  const flat =
    (level: number) =>
    (): [number, number, number] =>
      [level, level, level];

  // SPATIALLY VARYING the other way: a busy 1px checkerboard confined to the
  // horizontal band the GLYPHS occupy, flat mid grey everywhere else. Over the
  // whole text box the band is a fifth of the pixels and averages away; under
  // the ink it is the entire backdrop. A uniform fixture cannot tell the two
  // measurements apart — which is exactly why the box measure went unnoticed.
  const glyphBand =
    (dark: number, light: number, band: [number, number] = [24, 64]) =>
    (x: number, y: number): [number, number, number] => {
      const flatLevel = Math.round((dark + light) / 2);
      const inBand = y >= band[0] && y < band[1] && x >= 10 && x < 150;
      const v = inBand ? ((x + y) % 2 === 0 ? dark : light) : flatLevel;
      return [v, v, v];
    };

  it('flags white text over a bright gradient backdrop', async () => {
    const service = makeService();
    const violations = await service.auditTextContrast(gradientDoc('#FFFFFF'));

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      outputIndex: 0,
      elementId: 't1',
      originId: 'headline',
      fill: '#FFFFFF',
      // A genuine ratio failure keeps reporting as such — the busy branch
      // must never swallow it.
      reason: 'contrast',
    });
    // 40px text is "large": the sampled ratio missed even the 3:1 bar.
    expect(violations[0].ratio).toBeLessThan(3);
    expect(violations[0].backdropLuma).toBeGreaterThan(0.5);
  });

  it('flags a PASSING ratio over a high-variance backdrop as reason "busy"', async () => {
    const service = makeService();
    // Mean 128 → ~3.9:1 against white: over the 3:1 bar for 40px text, but
    // half the pixels are light enough that the glyphs vanish into them.
    const violations = await service.auditTextContrast(
      await imageBgDoc('#FFFFFF', checker(20, 236))
    );

    expect(violations).toHaveLength(1);
    const [v] = violations;
    expect(v.reason).toBe('busy');
    // The WCAG bar is met against the sampled MEAN — flipping the fill can
    // never rescue this, which is the whole point of the second signal.
    expect(v.ratio).toBeGreaterThanOrEqual(3);
    expect(v.backdropStdev!).toBeGreaterThanOrEqual(45);
    // Exactly half the checkerboard is too light for white text to read on.
    expect(v.crossingFraction!).toBeCloseTo(0.5, 1);
  });

  it('does NOT flag a flat backdrop whose ratio passes', async () => {
    const service = makeService();
    // Same mid-grey mean as the noise field, zero variance.
    const violations = await service.auditTextContrast(
      await imageBgDoc('#FFFFFF', flat(128))
    );

    expect(violations).toEqual([]);
  });

  // Replaces 'leaves a high-contrast pairing alone even over busy imagery
  // (ratio headroom)'. That test asserted the removed BUSY_BACKDROP_RATIO_
  // HEADROOM ceiling, which gated the variance check behind the contrast
  // check and so could never fire for light-on-dark imagery — the exact case
  // it was supposed to catch. White on this checkerboard measures ~5.9:1
  // against the mean while half its pixels sit at 200 grey, where white text
  // reads at 1.7:1. It is unreadable, and it is now flagged.
  it('flags a headroom-clearing ratio when half the backdrop is too light for the fill', async () => {
    const service = makeService();
    const violations = await service.auditTextContrast(
      await imageBgDoc('#FFFFFF', checker(0, 200))
    );

    expect(violations).toHaveLength(1);
    const [v] = violations;
    expect(v.reason).toBe('busy');
    // Clears 3 × 1.6 — the old headroom escape hatch would have skipped it.
    expect(v.ratio).toBeGreaterThan(3 * 1.6);
    expect(v.crossingFraction!).toBeCloseTo(0.5, 1);
  });

  it('crops per element: the busy half flags, the flat half does not', async () => {
    const service = makeService();
    // Both halves share the mean 128, so the ratio is identical for both text
    // boxes; only the variance differs, and only within each box's own crop.
    // Before the crop was materialized this doc flagged BOTH boxes, because
    // every element was measured against the whole page.
    const doc = await imageBgDoc('#FFFFFF', halfBusy(20, 236), [
      textEl('#FFFFFF', { id: 'in-busy', y: 20, height: 70 }),
      textEl('#FFFFFF', { id: 'in-flat', y: 110, height: 70 }),
    ]);
    doc.outputs[0].children[0].originId = 'busy-half';
    doc.outputs[0].children[1].originId = 'flat-half';

    const violations = await service.auditTextContrast(doc);

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      elementId: 'in-busy',
      reason: 'busy',
    });
    expect(violations[0].backdropStdev!).toBeGreaterThanOrEqual(45);
  });

  it('measures the GLYPH footprint: flags a box that averages out to calm', async () => {
    const service = makeService();
    // One 40px line in a tall box. Its ink lands entirely in the busy band;
    // the rest of the box is flat grey with the same mean, so measured over
    // the box the crossing fraction is diluted to ~10% (under BOTH the old
    // 0.15 bar and the new 0.12 one) while the reader sees every glyph on the
    // checkerboard.
    const doc = await imageBgDoc('#FFFFFF', glyphBand(20, 236), [
      textEl('#FFFFFF', { id: 'ink-in-band', y: 20, height: 160 }),
      // Same fixture, ink in the flat half: it must stay clean.
      textEl('#FFFFFF', { id: 'ink-in-flat', y: 120, height: 60 }),
    ]);
    doc.outputs[0].children[0].originId = 'headline';
    doc.outputs[0].children[1].originId = 'legal';

    const violations = await service.auditTextContrast(doc);

    expect(violations).toHaveLength(1);
    const [v] = violations;
    expect(v.elementId).toBe('ink-in-band');
    expect(v.reason).toBe('busy');
    // The mean still clears the 3:1 bar for 40px text — this is only
    // catchable through the distribution under the ink.
    expect(v.ratio).toBeGreaterThanOrEqual(3);
    // Every sampled pixel is checkerboard, so it reads the band's own numbers
    // (~0.5 crossing) rather than the box's diluted ~0.10.
    expect(v.crossingFraction!).toBeCloseTo(0.5, 1);
    expect(v.backdropStdev!).toBeGreaterThan(90);
  });

  it('measures the backdrop render, not the text box\'s own glyphs', async () => {
    const service = makeService();
    // A flat 200-grey panel: white text fails it outright (1.67:1), so the
    // violation is reported and its measured spread can be inspected. The
    // backdrop is uniform, so `backdropStdev` is EXACTLY 0 — a composite
    // sample could not be, because the white glyphs painted into this very
    // box differ from the 200-grey around them.
    const violations = await service.auditTextContrast(
      await imageBgDoc('#FFFFFF', flat(200))
    );

    expect(violations).toHaveLength(1);
    expect(violations[0].reason).toBe('contrast');
    expect(violations[0].backdropStdev).toBe(0);
  });

  it('does not flag a flat panel just because its own copy is dense', async () => {
    const service = makeService();
    // Near-black copy filling its box on a flat light panel — a clean,
    // perfectly readable panel at 14.6:1. Measured on the COMPOSITE this
    // exact fixture scores stdev 85.1 / crossing 0.219 (its own glyphs are
    // the variance, and every glyph pixel trivially "crosses" against its own
    // fill), clearing both busy thresholds. On the backdrop it is flat.
    const doc = await imageBgDoc('#111111', flat(230), [
      textEl('#111111', { x: 0, y: 0, width: 200, height: 80, fontSize: 60 }),
    ]);
    doc.outputs[0].children[0].text = 'MMMMMMMM';

    const violations = await service.auditTextContrast(doc);

    expect(violations).toEqual([]);
  });

  it('sees the image under an unfilled stroked shape', async () => {
    const service = makeService();
    // An outline CTA: a stroke-only rect between the text and the photo. The
    // backdrop scan used to STOP at it — the imagery went unseen, the audit
    // skipped the element entirely, and a label shipped at 1.73:1.
    const size = 200;
    const raw = Buffer.alloc(size * size * 3);
    raw.fill(255);
    const png = await sharp(raw, {
      raw: { width: size, height: size, channels: 3 },
    })
      .png()
      .toBuffer();

    const doc = gradientDoc('#FFFFFF', [
      {
        id: 'photo',
        type: 'image',
        x: 0,
        y: 0,
        width: 200,
        height: 200,
        rotation: 0,
        opacity: 1,
        locked: false,
        hidden: false,
        fitMode: 'fill',
        src: `data:image/png;base64,${png.toString('base64')}`,
      },
      {
        id: 'cta-bg',
        type: 'shape',
        shape: 'rect',
        x: 10,
        y: 10,
        width: 180,
        height: 100,
        rotation: 0,
        opacity: 1,
        locked: false,
        hidden: false,
        stroke: '#FF00E5',
        strokeWidth: 3,
      },
      textEl('#FFFFFF'),
    ]);
    // Solid output background: only the image ELEMENT can turn sampling on.
    delete doc.outputs[0].bg;

    const violations = await service.auditTextContrast(doc);

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ elementId: 't1', reason: 'contrast' });
  });

  it('passes dark text over the same backdrop', async () => {
    const service = makeService();
    const violations = await service.auditTextContrast(gradientDoc('#111111'));

    expect(violations).toEqual([]);
  });

  // Near-white above `splitY`, near-black below — the two surfaces the live
  // "POOL CLEANING" headline straddled (pale top band over a dark photo).
  const straddleSplit =
    (splitY: number) =>
    (x: number, y: number): [number, number, number] =>
      y < splitY ? [245, 245, 245] : [15, 15, 15];

  it('judges the WORST glyph line: a straddled headline flags although the union mean passes', async () => {
    const service = makeService();
    // Two 40px lines: the first sits wholly on the near-white band, the
    // second wholly on the near-black region (line 1 ink ≈ rows 26–60,
    // line 2 ≈ rows 74–108 at lineHeight 1.2; the split at y=67 falls in the
    // leading between them). The union mean is mid grey (~0.22 luma) —
    // ~4.9:1 against the #111111 fill, comfortably over the 3:1 large-text
    // bar — so the pre-fix mean judgment PASSED this element while its
    // second line read at ~1.02:1. This is the live pool-run defect.
    const doc = await imageBgDoc('#111111', straddleSplit(67), [
      textEl('#111111', { height: 100 }),
    ]);
    doc.outputs[0].children[0].text = 'HI\nHI';

    const violations = await service.auditTextContrast(doc);

    expect(violations).toHaveLength(1);
    const [v] = violations;
    expect(v).toMatchObject({
      elementId: 't1',
      reason: 'contrast',
      straddle: true,
    });
    // The violation carries the WORST line's values (the near-black region,
    // luma ~0.005, ~1:1), never the union mean's (~0.22, passing) — the
    // repair must recolor against the surface where the text reads worst.
    expect(v.backdropLuma).toBeLessThan(0.05);
    expect(v.ratio).toBeLessThan(1.5);
  });

  it('does not stamp straddle on a uniform-backdrop multi-line element', async () => {
    const service = makeService();
    // Same two-line layout, flat 200-grey panel: white text fails outright
    // (1.67:1) exactly as it did before per-line judgment — and with every
    // line on the same surface no straddle flag appears.
    const doc = await imageBgDoc('#FFFFFF', flat(200), [
      textEl('#FFFFFF', { height: 100 }),
    ]);
    doc.outputs[0].children[0].text = 'HI\nHI';

    const violations = await service.auditTextContrast(doc);

    expect(violations).toHaveLength(1);
    expect(violations[0].reason).toBe('contrast');
    expect(violations[0].straddle).toBeUndefined();
    // Worst line and union agree on a flat panel.
    expect(violations[0].backdropLuma).toBeGreaterThan(0.5);
  });

  it('skips text over a solid background — that is the doc-validator backstop', async () => {
    const service = makeService();
    const doc = gradientDoc('#FFFFFF');
    // Solid color background: white-on-white would fail, but solid backdrops
    // are not sampled here.
    delete doc.outputs[0].bg;

    const violations = await service.auditTextContrast(doc);

    expect(violations).toEqual([]);
  });
});

describe('DesignRenderService.auditTextCollisions', () => {
  const text = (id: string, box: Record<string, unknown> = {}): any => ({
    id,
    originId: id,
    type: 'text',
    x: 10,
    y: 20,
    width: 180,
    height: 60,
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    text: 'Hello',
    fontSize: 40,
    fill: '#111111',
    ...box,
  });

  const docWith = (children: any[], symbols?: any[]): any => ({
    version: 6,
    mode: 'image',
    outputs: [
      {
        id: 'o1',
        formatId: 'square',
        name: 'Sq',
        width: 200,
        height: 200,
        background: '#ffffff',
        children,
      },
    ],
    ...(symbols ? { symbols } : {}),
  });

  it('flags two text elements whose painted ink genuinely intersects', async () => {
    const service = makeService();
    // Same x, boxes 20px apart vertically: with 40px type each line's ink band
    // spans well past 20px, so the glyphs of the two lines truly cross.
    const doc = docWith([
      text('headline', { y: 40 }),
      text('subhead', { y: 60 }),
    ]);

    const violations = await service.auditTextCollisions(doc);

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      outputIndex: 0,
      reason: 'overlap',
      elementId: 'headline',
      otherElementId: 'subhead',
    });
    expect(violations[0].message).toContain('headline');
    expect(violations[0].message).toContain('subhead');
  });

  it('carries both measured ink rects on the overlap violation', async () => {
    const service = makeService();
    const doc = docWith([
      text('headline', { y: 40 }),
      text('subhead', { y: 60 }),
    ]);

    const [violation] = await service.auditTextCollisions(doc);
    const { inkRect, otherInkRect } = violation;

    // The composer widens the declared boxes to these rects before running
    // its box-based overlap guard — without them a fitted line whose ink
    // falls outside its box could never be separated and the audit re-fired
    // forever.
    expect(inkRect).toBeDefined();
    expect(otherInkRect).toBeDefined();
    // Fitted line geometry, not the raw box: one line of 'Hello' paints an
    // ink band inset below the line top (ascender inset) and shorter than
    // the 60px box, starting at the box's left edge.
    expect(inkRect!.y).toBeGreaterThan(40);
    expect(inkRect!.height).toBeLessThan(60);
    expect(inkRect!.x).toBe(10);
    expect(inkRect!.width).toBeGreaterThan(0);
    expect(inkRect!.width).toBeLessThanOrEqual(180);
    expect(otherInkRect!.y).toBeGreaterThan(60);
    // And the two ink bands genuinely cross — that is what was flagged.
    expect(inkRect!.y + inkRect!.height).toBeGreaterThan(otherInkRect!.y);
  });

  it('leaves adjacent elements (5px gap) alone', async () => {
    const service = makeService();
    // Box A ends at y=80, box B starts at y=85 — and the ink bands inside the
    // boxes are further apart still.
    const doc = docWith([
      text('headline', { y: 20, height: 60 }),
      text('subhead', { y: 85, height: 60 }),
    ]);

    expect(await service.auditTextCollisions(doc)).toEqual([]);
  });

  it('never pairs a label with its own plate (shapes are not ink)', async () => {
    const service = makeService();
    // The pre-symbol CTA convention: a filled `X-bg` shape directly under the
    // `X` label. The plate paints across the label's whole box.
    const doc = docWith([
      {
        id: 'cta-bg',
        originId: 'cta-bg',
        type: 'shape',
        shape: 'rect',
        x: 10,
        y: 20,
        width: 180,
        height: 60,
        rotation: 0,
        opacity: 1,
        locked: false,
        hidden: false,
        fill: '#111111',
      },
      text('cta', { fill: '#FFFFFF' }),
    ]);

    expect(await service.auditTextCollisions(doc)).toEqual([]);
  });

  it('skips pairs that share a groupId — a lockup travels as one unit', async () => {
    const service = makeService();
    const doc = docWith([
      text('headline', { y: 40, groupId: 'lockup' }),
      text('subhead', { y: 60, groupId: 'lockup' }),
    ]);

    expect(await service.auditTextCollisions(doc)).toEqual([]);
  });

  it('treats a symbol instance as one opaque box', async () => {
    const service = makeService();
    const symbols = [
      {
        id: 'sym-cta',
        name: 'CTA lockup',
        width: 100,
        height: 40,
        children: [
          {
            id: 'label',
            type: 'text',
            x: 0,
            y: 0,
            width: 100,
            height: 40,
            rotation: 0,
            opacity: 1,
            locked: false,
            hidden: false,
            text: 'Shop now',
            fontSize: 20,
            fill: '#FFFFFF',
          },
        ],
      },
    ];
    const doc = docWith(
      [
        {
          id: 'inst-1',
          type: 'symbol',
          symbolId: 'sym-cta',
          x: 10,
          y: 50,
          width: 100,
          height: 40,
          rotation: 0,
          opacity: 1,
          locked: false,
          hidden: false,
        },
        text('headline', { y: 40 }),
      ],
      symbols
    );

    const violations = await service.auditTextCollisions(doc);

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ reason: 'overlap' });
    expect([violations[0].elementId, violations[0].otherElementId]).toEqual(
      expect.arrayContaining(['inst-1', 'headline'])
    );
  });
});

describe('DesignRenderService.auditImageryVisibility', () => {
  const size = 200;

  const rawPng = async (
    pixels: (x: number, y: number) => [number, number, number]
  ) => {
    const raw = Buffer.alloc(size * size * 3);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const [r, g, b] = pixels(x, y);
        const i = (y * size + x) * 3;
        raw[i] = r;
        raw[i + 1] = g;
        raw[i + 2] = b;
      }
    }
    return sharp(raw, { raw: { width: size, height: size, channels: 3 } })
      .png()
      .toBuffer();
  };

  const checker = (x: number, y: number): [number, number, number] => {
    const v = (x + y) % 2 === 0 ? 20 : 236;
    return [v, v, v];
  };

  const overlay = (fill: string, opacity: number): any => ({
    id: 'overlay',
    type: 'shape',
    shape: 'rect',
    x: 0,
    y: 0,
    width: size,
    height: size,
    rotation: 0,
    opacity,
    locked: false,
    hidden: false,
    fill,
  });

  const bgImageDoc = async (
    pixels: (x: number, y: number) => [number, number, number],
    children: any[] = []
  ): Promise<any> => {
    const png = await rawPng(pixels);
    return {
      version: 5,
      mode: 'image',
      outputs: [
        {
          id: 'o1',
          formatId: 'square',
          name: 'Sq',
          width: size,
          height: size,
          background: '#ffffff',
          bg: {
            type: 'image',
            src: `data:image/png;base64,${png.toString('base64')}`,
          },
          children,
        },
      ],
    };
  };

  it('flags an image background washed to near-white by a heavy overlay', async () => {
    const service = makeService();
    const doc = await bgImageDoc(checker, [overlay('#ffffff', 0.97)]);

    const violations = await service.auditImageryVisibility(doc);

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      outputIndex: 0,
      elementId: 'bg',
      reason: 'washed-out',
    });
    expect(violations[0].backdropLuma).toBeGreaterThan(0.9);
    expect(violations[0].backdropStdev!).toBeLessThan(12);
    expect(violations[0].message).toContain('nearly invisible');
  });

  it('flags imagery crushed to near-black too', async () => {
    const service = makeService();
    const doc = await bgImageDoc(checker, [overlay('#000000', 0.98)]);

    const violations = await service.auditImageryVisibility(doc);

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ elementId: 'bg', reason: 'washed-out' });
  });

  it('leaves a normal photo alone', async () => {
    const service = makeService();
    const doc = await bgImageDoc(checker);

    expect(await service.auditImageryVisibility(doc)).toEqual([]);
  });

  it('leaves flat mid-grey imagery alone — uniform is not extreme', async () => {
    const service = makeService();
    const doc = await bgImageDoc(() => [128, 128, 128]);

    expect(await service.auditImageryVisibility(doc)).toEqual([]);
  });

  it('samples a large image ELEMENT but ignores one under the coverage floor', async () => {
    const service = makeService();
    const png = await rawPng(checker);
    const src = `data:image/png;base64,${png.toString('base64')}`;
    const imageEl = (id: string, box: Record<string, number>): any => ({
      id,
      type: 'image',
      rotation: 0,
      opacity: 1,
      locked: false,
      hidden: false,
      fitMode: 'fill',
      src,
      ...box,
    });
    const docFor = (children: any[]): any => ({
      version: 5,
      mode: 'image',
      outputs: [
        {
          id: 'o1',
          formatId: 'square',
          name: 'Sq',
          width: size,
          height: size,
          background: '#ffffff',
          children,
        },
      ],
    });

    // Full-canvas photo under the same heavy overlay: flagged, by element id.
    const flagged = await service.auditImageryVisibility(
      docFor([
        imageEl('photo', { x: 0, y: 0, width: size, height: size }),
        overlay('#ffffff', 0.97),
      ])
    );
    expect(flagged).toHaveLength(1);
    expect(flagged[0]).toMatchObject({ elementId: 'photo', reason: 'washed-out' });

    // A 40×40 thumbnail is 4% of the canvas — not "the imagery of this
    // output", so it is never sampled however washed out the render is.
    const ignored = await service.auditImageryVisibility(
      docFor([
        imageEl('thumb', { x: 0, y: 0, width: 40, height: 40 }),
        overlay('#ffffff', 0.97),
      ])
    );
    expect(ignored).toEqual([]);
  });
});

describe('DesignRenderService flat text layout', () => {
  const makeEl = (overrides: Record<string, unknown> = {}) => ({
    id: 't1',
    type: 'text',
    x: 0,
    y: 0,
    width: 220,
    height: 50,
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    text: 'a long line of copy that must wrap across several lines to overflow its box',
    fontSize: 48,
    fill: '#000000',
    align: 'left',
    ...overrides,
  });

  const makeCtx = async () => {
    const { createCanvas } = await import('canvas');
    return createCanvas(400, 300).getContext('2d');
  };

  it('shrinks overflowing flat text until it fits the box height', async () => {
    const service = makeService();
    const ctx = await makeCtx();

    (service as any).drawText(ctx as any, makeEl());

    const used = Number(/([\d.]+)px/.exec(ctx.font)?.[1]);
    expect(used).toBeLessThan(48);
    // Never below the ~60% floor.
    expect(used).toBeGreaterThanOrEqual(Math.floor(48 * 0.6));
  });

  it('keeps the original font size when the text already fits', async () => {
    const service = makeService();
    const ctx = await makeCtx();

    (service as any).drawText(
      ctx as any,
      makeEl({ text: 'Hi', fontSize: 20, height: 100 })
    );

    const used = Number(/([\d.]+)px/.exec(ctx.font)?.[1]);
    expect(used).toBe(20);
  });

  it('centers the wrapped block vertically when verticalAlign is middle', async () => {
    const service = makeService();
    const ctx = await makeCtx();
    const spy = vi.spyOn(ctx, 'fillText');

    (service as any).drawText(
      ctx as any,
      makeEl({ text: 'Hi', fontSize: 20, width: 200, height: 200, align: 'center', verticalAlign: 'middle' })
    );

    expect(spy).toHaveBeenCalled();
    const y = spy.mock.calls[0][2] as number;
    // One 20px line at 1.2 line-height → block top (200 - 24) / 2 = 88, and
    // the glyph is drawn CENTRED in its line box (baseline 'middle' half a
    // line down), which is what Konva does — so 88 + 12.
    expect(y).toBeCloseTo(100, 0);
  });

  it('anchors the block at the bottom when verticalAlign is bottom', async () => {
    const service = makeService();
    const ctx = await makeCtx();
    const spy = vi.spyOn(ctx, 'fillText');

    (service as any).drawText(
      ctx as any,
      makeEl({ text: 'Hi', fontSize: 20, width: 200, height: 200, verticalAlign: 'bottom' })
    );

    const y = spy.mock.calls[0][2] as number;
    // Block top at 200 - 24, plus the half-line-height baseline offset.
    expect(y).toBeCloseTo(200 - 24 + 12, 0);
  });

  it('defaults to top alignment when verticalAlign is absent', async () => {
    const service = makeService();
    const ctx = await makeCtx();
    const spy = vi.spyOn(ctx, 'fillText');

    (service as any).drawText(
      ctx as any,
      makeEl({ text: 'Hi', fontSize: 20, width: 200, height: 200 })
    );

    // Block top 0, plus half a 24px line box — the baseline Konva draws on.
    expect(spy.mock.calls[0][2]).toBe(12);
  });
});
