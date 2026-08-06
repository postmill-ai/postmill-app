import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DesignRenderService } from '@postmill-ai/nestjs-libraries/media/design-render/design-render.service';
import type { DesignerDoc } from '@postmill-ai/nestjs-libraries/media/design-render/design-render.types';

/**
 * Mutable state shared between the `canvas` mock factory and the tests.
 * Vitest hoists `vi.mock`, so the factory reads this object by reference.
 */
const testState = vi.hoisted(() => ({
  imageDimensions: { width: 100, height: 100 },
  drawImageCalls: [] as Array<{ img: any; args: number[] }>,
  filterAssignments: [] as string[],
  putImageDataCalls: 0,
  canvasInstances: [] as Array<{ width: number; height: number }>,
}));

vi.mock('canvas', () => ({
  createCanvas: vi.fn((width: number, height: number) => {
    testState.canvasInstances.push({ width, height });

    let currentFilter = 'none';
    const filterStack: string[] = [];

    const ctx: any = {
      save: vi.fn(() => filterStack.push(currentFilter)),
      restore: vi.fn(() => {
        currentFilter = filterStack.pop() ?? 'none';
      }),
      scale: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      closePath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      arcTo: vi.fn(),
      ellipse: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      drawImage: vi.fn((img: any, ...args: number[]) => {
        testState.drawImageCalls.push({ img, args });
      }),
      measureText: vi.fn(() => ({ width: 0 })),
      fillText: vi.fn(),
      strokeText: vi.fn(),
      createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
      createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
      // Pixel-space filtering reads the buffer back and writes it again;
      // `putImageData` is therefore the observable "a filter ran" signal.
      getImageData: vi.fn((x: number, y: number, w: number, h: number) => ({
        data: new Uint8ClampedArray(Math.max(1, w * h) * 4),
        width: w,
        height: h,
      })),
      putImageData: vi.fn(() => {
        testState.putImageDataCalls += 1;
      }),
      getTransform: vi.fn(() => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })),
      setTransform: vi.fn(),
    };

    Object.defineProperty(ctx, 'filter', {
      get: () => currentFilter,
      set: (value: string) => {
        currentFilter = value;
        testState.filterAssignments.push(value);
      },
    });

    Object.defineProperty(ctx, 'fillStyle', {
      get: () => '',
      set: vi.fn(),
    });

    Object.defineProperty(ctx, 'strokeStyle', {
      get: () => '',
      set: vi.fn(),
    });

    Object.defineProperty(ctx, 'lineWidth', {
      get: () => 1,
      set: vi.fn(),
    });

    Object.defineProperty(ctx, 'globalAlpha', {
      get: () => 1,
      set: vi.fn(),
    });

    Object.defineProperty(ctx, 'globalCompositeOperation', {
      get: () => 'source-over',
      set: vi.fn(),
    });

    Object.defineProperty(ctx, 'font', {
      get: () => '10px sans-serif',
      set: vi.fn(),
    });

    Object.defineProperty(ctx, 'textAlign', {
      get: () => 'left',
      set: vi.fn(),
    });

    Object.defineProperty(ctx, 'textBaseline', {
      get: () => 'top',
      set: vi.fn(),
    });

    Object.defineProperty(ctx, 'shadowColor', {
      get: () => '',
      set: vi.fn(),
    });

    Object.defineProperty(ctx, 'shadowBlur', {
      get: () => 0,
      set: vi.fn(),
    });

    Object.defineProperty(ctx, 'shadowOffsetX', {
      get: () => 0,
      set: vi.fn(),
    });

    Object.defineProperty(ctx, 'shadowOffsetY', {
      get: () => 0,
      set: vi.fn(),
    });

    return {
      getContext: vi.fn(() => ctx),
      toBuffer: vi.fn((format?: string) =>
        Buffer.from(`png:${width}x${height}:${format ?? 'image/png'}`)
      ),
      width,
      height,
    };
  }),
  loadImage: vi.fn(() =>
    Promise.resolve({
      naturalWidth: testState.imageDimensions.width,
      naturalHeight: testState.imageDimensions.height,
      width: testState.imageDimensions.width,
      height: testState.imageDimensions.height,
    })
  ),
  registerFont: vi.fn(),
}));

