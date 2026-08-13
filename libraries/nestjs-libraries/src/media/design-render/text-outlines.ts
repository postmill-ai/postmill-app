/**
 * Convert text to outlines — a text element becomes `path` elements.
 *
 * The one operation in this family that genuinely cannot be done in the
 * browser: glyph contours come from the font file's `glyf`/`CFF` table, and
 * neither Konva nor node-canvas exposes them. `opentype.js` reads them, and the
 * font files are already on disk — `FontLoaderService` downloads and caches
 * every family a render uses.
 *
 * Server-side, returning `path` elements, so the result is ordinary editable
 * geometry: reshape a letter, recolour one word, apply a warp to a headline
 * that no longer needs the font installed anywhere.
 */

import { readFile } from 'fs/promises';
import * as opentype from 'opentype.js';
import type { DesignerElement } from '../designer-doc/designer-doc.schema';
import { parseSvgPathData } from '../designer-doc/svg-path-parse';
import {
  normalisePathToBox,
  translatePathNodes,
  type DesignerPathNode,
} from '../designer-doc/path-geometry';
import { applyTextTransform, fitTextToBox } from '../designer-doc/fit-text';

/** A font file, opened once per process — parsing is not cheap. */
const fontCache = new Map<string, Promise<opentype.Font | null>>();

const loadFont = (filePath: string): Promise<opentype.Font | null> => {
  const cached = fontCache.get(filePath);
  if (cached) return cached;
  const promise = readFile(filePath)
    .then((buffer) =>
      opentype.parse(
        buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
      )
    )
    .catch(() => null);
  fontCache.set(filePath, promise);
  return promise;
};

export interface OutlineOptions {
  /** Absolute path to the TTF/OTF for the element's family and weight. */
  fontPath: string;
  /**
   * One path element per GLYPH rather than one per line.
   *
   * Per-glyph is what "convert to outlines" means in a vector editor — each
   * letter becomes its own object you can move. Per-line keeps the layer count
   * down for a headline you only want to warp as a unit.
   */
  perGlyph?: boolean;
}

/**
 * A text element as `path` elements in DOCUMENT space.
 *
 * Layout comes from the shared fitter, so the outlines land exactly where the
 * renderers painted the glyphs — wrapping, shrink-to-fit, tracking, case
 * transform, paragraph spacing and alignment all included, rather than
 * re-derived here and drifting.
 */
export const textToOutlines = async (
  el: DesignerElement,
  options: OutlineOptions
): Promise<Partial<DesignerElement>[]> => {
  const font = await loadFont(options.fontPath);
  if (!font) return [];

  const text = applyTextTransform(el.text || '', el.textTransform);
  if (!text.trim()) return [];

  const scaleX = el.textScaleX || 1;
  const letterSpacing = el.letterSpacing || 0;

  // opentype measures in font units; `getAdvanceWidth` scales to px for us,
  // which is the same measurement the renderers get from the canvas.
  const measure = (line: string, size: number): number =>
    font.getAdvanceWidth(line, size);

  const fitted = fitTextToBox(
    {
      text,
      width: el.width,
      height: el.height,
      fontSize: el.fontSize || 16,
      lineHeight: el.lineHeight,
      letterSpacing,
      scaleX,
      paragraphSpacing: el.paragraphSpacing,
      firstLineIndent: el.firstLineIndent,
    },
    measure
  );

  const contentHeight =
    fitted.lines.length * fitted.lineHeight +
    fitted.lineGaps.reduce((sum, gap) => sum + gap, 0);
  let top =
    el.verticalAlign === 'middle'
      ? Math.max(0, (el.height - contentHeight) / 2)
      : el.verticalAlign === 'bottom'
      ? Math.max(0, el.height - contentHeight)
      : 0;

  const boxWidth = el.width / scaleX;
  const align = el.align || 'left';
  const out: Partial<DesignerElement>[] = [];

  /** One `path` element from glyph geometry already in document space. */
  const emit = (nodes: DesignerPathNode[], closed: boolean, name: string): void => {
    const normalised = normalisePathToBox(nodes);
    if (!normalised) return;
    out.push({
      type: 'path',
      name,
      x: el.x + normalised.x,
      y: el.y + normalised.y,
      width: normalised.width,
      height: normalised.height,
      rotation: el.rotation,
      opacity: el.opacity,
      locked: false,
      hidden: false,
      nodes: normalised.nodes,
      closed,
      fill: el.fill || '#000000',
      // The ramp survives the conversion: outlines of a gradient headline are
      // still a gradient headline.
      ...(el.fillGradient ? { fillGradient: el.fillGradient } : {}),
    });
  };

  fitted.lines.forEach((line, index) => {
    top += fitted.lineGaps[index] || 0;
    const indent = fitted.lineIndents[index] || 0;
    const lineWidth = measure(line, fitted.fontSize) + letterSpacing * line.length;

    let x = indent;
    if (align === 'center') x = indent + (boxWidth - indent - lineWidth) / 2;
    else if (align === 'right') x = boxWidth - lineWidth;

    // The baseline: `textBaseline = 'top'` means the ascender sits at the line
    // top, so the baseline is one ascender below it in font units.
    const ascender = (font.ascender / font.unitsPerEm) * fitted.fontSize;
    const baseline = top + ascender;

    const lineNodes: DesignerPathNode[] = [];
    let closedAny = false;

    for (const glyphChar of Array.from(line)) {
      const glyph = font.charToGlyph(glyphChar);
      const advance = ((glyph.advanceWidth ?? 0) / font.unitsPerEm) * fitted.fontSize;

      if (glyphChar.trim()) {
        // `scaleX` condenses the glyphs, so the outline is condensed too — the
        // same rule the squeeze buffer follows in the raster renderer.
        const path = glyph.getPath(0, 0, fitted.fontSize);
        for (const sub of parseSvgPathData(path.toPathData(3))) {
          const placed = translatePathNodes(
            sub.nodes.map((n) => ({
              x: n.x * scaleX,
              y: n.y,
              ...(n.inX !== undefined ? { inX: n.inX * scaleX, inY: n.inY } : {}),
              ...(n.outX !== undefined ? { outX: n.outX * scaleX, outY: n.outY } : {}),
            })),
            x * scaleX,
            baseline
          );
          if (options.perGlyph) {
            emit(placed, sub.closed, `${glyphChar} outline`);
          } else {
            lineNodes.push(...placed);
            closedAny = closedAny || sub.closed;
          }
        }
      }

      x += advance + letterSpacing;
    }

    // Per-LINE keeps every contour of the line in one element. The counters of
    // an "o" or a "B" are separate contours, so this is an approximation the
    // per-glyph mode does not make — which is why per-glyph is the default.
    if (!options.perGlyph && lineNodes.length) {
      emit(lineNodes, closedAny, `${line.slice(0, 24)} outline`);
    }

    top += fitted.lineHeight;
  });

  return out;
};
