import { describe, it, expect } from 'vitest';
import { createCanvas } from 'canvas';
import {
  backgroundTextureSource,
  drawTextureOverlay,
  drawTextureTile,
  textureTileSizeFor,
} from './background-texture';
import type { DesignerTexture } from './designer-doc.schema';

/**
 * Background textures (grain / paper) — the deterministic overlay generator
 * shared by the Konva canvas, the node-canvas server renderer and the injected
 * video frame page. These pin the pixels of the tile and the lockstep of the
 * serialized copy the frame renderer runs.
 */

const px = (canvas: any, x: number, y: number): number[] => {
  const d = canvas.getContext('2d').getImageData(x, y, 1, 1).data;
  return [d[0], d[1], d[2], d[3]];
};

const tilePixels = (texture: DesignerTexture, scale = 1): number[] => {
  const size = textureTileSizeFor({ ...texture, scale });
  const canvas = createCanvas(size, size);
  drawTextureTile(canvas.getContext('2d'), texture, size);
  return Array.from(canvas.getContext('2d').getImageData(0, 0, size, size).data);
};

describe('textureTileSizeFor', () => {
  it('scales the base tile and clamps degenerate values', () => {
    expect(textureTileSizeFor({ type: 'grain' })).toBe(64);
    expect(textureTileSizeFor({ type: 'grain', scale: 2 })).toBe(128);
    expect(textureTileSizeFor({ type: 'grain', scale: 0.01 })).toBe(2);
    expect(textureTileSizeFor({ type: 'grain', scale: 100 })).toBe(512);
  });
});

describe('drawTextureTile', () => {
  it('is deterministic — the same texture paints the same tile twice', () => {
    const texture: DesignerTexture = { type: 'grain', intensity: 0.5, seed: 7 };
    expect(tilePixels(texture)).toEqual(tilePixels(texture));
  });

  it('changes with the seed', () => {
    const a = tilePixels({ type: 'grain', intensity: 0.5, seed: 1 });
    const b = tilePixels({ type: 'grain', intensity: 0.5, seed: 2 });
    expect(a).not.toEqual(b);
  });

  it('keeps the tile ground TRANSPARENT so the base shows through', () => {
    // An opaque ground would replace the base fill instead of overlaying it.
    // Grain speckles carry alpha proportional to the noise, so fully opaque
    // pixels are not expected — but a majority of transparent/semi-transparent
    // ones must be present either way.
    const data = tilePixels({ type: 'paper', intensity: 0.4, seed: 3 });
    let translucent = 0;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 255) translucent++;
    }
    expect(translucent).toBeGreaterThan(data.length / 8);
  });

  it('grain scatters both lighter and darker speckles', () => {
    const size = textureTileSizeFor({ type: 'grain' });
    const canvas = createCanvas(size, size);
    drawTextureTile(canvas.getContext('2d'), { type: 'grain', intensity: 0.8, seed: 5 }, size);
    let light = 0;
    let dark = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const [r, , , a] = px(canvas, x, y);
        if (a === 0) continue;
        if (r === 255) light++;
        else dark++;
      }
    }
    expect(light).toBeGreaterThan(0);
    expect(dark).toBeGreaterThan(0);
  });

  it('paints nothing at intensity 0', () => {
    const data = tilePixels({ type: 'grain', intensity: 0, seed: 1 });
    expect(data.every((v) => v === 0)).toBe(true);
  });

  it('respects the default intensity when none is stored', () => {
    const explicit = tilePixels({ type: 'grain', intensity: 0.35, seed: 9 });
    const defaulted = tilePixels({ type: 'grain', seed: 9 });
    expect(defaulted).toEqual(explicit);
  });
});

describe('drawTextureOverlay', () => {
  it('composites over the painted base instead of replacing it', () => {
    const canvas = createCanvas(64, 64);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#224488';
    ctx.fillRect(0, 0, 64, 64);
    const before = px(canvas, 10, 10);

    drawTextureOverlay(ctx, { type: 'grain', intensity: 0.6, seed: 1 }, 64, 64, createCanvas);

    // Some pixels moved off the base colour, and the base is still the anchor:
    // the average pixel stays close to it rather than flooding black or white.
    let moved = 0;
    let sumR = 0;
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const [r, , , a] = px(canvas, x, y);
        expect(a).toBe(255);
        sumR += r;
        if (r !== before[0]) moved++;
      }
    }
    expect(moved).toBeGreaterThan(0);
    expect(Math.abs(sumR / (64 * 64) - 0x22)).toBeLessThan(40);
  });

  it('leaves the base untouched without a texture or at zero intensity', () => {
    const canvas = createCanvas(16, 16);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#abcdef';
    ctx.fillRect(0, 0, 16, 16);
    drawTextureOverlay(ctx, undefined, 16, 16, createCanvas);
    drawTextureOverlay(ctx, { type: 'paper', intensity: 0 }, 16, 16, createCanvas);
    expect(px(canvas, 8, 8)).toEqual([0xab, 0xcd, 0xef, 255]);
  });
});

describe('backgroundTextureSource (frame-renderer lockstep)', () => {
  // The video frame page cannot import this module; it runs the STRINGIFIED
  // copy. Evaluating that copy and diffing it against the real functions is
  // what stops the third renderer silently forking — the keyframes precedent.
  const injected = () => {
    const fn = new Function(
      `${backgroundTextureSource()}\nreturn { drawTextureTile, textureTileSizeFor, drawTextureOverlay };`
    ) as () => {
      drawTextureTile: typeof drawTextureTile;
      textureTileSizeFor: typeof textureTileSizeFor;
      drawTextureOverlay: typeof drawTextureOverlay;
    };
    return fn();
  };

  const recordTile = (draw: typeof drawTextureTile, texture: DesignerTexture, size: number) => {
    const calls: unknown[] = [];
    const ctx = {
      fillStyle: '',
      fillRect(x: number, y: number, w: number, h: number) {
        calls.push([ctx.fillStyle, x, y, w, h]);
      },
    };
    draw(ctx, texture, size);
    return calls;
  };

  it('serializes every function the frame renderer calls', () => {
    const src = backgroundTextureSource();
    for (const name of [
      'textureTileSizeFor',
      'textureNoise',
      'textureSpeckle',
      'drawTextureTile',
      'drawTextureOverlay',
    ]) {
      expect(src).toContain(name);
    }
  });

  it('the injected tile painter matches the real one call for call', () => {
    const texture: DesignerTexture = { type: 'paper', intensity: 0.5, scale: 2, seed: 42 };
    const size = 128;
    expect(recordTile(injected().drawTextureTile, texture, size)).toEqual(
      recordTile(drawTextureTile, texture, size)
    );
  });

  it('the injected tile size matches the real one', () => {
    expect(injected().textureTileSizeFor({ scale: 3 })).toBe(
      textureTileSizeFor({ scale: 3 })
    );
  });
});
