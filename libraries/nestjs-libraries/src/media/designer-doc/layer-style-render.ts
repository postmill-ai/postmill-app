import type {
  DesignerElement,
  DesignerGradient,
  DesignerLayerStyle,
} from './designer-doc.schema';
import { styleBlur, styleOffset } from './layer-styles';
import { canvasCompositeFor, isNativeBlend } from './pixel-ops';

/**
 * How a layer style is painted, shared by the Konva canvas and the server
 * renderer.
 *
 * Every effect keys off the ALPHA of a buffer holding the layer on its own — a
 * drop shadow is that silhouette blurred and offset, an inner shadow is the
 * same silhouette inverted and clipped back in. Working from the buffer is what
 * lets one implementation cover text, images, paths and shapes alike.
 *
 * This module exists so the two renderers cannot drift: `design-render.service`
 * and `layer-render.tsx` both call these functions with their own canvas
 * factory, rather than each keeping a lookalike copy. It is deliberately plain
 * 2D-context code with no DOM or node-canvas import.
 *
 * Known simplifications, kept identical on both sides rather than improved on
 * one: **satin** renders as a second inner shadow, and **bevel & emboss** draws
 * only the highlight half — so `shadowColor`, `soften` and the bevel `style`
 * variants are stored but not yet expressed.
 */

/**
 * Blur a canvas in place.
 *
 * `ctx.filter = 'blur(Npx)'` is accepted but silently ignored by node-canvas,
 * which is why every blur-based effect (glows, inner shadows, the soft part of
 * a drop shadow) used to render hard-edged in exports while looking correct in
 * a browser. Doing it in pixel space instead means one implementation and no
 * divergence.
 *
 * Three box passes approximate a Gaussian closely enough for a shadow, at a
 * fraction of the cost. Alpha is premultiplied first, or transparent pixels
 * drag their black RGB into the result and every glow grows a dark halo.
 */
export const blurCanvas = (canvas: any, radius: number): void => {
  const r = Math.round(radius);
  if (!(r > 0)) return;
  const width = canvas.width;
  const height = canvas.height;
  if (!width || !height) return;

  const ctx = canvas.getContext('2d');
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;

  // Premultiply.
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] / 255;
    data[i] *= a;
    data[i + 1] *= a;
    data[i + 2] *= a;
  }

  const scratch = new Float32Array(data.length);
  for (let pass = 0; pass < 3; pass++) {
    boxBlurH(data, scratch, width, height, r);
    boxBlurV(scratch, data, width, height, r);
  }

  // Unpremultiply.
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] / 255;
    if (a > 0) {
      data[i] = Math.min(255, data[i] / a);
      data[i + 1] = Math.min(255, data[i + 1] / a);
      data[i + 2] = Math.min(255, data[i + 2] / a);
    }
  }

  ctx.putImageData(image, 0, 0);
};

const boxBlurH = (
  src: Uint8ClampedArray | Float32Array,
  dst: Uint8ClampedArray | Float32Array,
  width: number,
  height: number,
  radius: number
): void => {
  const span = radius * 2 + 1;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let c = 0; c < 4; c++) {
      let sum = 0;
      for (let x = -radius; x <= radius; x++) {
        sum += src[row + Math.min(width - 1, Math.max(0, x)) * 4 + c];
      }
      for (let x = 0; x < width; x++) {
        dst[row + x * 4 + c] = sum / span;
        const out = Math.min(width - 1, Math.max(0, x - radius));
        const into = Math.min(width - 1, Math.max(0, x + radius + 1));
        sum += src[row + into * 4 + c] - src[row + out * 4 + c];
      }
    }
  }
};

