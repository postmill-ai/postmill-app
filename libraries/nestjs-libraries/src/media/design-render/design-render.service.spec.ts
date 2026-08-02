import { describe, it, expect, vi } from 'vitest';
import sharp from 'sharp';
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
    // One 20px line at 1.2 line-height → (200 - 24) / 2 = 88.
    expect(y).toBeCloseTo(88, 0);
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
    expect(y).toBeCloseTo(200 - 24, 0);
  });

  it('defaults to top alignment when verticalAlign is absent', async () => {
    const service = makeService();
    const ctx = await makeCtx();
    const spy = vi.spyOn(ctx, 'fillText');

    (service as any).drawText(
      ctx as any,
      makeEl({ text: 'Hi', fontSize: 20, width: 200, height: 200 })
    );

    expect(spy.mock.calls[0][2]).toBe(0);
  });
});
