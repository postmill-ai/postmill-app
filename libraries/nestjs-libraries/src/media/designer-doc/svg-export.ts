/**
 * SVG export — a TRANSLATION of the document, never a fourth renderer.
 *
 * The rule that keeps this honest: anything SVG cannot express is emitted as an
 * `<image>` rather than as an approximation. A layer style, a non-CSS blend
 * mode or a painted raster silently rendering differently in a browser than in
 * the Designer would be worse than a bitmap that is exactly right.
 *
 * Geometry comes from the same `shape-geometry` and `path-geometry` the
 * renderers trace, so a triangle here is the triangle on the canvas.
 */

import type {
  DesignerElement,
  DesignerGradient,
  DesignerOutput,
} from './designer-doc.schema';
import { pointsForShape } from './shape-geometry';
import type { DesignerPathNode } from './path-geometry';
import { buildLayerTree, type LayerNode } from './layer-tree';

/** Blend modes the CSS `mix-blend-mode` property actually has. */
const CSS_BLEND_MODES = new Set([
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
  'color-dodge', 'color-burn', 'hard-light', 'soft-light',
  'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity',
]);

const esc = (s: string): string =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const num = (n: number): string =>
  Number.isFinite(n) ? String(Math.round(n * 1000) / 1000) : '0';

/**
 * Whether a layer can be written as vector at all.
 *
 * Every "no" here is a layer that will be baked to `<image>` by the caller —
 * that is the contract, not a limitation to work around.
 */
export const isVectorExportable = (el: DesignerElement): boolean => {
  if (el.styles?.length) return false; // layer styles have no SVG equivalent
  if (el.smartFilters?.length) return false; // the recipe lives on the client
  if (el.maskSrc) return false; // a bitmap mask is a bitmap
  if (el.blendMode && !CSS_BLEND_MODES.has(el.blendMode)) return false;
  if (el.type === 'raster' || el.type === 'adjustment') return false;
  return true;
};

const gradientDef = (id: string, gradient: DesignerGradient): string => {
  const stops = (gradient.stops || [])
    .map(
      (s) =>
        `<stop offset="${num(Math.max(0, Math.min(1, s.offset)) * 100)}%" stop-color="${esc(
          s.color
        )}"/>`
    )
    .join('');

  if (gradient.type === 'radial') {
    return `<radialGradient id="${esc(id)}">${stops}</radialGradient>`;
  }
  // An angle in degrees, converted to the unit-square vector SVG wants.
  const rad = ((gradient.angle ?? 90) * Math.PI) / 180;
  const x = Math.cos(rad);
  const y = Math.sin(rad);
  return (
    `<linearGradient id="${esc(id)}" x1="${num(0.5 - x / 2)}" y1="${num(0.5 - y / 2)}"` +
    ` x2="${num(0.5 + x / 2)}" y2="${num(0.5 + y / 2)}">${stops}</linearGradient>`
  );
};

const pathData = (nodes: DesignerPathNode[], closed?: boolean): string => {
  if (!nodes.length) return '';
  let d = `M${num(nodes[0].x)},${num(nodes[0].y)}`;
  const last = closed ? nodes.length : nodes.length - 1;
  for (let i = 0; i < last; i++) {
    const a = nodes[i];
    const b = nodes[(i + 1) % nodes.length];
    const hasOut = typeof a.outX === 'number' && typeof a.outY === 'number';
    const hasIn = typeof b.inX === 'number' && typeof b.inY === 'number';
    if (!hasOut && !hasIn) {
      d += ` L${num(b.x)},${num(b.y)}`;
    } else {
      const c1x = hasOut ? (a.outX as number) : a.x;
      const c1y = hasOut ? (a.outY as number) : a.y;
      const c2x = hasIn ? (b.inX as number) : b.x;
      const c2y = hasIn ? (b.inY as number) : b.y;
      d += ` C${num(c1x)},${num(c1y)} ${num(c2x)},${num(c2y)} ${num(b.x)},${num(b.y)}`;
    }
  }
  if (closed) d += ' Z';
  return d;
};

