import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { compositeMagicGrabBackground } from './magic-grab-composite';

const rgba = (width: number, height: number, color: [number, number, number, number]) =>
  sharp({
    create: { width, height, channels: 4, background: { r: color[0], g: color[1], b: color[2], alpha: color[3] } },
  }).png().toBuffer();

describe('compositeMagicGrabBackground', () => {
  it('changes only the white-mask subject area', async () => {
    const original = await rgba(2, 1, [255, 0, 0, 255]);
    const generated = await rgba(2, 1, [0, 255, 0, 255]);
    const mask = await sharp({
      create: { width: 2, height: 1, channels: 4, background: '#ffffff' },
    }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    mask.data[7] = 0;
    const maskPng = await sharp(mask.data, { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer();

    const result = await compositeMagicGrabBackground({ original, generated, mask: maskPng });
    const pixels = await sharp(result).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

    expect([...pixels.data.slice(0, 4)]).toEqual([0, 255, 0, 255]);
    expect([...pixels.data.slice(4, 8)]).toEqual([255, 0, 0, 255]);
  });

  it('feathers partial alpha and fits generated/mask dimensions to the original', async () => {
    const original = await rgba(2, 1, [100, 100, 100, 255]);
    const generated = await rgba(1, 1, [200, 200, 200, 255]);
    const mask = await sharp({
      create: { width: 1, height: 1, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0.5 } },
    }).png().toBuffer();

    const result = await compositeMagicGrabBackground({ original, generated, mask });
    const pixels = await sharp(result).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

    expect(pixels.info).toMatchObject({ width: 2, height: 1 });
    expect(pixels.data[0]).toBeGreaterThan(100);
    expect(pixels.data[0]).toBeLessThan(200);
  });
});
