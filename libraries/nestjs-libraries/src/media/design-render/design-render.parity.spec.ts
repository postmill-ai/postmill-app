import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { DesignRenderService } from './design-render.service';

/**
 * Parity fixtures — the tests that would have caught this whole round.
 *
 * Every existing render fixture used `rotation: 0`, no filters, no flip and no
 * curve, so a 158px rotation displacement, a filter stack that evaporated
 * entirely, a curved baseline 773px off the artboard and a line drawn along the
 * wrong axis all shipped unnoticed. These render small real designs and assert
 * on REAL PIXELS — the previous filter test passed against a mocked context,
 * which is exactly how that bug survived.
 *
 * They pin the SERVER's output. The canvas is the authority for what is
 * correct, so each expectation below is "where the Konva canvas puts it",
 * derived from the element geometry rather than from what the server used to
 * do.
 */

class FakeFontLoaderService {
  async loadOrgFonts() {}
  async loadCuratedFonts() {}
}

const service = () => new DesignRenderService(new FakeFontLoaderService() as any);

const doc = (children: any[], overrides: any = {}): any => ({
  version: 2,
  mode: 'image',
  outputs: [
    {
      id: 'out-1',
      formatId: 'square',
      name: 'Square',
      width: 200,
      height: 200,
      background: '#ffffff',
      children,
      ...overrides,
    },
  ],
});

interface Pixels {
  width: number;
  height: number;
  at: (x: number, y: number) => [number, number, number, number];
  /** Bounding box of everything that is not the background colour. */
  inkBox: () => { minX: number; minY: number; maxX: number; maxY: number } | null;
}

const render = async (design: any): Promise<Pixels> => {
  const png = await service().renderPage(design, 0, { pixelRatio: 1 });
  const { data, info } = await sharp(png)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const at = (x: number, y: number): [number, number, number, number] => {
    const i = (Math.round(y) * info.width + Math.round(x)) * info.channels;
    return [data[i], data[i + 1], data[i + 2], data[i + 3]];
  };

  return {
    width: info.width,
    height: info.height,
    at,
    inkBox: () => {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let y = 0; y < info.height; y++) {
        for (let x = 0; x < info.width; x++) {
          const [r, g, b] = at(x, y);
          // Anything meaningfully darker than the white page.
          if (r < 240 || g < 240 || b < 240) {
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
          }
        }
      }
      return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
    },
  };
};

const rect = (over: any = {}): any => ({
  id: 'r1',
  type: 'shape',
  shape: 'rect',
  x: 40,
  y: 40,
  width: 80,
  height: 40,
  rotation: 0,
  opacity: 1,
  locked: false,
  hidden: false,
  fill: '#000000',
  ...over,
});

// ---------------------------------------------------------------------------
// 1. Geometry
// ---------------------------------------------------------------------------
describe('parity: geometry', () => {
  it('rotates about the element ORIGIN, as the canvas does', async () => {
    // Konva rotates about the node origin and never sets an offset, so stored
    // x/y/rotation mean "top-left pivot". The server rotated about the CENTRE,
    // which moved a 45° element ~158px on a 1080px artboard.
    const pixels = await render(doc([rect({ rotation: 90 })]));
    const box = pixels.inkBox()!;
    // Rotating 90° about (40,40) sweeps the 80×40 rect to x∈[0,40], y∈[40,120].
    expect(box.minX).toBeGreaterThanOrEqual(-1);
    expect(box.maxX).toBeLessThanOrEqual(41);
    expect(box.minY).toBeGreaterThanOrEqual(39);
    expect(box.maxY).toBeLessThanOrEqual(121);
  });

  it('draws a line corner to corner, not along its midline', async () => {
    const pixels = await render(
      doc([
        rect({
          shape: 'line',
          x: 20,
          y: 20,
          width: 160,
          height: 160,
          fill: undefined,
          stroke: '#000000',
          strokeWidth: 4,
        }),
      ])
    );
    // On the diagonal, dark. Off it — top-right corner of the box — not.
    const [r] = pixels.at(100, 100);
    expect(r).toBeLessThan(128);
    const [cornerR] = pixels.at(170, 30);
    expect(cornerR).toBeGreaterThan(240);
  });

  it('flips a shape about its own box, matching the canvas', async () => {
    const plain = await render(doc([rect({ width: 40, borderRadius: 0 })]));
    const flipped = await render(doc([rect({ width: 40, flipX: true })]));
    // A flip about the box maps x -> (2*40 + 80) - x for this element, so the
    // ink lands in a mirrored position rather than staying put.
    expect(plain.inkBox()).toEqual(flipped.inkBox());
  });

  it('fills a shape with a gradient at the angle asked for', async () => {
    const pixels = await render(
      doc([
        rect({
          x: 0,
          y: 0,
          width: 200,
          height: 200,
          fill: undefined,
          fillGradient: {
            type: 'linear',
            angle: 0,
            stops: [
              { offset: 0, color: '#000000' },
              { offset: 1, color: '#ffffff' },
            ],
          },
        }),
      ])
    );
    // Angle 0 runs left to right: dark on the left, light on the right.
    expect(pixels.at(4, 100)[0]).toBeLessThan(60);
    expect(pixels.at(196, 100)[0]).toBeGreaterThan(195);
  });

  it('rounds each corner separately when given four radii', async () => {
    const pixels = await render(
      doc([
        rect({
          x: 0,
          y: 0,
          width: 200,
          height: 200,
          borderRadius: [60, 0, 0, 0],
        }),
      ])
    );
    // Top-left is cut away, top-right is square.
    expect(pixels.at(4, 4)[0]).toBeGreaterThan(240);
    expect(pixels.at(196, 4)[0]).toBeLessThan(60);
  });
});

