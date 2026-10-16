import type { DesignerTexture } from './designer-doc.schema';

/**
 * Procedural background textures — `grain` and `paper` overlays on an output's
 * background.
 *
 * A texture is an OVERLAY: the base (color, gradient or image) paints first and
 * the texture is a transparent-ground tile of light/dark speckles composited
 * over it, with `intensity` baked into the speckle alpha. That is what keeps
 * the three renderers in lockstep — each just pattern-fills the page rect with
 * the same tile, and the tile is drawn by this one module through a minimal
 * 2D-context interface, exactly as `pattern-tiles` does for pattern fills.
 *
 * Everything is a deterministic hash of (cell, seed) — no Math.random at render
 * time — so a re-render, a server render and a video frame all produce the same
 * pixels for the same doc.
 *
 * The frame renderer is injected as a string and cannot import, so every
 * function here is a self-contained arrow const and `backgroundTextureSource()`
 * stringifies the lot for it — the same mechanism `motion-blur` uses. Keep the
 * functions free of module-scope references that are not in that source.
 */

export const TEXTURE_PRESETS = ['grain', 'paper'] as const;

/** Base tile edge in px before `scale` is applied. */
export const BASE_TEXTURE_TILE_SIZE = 64;

/** Overlay strength when the doc carries no explicit `intensity`. */
export const DEFAULT_TEXTURE_INTENSITY = 0.35;

/** Tile edge clamp — a pattern tile is redrawn per render, so bound the work. */
export const MAX_TEXTURE_TILE_SIZE = 512;

export const textureTileSizeFor = (texture: {
  scale?: number;
}): number =>
  Math.max(
    2,
    Math.min(
      MAX_TEXTURE_TILE_SIZE,
      Math.round(BASE_TEXTURE_TILE_SIZE * (texture.scale ?? 1))
    )
  );

/**
 * Stable hash noise in [0,1) — same value for the same cell and seed, every
 * render. Same family as the 'noise' pattern preset's hash, extended with a
 * seed so two textured backgrounds need not share one grain.
 */
const textureNoise = (x: number, y: number, seed: number): number => {
  let h =
    Math.imul(x | 0, 0x27d4eb2d) ^
    Math.imul(y | 0, 0x165667b1) ^
    Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x2545f491);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/**
 * One speckle: a light or dark cell at a quantized alpha. The alpha is rounded
 * to 3 decimals so the rgba() string both canvas implementations parse is
 * byte-identical.
 */
const textureSpeckle = (
  ctx: {
    fillStyle: string;
    fillRect(x: number, y: number, w: number, h: number): void;
  },
  x: number,
  y: number,
  cell: number,
  light: boolean,
  alpha: number
): void => {
  if (alpha <= 0) return;
  ctx.fillStyle =
    (light ? 'rgba(255, 255, 255, ' : 'rgba(0, 0, 0, ') +
    Math.round(alpha * 1000) / 1000 +
    ')';
  ctx.fillRect(x, y, cell, cell);
};

/**
 * Paint one tile. The caller supplies a TRANSPARENT context sized to
 * `textureTileSizeFor(texture)` — the overlay ground must stay transparent so
 * the pattern composites over the background base instead of replacing it.
 */
export const drawTextureTile = (
  ctx: {
    fillStyle: string;
    fillRect(x: number, y: number, w: number, h: number): void;
  },
  texture: DesignerTexture,
  size: number
): void => {
  const intensity = texture.intensity ?? DEFAULT_TEXTURE_INTENSITY;
  if (intensity <= 0) return;
  const seed = texture.seed ?? 0;

  if (texture.type === 'paper') {
    // Paper is cloudy, low-frequency mottling rather than per-pixel speckle:
    // a coarse octave for the broad light/dark patches, then a finer one at
    // half strength for the fibre-like variation inside them.
    const coarse = Math.max(2, Math.round(size / 8));
    for (let y = 0; y < size; y += coarse) {
      for (let x = 0; x < size; x += coarse) {
        const n = textureNoise(x / coarse, y / coarse, seed);
        textureSpeckle(
          ctx,
          x,
          y,
          coarse,
          n >= 0.5,
          Math.abs(n - 0.5) * intensity
        );
      }
    }
    const fine = Math.max(1, Math.round(size / 32));
    for (let y = 0; y < size; y += fine) {
      for (let x = 0; x < size; x += fine) {
        const n = textureNoise(x / fine, y / fine, seed ^ 0x5bd1e995);
        textureSpeckle(
          ctx,
          x,
          y,
          fine,
          n >= 0.5,
          Math.abs(n - 0.5) * 0.5 * intensity
        );
      }
    }
    return;
  }

  // Grain: per-pixel film speckle, both darker and lighter than the base, with
  // the alpha following the noise value so it reads as grain, not confetti.
  const cell = Math.max(1, Math.round(size / 64));
  for (let y = 0; y < size; y += cell) {
    for (let x = 0; x < size; x += cell) {
      const n = textureNoise(x / cell, y / cell, seed);
      textureSpeckle(ctx, x, y, cell, n >= 0.5, Math.abs(n - 0.5) * 2 * intensity);
    }
  }
};

/**
 * Composite a texture over an already-painted background rect. Shared by the
 * server renderer and the frame page; the Konva canvas does the same thing
 * declaratively with a `fillPatternImage` Rect (see `designer/textures.ts`).
 */
export const drawTextureOverlay = (
  ctx: any,
  texture: DesignerTexture | undefined,
  width: number,
  height: number,
  createCanvas: (w: number, h: number) => any
): void => {
  if (!texture) return;
  if ((texture.intensity ?? DEFAULT_TEXTURE_INTENSITY) <= 0) return;
  const size = textureTileSizeFor(texture);
  const tile = createCanvas(size, size);
  drawTextureTile(tile.getContext('2d'), texture, size);
  ctx.save();
  ctx.fillStyle = ctx.createPattern(tile, 'repeat');
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
};

/** These same functions as JavaScript source, for the injected frame renderer. */
export const backgroundTextureSource = (): string => {
  const decl = (name: string, value: unknown) => `const ${name} = ${String(value)};`;
  return [
    `const BASE_TEXTURE_TILE_SIZE = ${BASE_TEXTURE_TILE_SIZE};`,
    `const DEFAULT_TEXTURE_INTENSITY = ${DEFAULT_TEXTURE_INTENSITY};`,
    `const MAX_TEXTURE_TILE_SIZE = ${MAX_TEXTURE_TILE_SIZE};`,
    decl('textureTileSizeFor', textureTileSizeFor),
    decl('textureNoise', textureNoise),
    decl('textureSpeckle', textureSpeckle),
    decl('drawTextureTile', drawTextureTile),
    decl('drawTextureOverlay', drawTextureOverlay),
  ].join('\n');
};