const boxBlurV = (
  src: Uint8ClampedArray | Float32Array,
  dst: Uint8ClampedArray | Float32Array,
  width: number,
  height: number,
  radius: number
): void => {
  const span = radius * 2 + 1;
  const stride = width * 4;
  for (let x = 0; x < width; x++) {
    const col = x * 4;
    for (let c = 0; c < 4; c++) {
      let sum = 0;
      for (let y = -radius; y <= radius; y++) {
        sum += src[Math.min(height - 1, Math.max(0, y)) * stride + col + c];
      }
      for (let y = 0; y < height; y++) {
        dst[y * stride + col + c] = sum / span;
        const out = Math.min(height - 1, Math.max(0, y - radius));
        const into = Math.min(height - 1, Math.max(0, y + radius + 1));
        sum += src[into * stride + col + c] - src[out * stride + col + c];
      }
    }
  }
};

/** A page-sized (or element-rect-sized) region the effects are composited into. */
export interface StyleSurface {
  /** Origin of the buffer in element/page coordinates. */
  x: number;
  y: number;
  /** Extent of the buffer in the same coordinates. */
  width: number;
  height: number;
}

export interface LayerStyleDeps {
  /** Device-pixel canvas factory — `createCanvas` on the server, DOM on the client. */
  createCanvas(width: number, height: number): any;
  /**
   * Repeatable tile for a pattern overlay, already resolved. Returning null
   * falls the overlay back to its flat colour, which is what both renderers do
   * while an image-backed tile is still loading.
   */
  patternTile(style: DesignerLayerStyle): any | null;
}

/**
 * The canvas gradient for a style or fill.
 *
 * Linear runs through the box centre at `angle`; radial is centred with a
 * radius of half the longer side. Shared so the overlay, the `fill` layer and
 * an element's own `fillGradient` all agree.
 */
export const buildStyleGradient = (
  ctx: any,
  g: DesignerGradient,
  width: number,
  height: number
): any => {
  let grad: any;
  if (g.type === 'radial') {
    const r = Math.max(width, height) / 2;
    // The inner circle can be moved off centre, which is what turns a radial
    // from a bullseye into a light source. Centred when unset, exactly as
    // before.
    const fx = (g.focalX ?? 0.5) * width;
    const fy = (g.focalY ?? 0.5) * height;
    grad = ctx.createRadialGradient(fx, fy, 0, width / 2, height / 2, r);
  } else {
    const angle = ((g.angle ?? 0) * Math.PI) / 180;
    const halfW = width / 2;
    const halfH = height / 2;
    const dx = Math.cos(angle) * halfW;
    const dy = Math.sin(angle) * halfH;
    grad = ctx.createLinearGradient(halfW - dx, halfH - dy, halfW + dx, halfH + dy);
  }
  for (const stop of g.stops ?? []) {
    grad.addColorStop(Math.min(1, Math.max(0, stop.offset)), stop.color);
  }
  return grad;
};

/** Drop Shadow / Outer Glow — the layer's silhouette, blurred behind it. */
export const drawUnderStyle = (
  ctx: any,
  layer: any,
  style: DesignerLayerStyle,
  ratio: number,
  surface: StyleSurface,
  deps: LayerStyleDeps
): void => {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const shadow = deps.createCanvas(w, h);
  const sctx: any = shadow.getContext('2d');

  // Tint the silhouette: draw it, then flood the colour through source-in.
  sctx.drawImage(layer, 0, 0);
  sctx.globalCompositeOperation = 'source-in';
  sctx.fillStyle = style.color || '#000000';
  sctx.fillRect(0, 0, w, h);

  // Blurred in the buffer's own device pixels, so the softness is the same
  // whatever scale the page is being rendered at.
  blurCanvas(shadow, styleBlur(style) * ratio);

  const offset = styleOffset(style);
  ctx.save();
  ctx.globalAlpha = style.opacity ?? 0.75;
  ctx.drawImage(shadow, surface.x + offset.x, surface.y + offset.y, surface.width, surface.height);
  ctx.restore();
};

