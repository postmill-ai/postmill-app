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
import { pointsForShape, cornerRadii } from './shape-geometry';
import type { DesignerPathNode } from './path-geometry';
import { buildLayerTree, walkLayerTree, type LayerNode } from './layer-tree';
import { fitTextToBox, DEFAULT_LINE_HEIGHT, type MeasureText } from './fit-text';
import { warpedOutline } from './warp';
import { renderableSrc } from './svg-src';

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
  // A symbol INSTANCE is an id plus overrides; its geometry lives in the
  // document's symbol table, which this translator is not handed. It used to
  // fall through to the shape branch and come out as a plain rectangle.
  if (el.type === 'symbol') return false;
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
  // An angle in degrees, converted to the unit-square vector SVG wants. The
  // default is 0 (left-to-right) because that is what `buildStyleGradient`
  // uses; 90 here meant an angle-less gradient exported rotated a quarter turn.
  const rad = ((gradient.angle ?? 0) * Math.PI) / 180;
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
  // Both renderers rotate about the element ORIGIN — stored `x/y/rotation`
  // mean "top-left pivot". Rotating about the centre here put a 45deg element
  // ~158px away from where the Designer drew it.
  if (el.rotation) parts.push(`rotate(${num(el.rotation)})`);
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
  /**
   * Measures a string at a font size, for the caller's font stack.
   *
   * SVG has no word wrap and no shrink-to-fit — the exporter has to lay lines
   * out itself, exactly as the two renderers do, and that needs a measurement.
   * Without one this falls back to splitting on explicit newlines only, which
   * is what it always did and why a wrapped headline exported as one long line
   * running off the artboard.
   */
  measure?: (el: DesignerElement) => MeasureText;
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
        const authored = el.fontSize || 16;
        const scaleX = el.textScaleX || 1;
        const measure = ctx.options.measure?.(el);
        // With a measurement available the block wraps and shrinks exactly as
        // the renderers do; without one, explicit newlines are all we can honour.
        const fitted = measure
          ? fitTextToBox(
              {
                text: String(el.text || ''),
                width: el.width,
                height: el.height,
                fontSize: authored,
                lineHeight: el.lineHeight,
                letterSpacing: el.letterSpacing,
                scaleX,
              },
              measure
            )
          : {
              fontSize: authored,
              lines: String(el.text || '').split('\n'),
              lineHeight: (el.lineHeight || DEFAULT_LINE_HEIGHT) * authored,
            };

        const size = fitted.fontSize;
        const anchor =
          el.align === 'center' ? 'middle' : el.align === 'right' ? 'end' : 'start';
        // Layout happens in unscaled glyph space and the whole block is scaled,
        // the same rule `measureLineWidth` states — so the wrap box, and every
        // x here, is divided back out.
        const boxWidth = el.width / scaleX;
        const x =
          el.align === 'center' ? boxWidth / 2 : el.align === 'right' ? boxWidth : 0;

        const contentHeight = fitted.lines.length * fitted.lineHeight;
        const top =
          el.verticalAlign === 'middle'
            ? Math.max(0, (el.height - contentHeight) / 2)
            : el.verticalAlign === 'bottom'
            ? Math.max(0, el.height - contentHeight)
            : 0;

        const tspans = fitted.lines
          .map(
            (line, i) =>
              `<tspan x="${num(x)}" dy="${i === 0 ? 0 : num(fitted.lineHeight)}">${esc(
                line
              )}</tspan>`
          )
          .join('');

        const tracking = el.letterSpacing
          ? ` letter-spacing="${num(el.letterSpacing)}"`
          : '';
        const condense = scaleX === 1 ? '' : ` transform="scale(${num(scaleX)} 1)"`;

        return (
          `<text${condense} x="${num(x)}" y="${num(top + size)}" font-family="${esc(
            el.fontFamily || 'sans-serif'
          )}" font-size="${num(size)}" font-weight="${num(el.fontWeight || 400)}"` +
          `${el.fontStyle === 'italic' ? ' font-style="italic"' : ''}${tracking}` +
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
      case 'icon': {
        // An icon carries raw SVG markup (or a URL); `renderableSrc` is the one
        // place that knows which. It used to fall through to the shape branch
        // and export as an empty rectangle.
        const src = renderableSrc(el);
        if (!src) return '';
        return `<image x="0" y="0" width="${num(el.width)}" height="${num(
          el.height
        )}" href="${esc(src)}"/>`;
      }
      case 'shape':
      default: {
        // A warp is real geometry, not a filter: the same outline both
        // renderers trace becomes a path here rather than being ignored.
        const warped = warpedOutline(el);
        if (warped?.length) {
          const d =
            `M${num(warped[0].x)},${num(warped[0].y)}` +
            warped.slice(1).map((pt) => ` L${num(pt.x)},${num(pt.y)}`).join('') +
            ' Z';
          return `<path d="${d}"${fill}${strokeAttrs(el)}/>`;
        }
        if (el.shape === 'ellipse') {
          return `<ellipse cx="${num(el.width / 2)}" cy="${num(el.height / 2)}" rx="${num(
            el.width / 2
          )}" ry="${num(el.height / 2)}"${fill}${strokeAttrs(el)}/>`;
        }
        if (el.shape === 'line') {
          // Corner to corner, as the canvas draws it and the draw tool intends.
          return `<line x1="0" y1="0" x2="${num(el.width)}" y2="${num(
            el.height
          )}"${strokeAttrs(el) || ` stroke="${esc(el.fill || '#000')}" stroke-width="2"`}/>`;
        }
        const points = pointsForShape(el.shape, el.width, el.height, el.sides, el.innerRatio);
        if (points) {
          return `<polygon points="${points
            .map((p) => `${num(p.x)},${num(p.y)}`)
            .join(' ')}"${fill}${strokeAttrs(el)}/>`;
        }
        const [tl, tr, br, bl] = cornerRadii(el.borderRadius, el.width, el.height);
        if (tl === tr && tr === br && br === bl) {
          return `<rect x="0" y="0" width="${num(el.width)}" height="${num(el.height)}"${
            tl > 0 ? ` rx="${num(tl)}" ry="${num(tl)}"` : ''
          }${fill}${strokeAttrs(el)}/>`;
        }
        // SVG's `rx` is uniform, so per-corner radii need a real path.
        const w = el.width;
        const h = el.height;
        const d =
          `M${num(tl)},0 H${num(w - tr)} A${num(tr)},${num(tr)} 0 0 1 ${num(w)},${num(tr)}` +
          ` V${num(h - br)} A${num(br)},${num(br)} 0 0 1 ${num(w - br)},${num(h)}` +
          ` H${num(bl)} A${num(bl)},${num(bl)} 0 0 1 0,${num(h - bl)}` +
          ` V${num(tl)} A${num(tl)},${num(tl)} 0 0 1 ${num(tl)},0 Z`;
        return `<path d="${d}"${fill}${strokeAttrs(el)}/>`;
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
export const layersNeedingRaster = (output: DesignerOutput): string[] => {
  // Walk the layer TREE, not just the top level: a styled/masked layer inside
  // a group was silently dropped from the export (the group itself is vector).
  const ids: string[] = [];
  walkLayerTree(buildLayerTree(output.children || []), (node) => {
    const el = node.element;
    if (!el.hidden && !isVectorExportable(el)) ids.push(el.id);
  });
  return ids;
};

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
