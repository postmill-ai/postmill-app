import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { DesignRenderService } from './design-render.service';

const sourcePng = () => sharp({
  create: {
    width: 2,
    height: 2,
    channels: 4,
    background: { r: 255, g: 0, b: 0, alpha: 0.5 },
  },
}).png().toBuffer();

describe('DesignRenderService.renderPageToFormat', () => {
  it('returns the original PNG bytes', async () => {
    const png = await sourcePng();
    const service = Object.create(DesignRenderService.prototype) as DesignRenderService;
    vi.spyOn(service, 'renderPage').mockResolvedValue(png);

    const result = await service.renderPageToFormat({} as any, 0, undefined, 0, 'png');

    expect(result).toEqual({ bytes: png, mime: 'image/png', extension: 'png' });
  });

  it.each([
    ['jpeg', 'image/jpeg', 'jpg'],
    ['webp', 'image/webp', 'webp'],
  ] as const)('encodes %s with the requested quality', async (format, mime, extension) => {
    const service = Object.create(DesignRenderService.prototype) as DesignRenderService;
    vi.spyOn(service, 'renderPage').mockResolvedValue(await sourcePng());

    const result = await service.renderPageToFormat({} as any, 0, undefined, 0, format, 0.7);
    const metadata = await sharp(result.bytes).metadata();

    expect(result.mime).toBe(mime);
    expect(result.extension).toBe(extension);
    expect(metadata.format).toBe(format);
    expect(metadata.width).toBe(2);
    expect(metadata.height).toBe(2);
  });
});

describe('DesignRenderService.renderPage canvas bounds', () => {
  it('downscales the whole page instead of cropping an oversized requested ratio', async () => {
    const service = new DesignRenderService({
      loadOrgFonts: vi.fn(async () => undefined),
      loadCuratedFonts: vi.fn(async () => undefined),
    } as any);
    const doc = {
      version: 13,
      mode: 'image',
      outputs: [{
        id: 'wide', formatId: 'custom', name: 'Wide', width: 6000, height: 100,
        background: '#ffffff', children: [],
      }],
    } as any;

    const bytes = await service.renderPage(doc, 0, { pixelRatio: 3 });
    const metadata = await sharp(bytes).metadata();

    expect(metadata.width).toBe(16384);
    expect(metadata.height).toBe(273);
  });
});