/** Overlays, inner shadow/glow, stroke, bevel and satin — all clipped to the layer. */
export const drawOverStyle = (
  ctx: any,
  layer: any,
  el: DesignerElement,
  style: DesignerLayerStyle,
  ratio: number,
  surface: StyleSurface,
  deps: LayerStyleDeps
): void => {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const buf = deps.createCanvas(w, h);
  const bctx: any = buf.getContext('2d');

  if (
    style.type === 'color-overlay' ||
    style.type === 'gradient-overlay' ||
    style.type === 'pattern-overlay'
  ) {
    bctx.drawImage(layer, 0, 0);
    bctx.globalCompositeOperation = 'source-in';
    bctx.scale(ratio, ratio);
    if (style.type === 'gradient-overlay' && style.gradient) {
      bctx.fillStyle = buildStyleGradient(bctx, style.gradient, el.width, el.height);
    } else if (style.type === 'pattern-overlay' && style.pattern) {
      const tile = deps.patternTile(style);
      bctx.fillStyle = tile ? bctx.createPattern(tile, 'repeat') : style.color || '#000000';
    } else {
      bctx.fillStyle = style.color || '#000000';
    }
    // Anchored to the element's own origin so a gradient or pattern is placed
    // relative to the layer, while still flooding the whole buffer.
    bctx.translate(el.x - surface.x, el.y - surface.y);
    bctx.fillRect(-(el.x - surface.x), -(el.y - surface.y), surface.width, surface.height);
  } else if (
    style.type === 'inner-shadow' ||
    style.type === 'inner-glow' ||
    style.type === 'satin'
  ) {
    // Inner effects light the INVERSE silhouette, then clip back inside the
    // layer — the same destination-in trick the text mask uses.
    const inverse = deps.createCanvas(w, h);
    const ictx: any = inverse.getContext('2d');
    ictx.fillStyle = style.color || '#000000';
    ictx.fillRect(0, 0, w, h);
    ictx.globalCompositeOperation = 'destination-out';
    ictx.drawImage(layer, 0, 0);

    const offset = style.type === 'inner-glow' ? { x: 0, y: 0 } : styleOffset(style);
    // Never zero: an unblurred inner shadow is the exact complement of the
    // layer, so clipping it back inside leaves literally nothing.
    const blur = styleBlur(style) || 4;
    blurCanvas(inverse, blur * ratio);
    bctx.drawImage(inverse, offset.x * ratio, offset.y * ratio);
    bctx.globalCompositeOperation = 'destination-in';
    bctx.drawImage(layer, 0, 0);
  } else if (style.type === 'stroke') {
    // Approximate an outline by stamping the silhouette around a ring, then
    // removing the interior — no path data needed, so it works for images too.
    const size = Math.max(1, style.size ?? 1) * ratio;
    bctx.fillStyle = style.color || '#000000';
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
      bctx.drawImage(layer, Math.cos(a) * size, Math.sin(a) * size);
    }
    bctx.globalCompositeOperation = 'source-in';
    bctx.fillRect(0, 0, w, h);
    if (style.position !== 'center') {
      bctx.globalCompositeOperation =
        style.position === 'inside' ? 'destination-in' : 'destination-out';
      bctx.drawImage(layer, 0, 0);
    }
  } else if (style.type === 'bevel-emboss') {
    // Offset highlight copy of the silhouette, clipped inside — a cheap but
    // recognisable bevel. See the note at the top about the missing shadow half.
    const offset = styleOffset({ ...style, distance: (style.depth ?? 100) / 20 });
    bctx.globalAlpha = 0.6;
    bctx.drawImage(layer, -offset.x * ratio, -offset.y * ratio);
    bctx.globalCompositeOperation = 'source-in';
    bctx.fillStyle = style.highlightColor || '#ffffff';
    bctx.fillRect(0, 0, w, h);
    bctx.globalCompositeOperation = 'destination-in';
    bctx.drawImage(layer, 0, 0);
  }

  ctx.save();
  ctx.globalAlpha = style.opacity ?? 1;
  if (isNativeBlend(style.blendMode)) {
    ctx.globalCompositeOperation = canvasCompositeFor(style.blendMode);
  }
  ctx.drawImage(buf, surface.x, surface.y, surface.width, surface.height);
  ctx.restore();
};