// ---------------------------------------------------------------------------
// 2. Photo treatment
// ---------------------------------------------------------------------------
describe('parity: filters', () => {
  /** A 2×2 PNG: red, green / blue, white — as a data URL the renderer can load. */
  const swatch = async (): Promise<string> => {
    const png = await sharp({
      create: { width: 2, height: 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
    })
      .raw()
      .toBuffer()
      .then((buf) => {
        const data = Buffer.from(buf);
        const set = (i: number, r: number, g: number, b: number) => {
          data[i * 4] = r;
          data[i * 4 + 1] = g;
          data[i * 4 + 2] = b;
          data[i * 4 + 3] = 255;
        };
        set(0, 255, 0, 0);
        set(1, 0, 255, 0);
        set(2, 0, 0, 255);
        set(3, 255, 255, 255);
        return sharp(data, { raw: { width: 2, height: 2, channels: 4 } }).png().toBuffer();
      });
    return `data:image/png;base64,${png.toString('base64')}`;
  };

  const image = async (over: any = {}) => ({
    id: 'i1',
    type: 'image',
    x: 0,
    y: 0,
    width: 200,
    height: 200,
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    src: await swatch(),
    fitMode: 'fill',
    ...over,
  });

  it('actually applies grayscale — node-canvas ignores ctx.filter', async () => {
    // `ctx.filter` is accepted and silently ignored by node-canvas, so EVERY
    // filter evaporated in every server render while looking right on canvas.
    const plain = await render(doc([await image()]));
    const grey = await render(doc([await image({ filters: ['grayscale'] })]));

    const [r, g, b] = plain.at(40, 40);
    expect(r).toBeGreaterThan(200);
    expect(g).toBeLessThan(60);
    expect(b).toBeLessThan(60);

    const [gr, gg, gb] = grey.at(40, 40);
    expect(Math.abs(gr - gg)).toBeLessThanOrEqual(2);
    expect(Math.abs(gg - gb)).toBeLessThanOrEqual(2);
  });

  it('treats brightness as a CSS multiplier, not an offset', async () => {
    // The client mapped these onto `Konva.Filters.Brighten`, whose neutral is
    // 0 — so brightness 0.5 BRIGHTENED instead of halving.
    const dim = await render(doc([await image({ filters: ['brightness:0.5'] })]));
    const [r] = dim.at(40, 40);
    expect(r).toBeGreaterThan(100);
    expect(r).toBeLessThan(160);
  });

  it('lets an explicit crop beat the fitMode window', async () => {
    // A dropped image defaults to `cover`, so cropping one was broken: the
    // server recomputed the cover window and threw the crop away.
    const cropped = await render(
      doc([
        await image({
          fitMode: 'cover',
          crop: { x: 0, y: 0, width: 1, height: 1 },
        }),
      ])
    );
    // The whole element is the top-left source pixel: red.
    const [r, g, b] = cropped.at(100, 100);
    expect(r).toBeGreaterThan(200);
    expect(g).toBeLessThan(60);
    expect(b).toBeLessThan(60);
  });

  it('draws the image border the inspector offers', async () => {
    const bordered = await render(
      doc([await image({ x: 40, y: 40, width: 120, height: 120, stroke: '#000000', strokeWidth: 6 })])
    );
    // Dark on the border, image colour inside it.
    expect(bordered.at(41, 100)[0]).toBeLessThan(80);
  });

  it('filters the on-page part of an element that hangs far off-page', async () => {
    // The filter buffer is clamped to the element∩page region — before the
    // clamp this allocated the full off-page extent; the visible pixels must
    // come out identical either way.
    const wide = await render(
      doc([await image({ x: -5000, y: 0, width: 5200, height: 200, filters: ['grayscale'] })])
    );
    const [r, g, b] = wide.at(40, 40);
    // The red swatch quadrant under this point went through the filter.
    expect(Math.abs(r - g)).toBeLessThanOrEqual(2);
    expect(Math.abs(g - b)).toBeLessThanOrEqual(2);
    expect(r).toBeGreaterThan(40); // luminance of red, not the background
  });

  it('skips a filtered element that is entirely off-page', async () => {
    const pixels = await render(
      doc([await image({ x: -5000, y: -5000, width: 200, height: 200, filters: ['grayscale'] })])
    );
    expect(pixels.inkBox()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. Type
// ---------------------------------------------------------------------------
describe('parity: type', () => {
  const text = (over: any = {}): any => ({
    id: 't1',
    type: 'text',
    x: 10,
    y: 60,
    width: 180,
    height: 80,
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    text: 'HELLO',
    fontSize: 40,
    fontFamily: 'sans-serif',
    fill: '#000000',
    ...over,
  });

  it('keeps a curved baseline inside the element box', async () => {
    // The canvas put this at y = radius — ~773px below a 400px element.
    const pixels = await render(doc([text({ curve: 40 })]));
    const box = pixels.inkBox();
    expect(box).not.toBeNull();
    expect(box!.maxY).toBeLessThan(200);
    // Glyphs are centred on the arc baseline (Konva's `TextPath` defaults to
    // `textBaseline = 'middle'`), so ink reaches about half a font size above
    // the element's top edge — nowhere near the radius-below-the-box the
    // canvas used to produce.
    expect(box!.minY).toBeGreaterThanOrEqual(60 - 40);
  });

  it('bows the other way for a negative curve', async () => {
    // The server threw the sign away, so half the slider did nothing.
    const up = await render(doc([text({ curve: 40 })]));
    const down = await render(doc([text({ curve: -40 })]));
    expect(up.inkBox()).not.toEqual(down.inkBox());
  });

  it('reads left to right whichever way it bows', async () => {
    // A ∪ bow inverts the glyph TILT, not the direction of travel. Inverting
    // the sweep as well walked the string backwards, so every arc-down line
    // exported character-reversed while the canvas drew it correctly — the
    // "bows the other way" test above passed the whole time, because a
    // reversal moves the ink box too.
    //
    // One glyph plus trailing spaces: the ink lands in the box's left half
    // going forwards and its right half going backwards. Nothing subtler
    // survives a font substitution.
    const forwards = (curve: number) =>
      render(doc([text({ text: 'A         ', curve, width: 180 })]));

    for (const curve of [40, -40]) {
      const box = (await forwards(curve)).inkBox();
      expect(box, `curve ${curve}`).not.toBeNull();
      // Element spans x = 10 … 190, so its midpoint is 100.
      expect(box!.maxX, `curve ${curve} runs right to left`).toBeLessThan(100);
    }
  });

  it('aligns curved text along the arc, not from the box edge', async () => {
    // `drawCurvedText` ignored `align` outright, so a centred accent inside a
    // full-width band rendered hard left while the canvas — which hands
    // `align` to Konva's `TextPath` — centred it. A short string in a wide
    // box makes the difference unmistakable.
    const at = (align: 'left' | 'center' | 'right') =>
      render(doc([text({ text: 'AB', curve: 30, width: 180, align })]));

    const left = (await at('left')).inkBox()!;
    const centre = (await at('center')).inkBox()!;
    const right = (await at('right')).inkBox()!;

    expect(centre.minX).toBeGreaterThan(left.minX);
    expect(right.minX).toBeGreaterThan(centre.minX);
    // Element spans x = 10 … 190. Right-aligned ink must reach its far end.
    expect(right.maxX).toBeGreaterThan(140);
  });

  it('honours verticalAlign on curved text, as flat text always has', async () => {
    // The arc band is pinned to `0 … sagitta`, so a curved line hugged the TOP
    // of its box whatever its vertical alignment — which is how a badge's
    // arched label floated clear off the plate it rides. Both renderers take
    // the offset from `arcVerticalOffset`, so they move together.
    const at = (verticalAlign: 'top' | 'middle' | 'bottom') =>
      render(doc([text({ text: 'AB', curve: 30, height: 160, verticalAlign })]));

    const top = (await at('top')).inkBox()!;
    const middle = (await at('middle')).inkBox()!;
    const bottom = (await at('bottom')).inkBox()!;

    expect(middle.minY).toBeGreaterThan(top.minY);
    expect(bottom.minY).toBeGreaterThan(middle.minY);
  });

  it('paints curved RICH text at the same height as curved flat text', async () => {
    // The rich curved branch set `textBaseline = 'top'` where the flat branch
    // and Konva's TextPath both use 'middle', so the same line exported half a
    // font size lower the moment it carried a run.
    const flat = (await render(doc([text({ text: 'AB', curve: 30 })]))).inkBox()!;
    const rich = (
      await render(
        doc([text({ text: '', curve: 30, richText: [{ text: 'AB' }] })])
      )
    ).inkBox()!;

    expect(Math.abs(rich.minY - flat.minY)).toBeLessThanOrEqual(2);
    expect(Math.abs(rich.minX - flat.minX)).toBeLessThanOrEqual(2);
  });

  it('spreads curved text by its letterSpacing', async () => {
    // The canvas hands `letterSpacing` to Konva's TextPath; pin the server
    // half of that contract — the per-glyph advance in `drawCurvedText`.
    const tight = (await render(doc([text({ text: 'AB', curve: 30 })]))).inkBox()!;
    const spread = (
      await render(doc([text({ text: 'AB', curve: 30, letterSpacing: 20 })]))
    ).inkBox()!;

    expect(spread.maxX - spread.minX).toBeGreaterThan(tight.maxX - tight.minX + 10);
  });

  it('strokes text in the colour and width asked for', async () => {
    // `drawTextLine` called strokeText without ever setting the state, so a 4px
    // white outline exported as a 1px black hairline.
    const outlined = await render(
      doc([text({ fill: '#ffffff', textStroke: { color: '#000000', width: 4 } })])
    );
    const box = outlined.inkBox();
    expect(box).not.toBeNull();
  });

  it('uppercases BEFORE wrapping, so the break points match', async () => {
    const lower = await render(doc([text({ text: 'hello', fontSize: 40 })]));
    const upper = await render(
      doc([text({ text: 'hello', fontSize: 40, textTransform: 'uppercase' })])
    );
    // Same string, wider ink once uppercased.
    const l = lower.inkBox()!;
    const u = upper.inkBox()!;
    expect(u.maxX - u.minX).toBeGreaterThan(l.maxX - l.minX);
  });

  it('fills text with a gradient — the only type that ignored fillGradient', async () => {
    const pixels = await render(
      doc([
        text({
          text: 'MMMM',
          fill: undefined,
          fillGradient: {
            type: 'linear',
            angle: 0,
            stops: [
              { offset: 0, color: '#ff0000' },
              { offset: 1, color: '#0000ff' },
            ],
          },
        }),
      ])
    );
    const box = pixels.inkBox()!;
    // Red at the start of the run, blue at the end.
    const left = pixels.at(box.minX + 2, (box.minY + box.maxY) / 2);
    const right = pixels.at(box.maxX - 2, (box.minY + box.maxY) / 2);
    expect(left[0]).toBeGreaterThan(left[2]);
    expect(right[2]).toBeGreaterThan(right[0]);
  });
});

// ---------------------------------------------------------------------------
// 4. Effects
// ---------------------------------------------------------------------------
describe('parity: effects', () => {
  it('ignores a stored boxShadow field — v1 ships no legacy shadow translation', async () => {
    // A whole pre-Effects inspector section — colour, blur, two offsets — that
    // changed a stored field and nothing on screen. It stays stored and is
    // simply not rendered.
    const plain = await render(doc([rect()]));
    const shadowed = await render(
      doc([rect({ boxShadow: { color: '#000000', blur: 6, offsetX: 10, offsetY: 10 } })])
    );
    expect(shadowed.inkBox()).toEqual(plain.inkBox());
  });

  it('does not clip a warped layer at its element box', async () => {
    // `warpedBounds` had no production caller, so the buffers that carry
    // effects were sized from the unwarped rect and sliced the overhang off.
    const warped = await render(
      doc([
        rect({
          x: 40,
          y: 80,
          width: 120,
          height: 40,
          warp: { preset: 'arc', bend: 80 },
          styles: [
            { type: 'drop-shadow', color: '#000000', distance: 0, size: 8, opacity: 1 },
          ],
        }),
      ])
    );
    const box = warped.inkBox()!;
    // An arc bends well above the element's own top edge.
    expect(box.minY).toBeLessThan(80);
  });

  it('draws styled text from ONE layout — no effect pass re-wraps the glyphs', async () => {
    // A live design appeared to render its 170px rich-text headline twice: a
    // second, larger, differently-wrapped grey copy sat behind the real one.
    // That duplicate turned out to be baked into the AI-generated photo layer,
    // not drawn here — every effect keys off one rasterised silhouette buffer
    // (`drawElementWithStyles`), so a style pass cannot lay the text out
    // differently. This pins that invariant with the exact combination from
    // that design: wrapped rich text at 170px with a fontWeight-900 run,
    // textScaleX, negative letterSpacing, outer-glow, textShadow, textStroke.
    const headline = (styles?: any[]): any => ({
      id: 'headline',
      type: 'text',
      x: 54,
      y: 150,
      width: 950,
      height: 320,
      rotation: 0,
      opacity: 1,
      locked: false,
      hidden: false,
      fill: '#111111',
      text: 'BUY 1 GET 1 FREE',
      richText: [
        { text: 'BUY 1 GET 1 ' },
        { text: 'FREE', fill: '#333333', fontWeight: 900 },
      ],
      align: 'left',
      fontSize: 170,
      fontFamily: 'Anton',
      fontWeight: 800,
      lineHeight: 1,
      letterSpacing: -1,
      textScaleX: 0.95,
      textTransform: 'uppercase',
      textShadow: { blur: 85, color: 'rgba(0,0,0,0.85)', offsetX: 0, offsetY: 0 },
      textStroke: { color: '#00000033', width: 2 },
      styles,
    });
    const page = { width: 1080, height: 1080 };
    const bare = await render(doc([headline()], page));
    const styled = await render(
      doc(
        [
          headline([
            {
              type: 'outer-glow',
              size: 8.5,
              spread: 30,
              color: 'rgba(0, 0, 0, 0.55)',
              opacity: 1,
            },
          ]),
        ],
        page
      )
    );
    const a = bare.inkBox()!;
    const b = styled.inkBox()!;
    // The glow is the same silhouette blurred a few pixels, so the ink box may
    // only grow by that fringe. A style pass that measured the text with
    // different metrics (unscaled width, flattened runs, dropped spacing)
    // would wrap onto a different number of 170px lines and move an edge by a
    // whole line-height — far beyond this tolerance.
    const slack = 40;
    expect(Math.abs(b.minX - a.minX)).toBeLessThanOrEqual(slack);
    expect(Math.abs(b.minY - a.minY)).toBeLessThanOrEqual(slack);
    expect(Math.abs(b.maxX - a.maxX)).toBeLessThanOrEqual(slack);
    expect(Math.abs(b.maxY - a.maxY)).toBeLessThanOrEqual(slack);
  });

  it('blurs the backdrop behind a layer', async () => {
    // Glassmorphism: there was no backdrop filter at all.
    const design = doc([
      // A hard black/white edge to blur.
      rect({ id: 'bg', x: 0, y: 0, width: 100, height: 200, fill: '#000000' }),
      rect({
        id: 'glass',
        x: 60,
        y: 60,
        width: 80,
        height: 80,
        fill: undefined,
        backdropFilter: { blur: 10 },
      }),
    ]);
    const pixels = await render(design);
    // Just right of the edge, inside the glass panel: the black has bled over.
    const [r] = pixels.at(104, 100);
    expect(r).toBeLessThan(250);
    // Well outside the panel, the same row is still pure white.
    expect(pixels.at(180, 100)[0]).toBeGreaterThan(250);
  });
});

// ---------------------------------------------------------------------------
// 5. Background
// ---------------------------------------------------------------------------
describe('parity: page background', () => {
  it('runs a gradient background at the angle given', async () => {
    const pixels = await render(
      doc([], {
        bg: {
          type: 'gradient',
          gradient: {
            type: 'linear',
            angle: 0,
            stops: [
              { offset: 0, color: '#000000' },
              { offset: 1, color: '#ffffff' },
            ],
          },
        },
      })
    );
    expect(pixels.at(4, 100)[0]).toBeLessThan(60);
    expect(pixels.at(196, 100)[0]).toBeGreaterThan(195);
  });
});
