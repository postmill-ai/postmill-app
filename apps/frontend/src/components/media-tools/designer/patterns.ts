import type { DesignerPattern } from './designer.store';
import {
  drawPatternTile,
  tileSizeFor,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/pattern-tiles';

/**
 * Client side of the pattern system.
 *
 * The tile itself is drawn by the shared `pattern-tiles` generator that the
 * server renderer also uses, so a pattern fill exports exactly as it appears.
 * This module only turns that tile into Konva's fill props and caches it.
 */

const tileCache = new Map<string, HTMLCanvasElement>();

const cacheKey = (p: DesignerPattern) =>
  JSON.stringify([p.preset, p.src, p.scale, p.color, p.background]);

/** The repeating tile for a pattern, or null when it needs an image we can't draw. */
export const patternTile = (pattern: DesignerPattern): HTMLCanvasElement | null => {
  // Image-backed patterns are loaded by the caller; only presets are generated.
  if (!pattern.preset) return null;

  const key = cacheKey(pattern);
  const cached = tileCache.get(key);
  if (cached) return cached;

  const size = tileSizeFor(pattern);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  drawPatternTile(ctx as never, pattern, size);

  tileCache.set(key, canvas);
  return canvas;
};

/** Konva fill props for a pattern — image plus its repeat/scale/offset. */
export const patternFillProps = (pattern: DesignerPattern) => {
  const tile = patternTile(pattern);
  if (!tile) return { fill: pattern.background || '#ffffff' };
  return {
    fillPatternImage: tile as unknown as HTMLImageElement,
    fillPatternRepeat: 'repeat',
    fillPatternRotation: pattern.angle ?? 0,
    fillPatternOffset: { x: pattern.offsetX ?? 0, y: pattern.offsetY ?? 0 },
  };
};
