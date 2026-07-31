import { describe, it, expect, vi } from 'vitest';
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
  const textEl = (fill: string): any => ({
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
  });

  const gradientDoc = (fill: string): any => ({
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
        children: [textEl(fill)],
      },
    ],
  });

  it('flags white text over a bright gradient backdrop', async () => {
    const service = makeService();
    const violations = await service.auditTextContrast(gradientDoc('#FFFFFF'));

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      outputIndex: 0,
      elementId: 't1',
      originId: 'headline',
      fill: '#FFFFFF',
    });
    // 40px text is "large": the sampled ratio missed even the 3:1 bar.
    expect(violations[0].ratio).toBeLessThan(3);
    expect(violations[0].backdropLuma).toBeGreaterThan(0.5);
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