/**
 * Frosted glass: blur and desaturate what is already painted behind a layer,
 * inside that layer's own silhouette.
 *
 * The stated blocker for this — "Konva can't give a node its backdrop", which
 * is also why eleven blend modes were unselectable — stopped being true once
 * layers composited through their own buffers: inside a `sceneFunc` the layer
 * canvas already holds everything drawn beneath, which IS the backdrop. The
 * server has had it all along, compositing page-wise.
 *
 * `region` is in DEVICE pixels, because both callers read back from a scaled
 * context and logical coordinates would sample the wrong rectangle on a hi-dpi
 * render — the same trap `applyBlend` documents.
 */
export const paintBackdropFilter = (
  ctx: any,
  filter: { blur?: number; saturate?: number },
  region: { x: number; y: number; width: number; height: number },
  ratio: number,
  createCanvas: (w: number, h: number) => any,
  /**
   * The frosted area inside `region`, in device pixels, with its corner radii.
   *
   * The element's BOX, not its paint — the same rule CSS `backdrop-filter`
   * follows, and the only one that works for the shape this feature exists for:
   * a glass panel is usually a rounded rect with little or no fill of its own,
   * which has no silhouette to clip to.
   */
  shape?: { x: number; y: number; width: number; height: number; radii: number[] }
): void => {
  const blur = filter.blur ?? 0;
  const saturate = filter.saturate ?? 1;
  if (!(blur > 0) && saturate === 1) return;

  const x = Math.max(0, Math.floor(region.x));
  const y = Math.max(0, Math.floor(region.y));
  const width = Math.min(ctx.canvas.width - x, Math.ceil(region.width));
  const height = Math.min(ctx.canvas.height - y, Math.ceil(region.height));
  if (width <= 0 || height <= 0) return;

  const buffer = createCanvas(width, height);
  const bctx: any = buffer.getContext('2d');
  bctx.putImageData(ctx.getImageData(x, y, width, height), 0, 0);

  // Blur in device pixels, so a hi-dpi export is as soft as the preview rather
  // than proportionally sharper.
  if (blur > 0) blurCanvas(buffer, blur * ratio);

  if (saturate !== 1) {
    const image = bctx.getImageData(0, 0, width, height);
    const data = image.data;
    // The spec's luminance coefficients, matching `filter-pixels`.
    for (let i = 0; i < data.length; i += 4) {
      const lum = 0.213 * data[i] + 0.715 * data[i + 1] + 0.072 * data[i + 2];
      data[i] = Math.max(0, Math.min(255, lum + (data[i] - lum) * saturate));
      data[i + 1] = Math.max(0, Math.min(255, lum + (data[i + 1] - lum) * saturate));
      data[i + 2] = Math.max(0, Math.min(255, lum + (data[i + 2] - lum) * saturate));
    }
    bctx.putImageData(image, 0, 0);
  }

  // Clipped to the panel, or a rounded one would frost its bounding box and
  // the square corners would give it away.
  if (shape) {
    const [tl, tr, br, bl] = shape.radii;
    bctx.globalCompositeOperation = 'destination-in';
    bctx.fillStyle = '#000000';
    bctx.beginPath();
    const left = shape.x;
    const top = shape.y;
    const right = shape.x + shape.width;
    const bottom = shape.y + shape.height;
    bctx.moveTo(left + tl, top);
    bctx.arcTo(right, top, right, bottom, tr);
    bctx.arcTo(right, bottom, left, bottom, br);
    bctx.arcTo(left, bottom, left, top, bl);
    bctx.arcTo(left, top, right, top, tl);
    bctx.closePath();
    bctx.fill();
    bctx.globalCompositeOperation = 'source-over';
  }

  const transform = ctx.getTransform?.();
  ctx.save();
  // Device space for the write-back, since the region was measured there.
  if (transform) ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(buffer, x, y);
  ctx.restore();
};