describe('DesignRenderService', () => {
  let service: DesignRenderService;

  beforeEach(() => {
    testState.imageDimensions = { width: 100, height: 100 };
    testState.drawImageCalls = [];
    testState.filterAssignments = [];
    testState.putImageDataCalls = 0;
    testState.canvasInstances = [];

    service = new DesignRenderService({
      loadOrgFonts: vi.fn(),
      loadCuratedFonts: vi.fn(),
    } as any);
  });

  describe('multi-output sizing', () => {
    it('renders two PNGs sized to each output', async () => {
      const doc: DesignerDoc = {
        version: 1,
        mode: 'image',
        outputs: [
          {
            id: 'o1',
            formatId: 'ig-post',
            name: 'IG Post',
            width: 800,
            height: 600,
            background: '#ff0000',
            children: [],
          },
          {
            id: 'o2',
            formatId: 'x-post',
            name: 'X Post',
            width: 400,
            height: 300,
            background: '#0000ff',
            children: [],
          },
        ],
      };

      const buffers = await service.renderAllPages(doc);

      expect(buffers).toHaveLength(2);
      expect(testState.canvasInstances).toHaveLength(2);
      expect(testState.canvasInstances[0]).toEqual({ width: 800, height: 600 });
      expect(testState.canvasInstances[1]).toEqual({ width: 400, height: 300 });
    });
  });

  describe('cover focal point', () => {
    it('crops a portrait source toward a non-center focal point', async () => {
      // Source is 200x400 (portrait), target is 100x100 (square).
      // srcRatio (0.5) < targetRatio (1) => crop width = full source width,
      // crop height = source width / targetRatio = 200.
      // With focalPoint.y = 0.75, sy = (400 - 200) * 0.75 = 150.
      testState.imageDimensions = { width: 200, height: 400 };

      const doc: DesignerDoc = {
        version: 1,
        mode: 'image',
        outputs: [
          {
            id: 'o1',
            formatId: 'custom',
            name: 'Square crop',
            width: 100,
            height: 100,
            background: '#ffffff',
            children: [
              {
                id: 'img1',
                type: 'image',
                x: 0,
                y: 0,
                width: 100,
                height: 100,
                rotation: 0,
                opacity: 1,
                locked: false,
                hidden: false,
                src: 'data:image/png;base64,placeholder',
                fitMode: 'cover',
                focalPoint: { x: 0.25, y: 0.75 },
              },
            ],
          },
        ],
      };

      await service.renderPage(doc, 0);

      const coverDraw = testState.drawImageCalls.find((c) => c.args.length === 8);
      expect(coverDraw).toBeDefined();

      const [sx, sy, sw, sh, dx, dy, dw, dh] = coverDraw!.args;
      expect(sx).toBe(0);
      expect(sy).toBe(150);
      expect(sw).toBe(200);
      expect(sh).toBe(200);
      expect(dx).toBe(0);
      expect(dy).toBe(0);
      expect(dw).toBe(100);
      expect(dh).toBe(100);
    });
  });

  describe('filter parity', () => {
    it('applies filters in pixel space, never via ctx.filter', async () => {
      // `ctx.filter` is accepted and silently IGNORED by node-canvas — the
      // original implementation assigned it, this test asserted the
      // assignment, and every filter evaporated in every export while the
      // suite stayed green. Filters now run on real pixels
      // (`applyFilterTokensToCanvas`), so the observable contract is a
      // buffer readback/writeback for the filtered image and no `ctx.filter`
      // assignment at all.
      const doc: DesignerDoc = {
        version: 1,
        mode: 'image',
        outputs: [
          {
            id: 'o1',
            formatId: 'custom',
            name: 'Filter test',
            width: 200,
            height: 200,
            background: '#ffffff',
            children: [
              {
                id: 'img1',
                type: 'image',
                x: 0,
                y: 0,
                width: 100,
                height: 100,
                rotation: 0,
                opacity: 1,
                locked: false,
                hidden: false,
                src: 'data:image/png;base64,filtered',
                filters: ['grayscale', 'brightness:1.5'],
              },
              {
                id: 'img2',
                type: 'image',
                x: 100,
                y: 100,
                width: 100,
                height: 100,
                rotation: 0,
                opacity: 1,
                locked: false,
                hidden: false,
                src: 'data:image/png;base64,unfiltered',
              },
            ],
          },
        ],
      };

      await service.renderPage(doc, 0);

      // The filtered image round-tripped through pixels; the unfiltered one
      // must not pay for that.
      expect(testState.putImageDataCalls).toBe(1);
      expect(testState.filterAssignments).toEqual([]);
      // Both images still drew — a filter failing must never drop the layer.
      const drawn = testState.drawImageCalls.filter((c) => c.img && typeof c.img === 'object');
      expect(drawn.length).toBeGreaterThanOrEqual(2);
    });
  });
});