const transformFor = (el: DesignerElement): string => {
  const parts: string[] = [`translate(${num(el.x)} ${num(el.y)})`];
  if (el.rotation) {
    parts.push(`rotate(${num(el.rotation)} ${num(el.width / 2)} ${num(el.height / 2)})`);
  }
  if (el.flipX || el.flipY) {
    parts.push(
      `translate(${num(el.flipX ? el.width : 0)} ${num(el.flipY ? el.height : 0)})`,
      `scale(${el.flipX ? -1 : 1} ${el.flipY ? -1 : 1})`
    );
  }
  return parts.join(' ');
};

const strokeAttrs = (el: DesignerElement): string => {
  if (!el.stroke || !el.strokeWidth) return '';
  const st = el.strokeStyle;
  let out = ` stroke="${esc(el.stroke)}" stroke-width="${num(el.strokeWidth)}"`;
  if (st?.dash?.length) out += ` stroke-dasharray="${st.dash.map(num).join(' ')}"`;
  if (st?.dashOffset) out += ` stroke-dashoffset="${num(st.dashOffset)}"`;
  if (st?.lineCap) out += ` stroke-linecap="${esc(st.lineCap)}"`;
  if (st?.lineJoin) out += ` stroke-linejoin="${esc(st.lineJoin)}"`;
  if (st?.miterLimit) out += ` stroke-miterlimit="${num(st.miterLimit)}"`;
  return out;
};

export interface SvgExportOptions {
  /**
   * Bitmaps for the layers SVG cannot express, keyed by element id. A layer
   * with no entry is skipped rather than drawn wrong.
   */
  rasterized?: Record<string, string>;
}

interface Ctx {
  defs: string[];
  options: SvgExportOptions;
  nextId: () => string;
}

const elementSvg = (el: DesignerElement, ctx: Ctx): string => {
  if (el.hidden) return '';

  const opacity = el.opacity == null || el.opacity === 1 ? '' : ` opacity="${num(el.opacity)}"`;
  const blend =
    el.blendMode && el.blendMode !== 'normal' && CSS_BLEND_MODES.has(el.blendMode)
      ? ` style="mix-blend-mode:${el.blendMode}"`
      : '';
  const open = `<g transform="${transformFor(el)}"${opacity}${blend}>`;

  if (!isVectorExportable(el)) {
    const src = ctx.options.rasterized?.[el.id];
    // No bitmap supplied means the caller could not rasterize it; drawing an
    // approximation would be the one thing this exporter promises not to do.
    if (!src) return '';
    return `${open}<image x="0" y="0" width="${num(el.width)}" height="${num(
      el.height
    )}" href="${esc(src)}" preserveAspectRatio="none"/></g>`;
  }

  let fill = el.fill ? ` fill="${esc(el.fill)}"` : ' fill="none"';
  if (el.fillGradient?.stops?.length) {
    const id = ctx.nextId();
    ctx.defs.push(gradientDef(id, el.fillGradient));
    fill = ` fill="url(#${id})"`;
  }

  const body = (() => {
    switch (el.type) {
      case 'group':
        return '';
      case 'image': {
        const src = el.src || ctx.options.rasterized?.[el.id];
        if (!src) return '';
        return `<image x="0" y="0" width="${num(el.width)}" height="${num(
          el.height
        )}" href="${esc(src)}" preserveAspectRatio="${
          el.fitMode === 'cover' ? 'xMidYMid slice' : el.fitMode === 'fill' ? 'none' : 'xMidYMid meet'
        }"/>`;
      }
      case 'text': {
        const size = el.fontSize || 16;
        const anchor =
          el.align === 'center' ? 'middle' : el.align === 'right' ? 'end' : 'start';
        const x = el.align === 'center' ? el.width / 2 : el.align === 'right' ? el.width : 0;
        const lines = String(el.text || '').split('\n');
        const tspans = lines
          .map(
            (line, i) =>
              `<tspan x="${num(x)}" dy="${i === 0 ? 0 : num(size * 1.2)}">${esc(line)}</tspan>`
          )
          .join('');
        return (
          `<text x="${num(x)}" y="${num(size)}" font-family="${esc(
            el.fontFamily || 'sans-serif'
          )}" font-size="${num(size)}" font-weight="${num(el.fontWeight || 400)}"` +
          `${el.fontStyle === 'italic' ? ' font-style="italic"' : ''}` +
          ` text-anchor="${anchor}"${fill}${strokeAttrs(el)}>${tspans}</text>`
        );
      }
      case 'path': {
        const d = pathData(el.nodes || [], el.closed);
        return d ? `<path d="${d}"${fill}${strokeAttrs(el)}/>` : '';
      }
      case 'fill': {
        const style = el.fillStyle;
        let f = style?.color ? ` fill="${esc(style.color)}"` : ' fill="none"';
        if (style?.gradient?.stops?.length) {
          const id = ctx.nextId();
          ctx.defs.push(gradientDef(id, style.gradient));
          f = ` fill="url(#${id})"`;
        }
        return `<rect x="0" y="0" width="${num(el.width)}" height="${num(el.height)}"${f}/>`;
      }
      case 'shape':
      case 'icon':
      default: {
        if (el.shape === 'ellipse') {
          return `<ellipse cx="${num(el.width / 2)}" cy="${num(el.height / 2)}" rx="${num(
            el.width / 2
          )}" ry="${num(el.height / 2)}"${fill}${strokeAttrs(el)}/>`;
        }
        if (el.shape === 'line') {
          return `<line x1="0" y1="${num(el.height / 2)}" x2="${num(el.width)}" y2="${num(
            el.height / 2
          )}"${strokeAttrs(el) || ` stroke="${esc(el.fill || '#000')}" stroke-width="2"`}/>`;
        }
        const points = pointsForShape(el.shape, el.width, el.height, el.sides, el.innerRatio);
        if (points) {
          return `<polygon points="${points
            .map((p) => `${num(p.x)},${num(p.y)}`)
            .join(' ')}"${fill}${strokeAttrs(el)}/>`;
        }
        const r = Math.min(el.borderRadius || 0, el.width / 2, el.height / 2);
        return `<rect x="0" y="0" width="${num(el.width)}" height="${num(el.height)}"${
          r > 0 ? ` rx="${num(r)}" ry="${num(r)}"` : ''
        }${fill}${strokeAttrs(el)}/>`;
      }
    }
  })();

  return `${open}${body}</g>`;
};

