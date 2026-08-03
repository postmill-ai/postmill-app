import { blendPixels, parseHex } from './pixel-ops';
import type { DesignerBlendMode } from './designer-doc.schema';

/**
 * Edit ▸ Fill and Edit ▸ Stroke, as pure pixel operations.
 *
 * Both take a COVERAGE map the same size as the target — 0 = untouched, 255 =
 * fully covered — so the caller decides what the shape is (the whole layer, the
 * selection, or the band around it) and this module only decides what colour
 * goes there and how it composites. That is what lets Fill and Stroke share one
 * implementation with each other and with the filter runner's selection
 * clipping.
 *
 * Lives beside `pixel-ops` rather than in the app because it is pure
 * `ImageData` work with no DOM, which keeps it unit-testable.
 */

/**
 * Structurally an `ImageData` without needing the constructor, which does not
 * exist in plain Node — this module is imported by the server too.
 */
export interface PixelBuffer {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

const buffer = (width: number, height: number): PixelBuffer => ({
  width,
  height,
  data: new Uint8ClampedArray(width * height * 4),
});

export type FillContents =
  | 'color'
  | 'black'
  | 'white'
  | 'gray'
  | 'pattern';

export interface FillOptions {
  contents: FillContents;
  /** Used when `contents` is `color`. */
  color?: string;
  /** Tile for `contents: 'pattern'`, already rendered by the caller. */
  pattern?: PixelBuffer;
  blendMode?: DesignerBlendMode;
  /** 0–1. */
  opacity?: number;
  /**
   * Photoshop's "Preserve Transparency": paint only where the layer already has
   * pixels, so a fill can recolour a shape without squaring it off.
   */
  preserveTransparency?: boolean;
}

/** The literal colours behind Photoshop's fixed Contents entries. */
const CONTENT_COLORS: Record<string, [number, number, number]> = {
  black: [0, 0, 0],
  white: [255, 255, 255],
  gray: [128, 128, 128],
};

const resolveColor = (options: FillOptions): [number, number, number] => {
  if (options.contents === 'color') return parseHex(options.color || '#000000');
  return CONTENT_COLORS[options.contents] || [0, 0, 0];
};

/**
 * Build the layer of paint a fill would deposit, before compositing.
 *
 * Separate from `fill` so Stroke can reuse it with a different coverage map,
 * and so tests can inspect the paint without the blend maths on top.
 */
export const buildFillSource = (
  width: number,
  height: number,
  coverage: Uint8ClampedArray,
  options: FillOptions
): PixelBuffer => {
  const out = buffer(width, height);
  const d = out.data;

  if (options.contents === 'pattern' && options.pattern) {
    const p = options.pattern;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const cov = coverage[y * width + x];
        if (!cov) continue;
        // Tile by wrapping — the caller supplies one tile, not a full sheet.
        const pi = ((y % p.height) * p.width + (x % p.width)) * 4;
        d[i] = p.data[pi];
        d[i + 1] = p.data[pi + 1];
        d[i + 2] = p.data[pi + 2];
        d[i + 3] = (p.data[pi + 3] * cov) / 255;
      }
    }
    return out;
  }

  const [r, g, b] = resolveColor(options);
  for (let i = 0, px = 0; i < d.length; i += 4, px++) {
    const cov = coverage[px];
    if (!cov) continue;
    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = b;
    d[i + 3] = cov;
  }
  return out;
};

/**
 * Fill `target` in place wherever `coverage` says to.
 *
 * `coverage` is the caller's shape: the selection intersected with the layer,
 * or a solid block when nothing is selected.
 */
export const fill = (
  target: PixelBuffer,
  coverage: Uint8ClampedArray,
  options: FillOptions
): void => {
  const source = buildFillSource(target.width, target.height, coverage, options);

  if (options.preserveTransparency) {
    // Clip the paint to what the layer already covers.
    const s = source.data;
    const t = target.data;
    for (let i = 3; i < s.length; i += 4) {
      s[i] = (s[i] * t[i]) / 255;
    }
  }

  blendPixels(
    target as ImageData,
    source as ImageData,
    options.blendMode || 'normal',
    options.opacity ?? 1
  );
};

export interface StrokeOptions extends Omit<FillOptions, 'contents'> {
  contents?: FillContents;
  /** Stroke width in pixels. */
  width: number;
  location: 'inside' | 'center' | 'outside';
}

/**
 * Stroke in place along the edge of `coverage`.
 *
 * The band is computed by the caller (`strokeBand` in `selection-mask`), since
 * that is where the mask maths lives; this just paints it. Kept as its own
 * export so the intent reads at the call site even though it delegates.
 */
export const stroke = (
  target: PixelBuffer,
  band: Uint8ClampedArray,
  options: StrokeOptions
): void => {
  fill(target, band, {
    contents: options.contents || 'color',
    color: options.color,
    pattern: options.pattern,
    blendMode: options.blendMode,
    opacity: options.opacity,
    preserveTransparency: options.preserveTransparency,
  });
};
