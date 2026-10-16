import type { DesignerTexture } from './designer.store';
import {
  drawTextureTile,
  textureTileSizeFor,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/background-texture';

/**
 * Client side of background textures.
 *
 * The tile itself is drawn by the shared `background-texture` generator that
 * the server renderer and the video frame page also use, so a textured
 * background exports exactly as it appears on the canvas. This module only
 * turns that tile into Konva's fill props and caches it — the same split
 * `patterns.ts` uses for pattern fills.
 */

const tileCache = new Map<string, HTMLCanvasElement>();

export const textureCacheKey = (t: DesignerTexture) =>
  JSON.stringify([t.type, t.intensity, t.scale, t.seed]);

/** The repeating overlay tile for a texture, cached per parameter set. */
export const textureTile = (texture: DesignerTexture): HTMLCanvasElement | null => {
  const key = textureCacheKey(texture);
  const cached = tileCache.get(key);
  if (cached) return cached;

  const size = textureTileSizeFor(texture);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  drawTextureTile(ctx as never, texture, size);

  tileCache.set(key, canvas);
  return canvas;
};

/** Konva fill props for a texture overlay Rect — the tile as a repeating pattern. */
export const textureFillProps = (texture: DesignerTexture) => {
  const tile = textureTile(texture);
  if (!tile) return {};
  return {
    fillPatternImage: tile as unknown as HTMLImageElement,
    fillPatternRepeat: 'repeat',
  };
};