const nodeSvg = (node: LayerNode, ctx: Ctx): string => {
  const own = elementSvg(node.element, ctx);
  if (!node.children?.length) return own;
  // A group's own markup is its transform wrapper; the children go inside it.
  const inner = node.children.map((c) => nodeSvg(c, ctx)).join('');
  if (node.element.type === 'group') {
    return own.replace('</g>', `${inner}</g>`);
  }
  return own + inner;
};

const backgroundSvg = (output: DesignerOutput, ctx: Ctx): string => {
  const bg = output.bg;
  if (bg?.type === 'image' && bg.src) {
    return `<image x="0" y="0" width="${num(output.width)}" height="${num(
      output.height
    )}" href="${esc(bg.src)}" preserveAspectRatio="xMidYMid slice"/>`;
  }
  if (bg?.type === 'gradient' && bg.gradient?.stops?.length) {
    const id = ctx.nextId();
    ctx.defs.push(gradientDef(id, bg.gradient));
    return `<rect x="0" y="0" width="${num(output.width)}" height="${num(
      output.height
    )}" fill="url(#${id})"/>`;
  }
  const color = bg?.color || output.background || '#ffffff';
  return `<rect x="0" y="0" width="${num(output.width)}" height="${num(
    output.height
  )}" fill="${esc(color)}"/>`;
};

/** Which layers the caller must rasterize before calling, and why. */
export const layersNeedingRaster = (output: DesignerOutput): string[] =>
  (output.children || []).filter((el) => !el.hidden && !isVectorExportable(el)).map((el) => el.id);

/** Translate one output to a standalone SVG document. */
export const outputToSvg = (
  output: DesignerOutput,
  options: SvgExportOptions = {}
): string => {
  let counter = 0;
  const ctx: Ctx = {
    defs: [],
    options,
    nextId: () => `g${++counter}`,
  };

  const tree = buildLayerTree(output.children || []);
  const body = tree.map((node) => nodeSvg(node, ctx)).join('');
  const background = backgroundSvg(output, ctx);
  const defs = ctx.defs.length ? `<defs>${ctx.defs.join('')}</defs>` : '';

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"` +
    ` width="${num(output.width)}" height="${num(output.height)}"` +
    ` viewBox="0 0 ${num(output.width)} ${num(output.height)}">` +
    `${defs}${background}${body}</svg>`
  );
};
