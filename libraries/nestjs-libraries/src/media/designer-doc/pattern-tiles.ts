import type { DesignerPattern } from './designer-doc.schema';

/**
 * Procedural pattern tiles for Pattern Fill and Pattern Overlay.
 *
 * Drawn through a minimal 2D-context interface so the same code produces the
 * tile on the Designer canvas (DOM canvas) and in the server renderer
 * (node-canvas) — the parity rule that applies to every shared drawing helper
 * here.
 *
 * Patterns that come from an uploaded image don't use this at all; the caller
 * loads the image and tiles it directly.
 */

/** The subset of CanvasRenderingContext2D a tile generator needs. */
export interface TileContext {
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  fillRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  arc(x: number, y: number, r: number, a0: number, a1: number): void;
  fill(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
}

/** Base tile edge in px before `scale` is applied. */
export const BASE_TILE_SIZE = 32;

export const PATTERN_PRESETS = ['stripes', 'dots', 'grid', 'checker', 'noise'] as const;

export const tileSizeFor = (pattern: DesignerPattern): number =>
  Math.max(2, Math.round(BASE_TILE_SIZE * (pattern.scale ?? 1)));

/**
 * Paint one tile. The caller supplies a context already sized to
 * `tileSizeFor(pattern)` and turns the result into a repeating fill.
 */
export const drawPatternTile = (
  ctx: TileContext,
  pattern: DesignerPattern,
  size: number
): void => {
  const fg = pattern.color || '#000000';
  const bg = pattern.background || '#ffffff';

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = fg;
  ctx.strokeStyle = fg;

  switch (pattern.preset) {
    case 'stripes':
      // A half-width bar; rotation is applied by the caller's transform so the
      // tile itself stays seamless.
      ctx.fillRect(0, 0, size / 2, size);
      break;

    case 'dots': {
      const r = size / 6;
      ctx.beginPath();
      ctx.arc(size / 4, size / 4, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc((size * 3) / 4, (size * 3) / 4, r, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    case 'grid':
      ctx.lineWidth = Math.max(1, size / 16);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(size, 0);
      ctx.moveTo(0, 0);
      ctx.lineTo(0, size);
      ctx.stroke();
      break;

    case 'checker':
      ctx.fillRect(0, 0, size / 2, size / 2);
      ctx.fillRect(size / 2, size / 2, size / 2, size / 2);
      break;

    case 'noise': {
      // Deterministic so a re-render produces the identical tile — a random
      // one would make the canvas and the export disagree.
      const cell = Math.max(1, Math.floor(size / 16));
      for (let y = 0; y < size; y += cell) {
        for (let x = 0; x < size; x += cell) {
          if (noiseAt(x / cell, y / cell) > 0.5) ctx.fillRect(x, y, cell, cell);
        }
      }
      break;
    }

    default:
      break;
  }
};

/** Stable hash noise in [0,1) — same value for the same cell, every render. */
const noiseAt = (x: number, y: number): number => {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2545f491);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
