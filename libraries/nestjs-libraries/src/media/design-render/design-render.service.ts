/// <reference types="./pdfkit" />
import { Injectable, Logger } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { readFile } from 'fs/promises';
import * as path from 'path';
import { safeFetch } from '@postmill-ai/nestjs-libraries/dtos/webhooks/safe.fetch';
import {
  DesignerDoc,
  DesignerElement,
  DesignerGradient,
  DesignerOutput,
  DesignerMask,
  DesignerBlendMode,
  DesignerPattern,
  DesignerLayerStyle,
  RenderOptions,
  TextContrastViolation,
  TextRun,
} from './design-render.types';
import { FontLoaderService } from './font-loader.service';
import {
  cssFilterForToken,
  parseDesignerFilterToken,
} from './filter-tokens';
import {
  MAX_CANVAS_DIMENSION,
  MAX_GROUP_RENDER_DEPTH,
} from '../designer-doc/designer-doc.limits';
import {
  fitTextToBox,
  measureLineWidth,
  type FittedText,
} from '../designer-doc/fit-text';
import { pointsForShape, starPoints } from '../designer-doc/shape-geometry';
import { arrowHeadPoints, strokeEndpoints } from '../designer-doc/stroke-style';
import { tracePathNodes } from '../designer-doc/path-geometry';
import { buildLayerTree, groupBounds, type LayerNode } from '../designer-doc/layer-tree';
import { expandSymbols } from '../designer-doc/symbols';
import {
  applyAdjustment,
  blendPixels,
  canvasCompositeFor,
  isNativeBlend,
} from '../designer-doc/pixel-ops';
import { drawPatternTile, tileSizeFor } from '../designer-doc/pattern-tiles';
import { splitStyles, styleOffset, styleBlur, stylePadding } from '../designer-doc/layer-styles';
import {
  applySmartFilters,
  hasSmartFilters,
  smartFilterCacheKey,
  smartFilterSource,
} from '../designer-doc/smart-filter-stack';

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

/**
 * Pixel ceiling for evaluating a smart-filter stack.
 *
 * `MAX_IMAGE_BYTES` bounds the COMPRESSED bytes; a 25 MB JPEG can decode to
 * well over 100 megapixels, and the spatial filters are super-linear in area.
 * Past this ceiling the source is evaluated downscaled and drawn back up, which
 * costs sharpness on an image that is almost certainly being drawn into a much
 * smaller box anyway — and is a great deal better than either stalling the
 * render or dropping the treatment silently.
 */
const MAX_SMART_FILTER_PIXELS = 16_000_000;

/** How many evaluated stacks to keep. Each entry holds a decoded canvas. */
const SMART_FILTER_CACHE_MAX = 6;

// "Busy backdrop" thresholds for `auditTextContrast`. The WCAG ratio is
// computed against the MEAN of the sampled box, so a photograph with bright
// and dark detail averages to a mid tone that PASSES while the glyphs
// themselves sit on high-frequency edges — the live serum-bottle headline,
// legible only because it happened to carry a text shadow.
//
// Both signals are measured on a BACKDROP-ONLY render (text elements hidden),
// never on the composite: a text box's own glyphs dominate the composite's
// spread, so a clean white panel WITH glyphs measured stdev 71.9 while a
// genuinely busy bokeh photo WITHOUT glyphs measured 86.3 — the signals do not
// separate the cases at all until the glyphs are taken out.
//
//   * `BUSY_BACKDROP_CROSSING` — fraction of the sampled pixels whose WCAG
//     ratio against the TEXT FILL is below the size-class requirement, i.e.
//     the direct measure of "some glyphs land on backdrop they cannot be read
//     against". This is the signal that does the discriminating.
//   * `BUSY_BACKDROP_STDEV` — largest per-channel standard deviation of the
//     glyph-free crop. A sanity gate ("the backdrop under the ink actually
//     varies"), not the discriminator.
//
// Both are measured over the GLYPH FOOTPRINT — the per-line ink rects
// `glyphLineRects` lays out with the renderer's own metrics — never the whole
// text box. A box is mostly air: a centered short line in a full-width box,
// the leading between wrapped lines, the ragged right edge. Those pixels are
// backdrop no glyph ever touches, and averaging them in reports a different
// backdrop from the one the reader sees. Re-measured on the live imagery,
// glyph-footprint vs box: crossing 14.9% vs 11.1% (v1 subhead), 17.2% vs 6.9%
// (v1 headline), 43.7% vs 29.2% (v2 headline); stdev 43.3 vs 46.0, 95.4 vs
// 85.8. It moves in BOTH directions — it is a localization, not a correction.
//
// The thresholds are therefore re-derived on glyph-footprint numbers (the box
// numbers the old pair came from no longer describe what is measured):
//   * stdev — the glyph-footprint population separates cleanly: flat panel
//     0.0, ink sitting inside a uniform region 1.1–7.7, genuinely textured
//     photo 30.7–95.4. 25 sits in the empty gap. The old 45 was a BOX number
//     and now cuts through the middle of the textured population, which would
//     have silently un-flagged a live failure that measured 43.3 under its
//     glyphs (46.0 over its box).
//   * crossing — for the same population the calm cases measure ≤5.0% and the
//     genuine failures 14.9%, 15.5%, 17.2%, 40.6%+. 0.12 sits in that gap and
//     catches the two live failures the box measure hid (13.8% and 32.8%),
//     while a well-lit bokeh headline at 5.0% stays clean.
//
// A flat backdrop still cannot be flagged busy however the mean lands: its
// pixels are all the same, so crossing is 0 (mean passes) or 1 (mean fails,
// and then the ratio check owns it) — and the stdev gate is 0 either way.
//
// The retired signals and why:
//   * sharp's `sharpness` was a REQUIRED conjunct and is inverted against
//     reality — the bokeh photo scores 0.83, the clean white panel 6.41. Edge
//     energy measures focus, not legibility.
//   * a ratio-headroom ceiling (`ratio < required * 1.6`) gated the variance
//     check behind the contrast check, making it unsatisfiable for the exact
//     failure case it was meant to catch: white-on-dark imagery measures 5.1
//     to 8.5 against a 4.8 bar. Crossing fraction subsumes it — a backdrop
//     that no glyph fails against scores 0.
const BUSY_BACKDROP_STDEV = 25;
const BUSY_BACKDROP_CROSSING = 0.12;

// Each line's ink band is inset from the top of its leading by this share of an
// em (with a `top` baseline the em box starts at the line top and the cap
// height sits below it) and cut at one em, which is where the descender ends.
const GLYPH_ASCENDER_INSET_EM = 0.15;

// Precomputed WCAG sRGB channel transform for 0..255. The audit walks every
// pixel of every sampled text box, so the pow() comes out of the loop.
const SRGB_CHANNEL_LUT = new Float64Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB_CHANNEL_LUT[i] =
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

// node-canvas is a native module whose binary may not be built in every
// environment. Load it lazily so a missing binary only disables the render
// endpoints — it must NOT take down the whole module (which also hosts
// /files, /brands, /designs, etc.).
type CanvasModule = typeof import('canvas');
let _canvasModule: CanvasModule | null = null;
const loadCanvasModule = async (): Promise<CanvasModule> => {
  if (!_canvasModule) {
    _canvasModule = await import('canvas');
  }
  return _canvasModule;
};

// WCAG relative luminance of sRGB channels given as 0..1 floats.
const srgbLuminance = (r: number, g: number, b: number): number => {
  const channel = (c: number) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

/** WCAG relative luminance of a #rrggbb color (unparseable → light). */
const hexToLuminance = (hex: string): number => {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || '').trim());
  if (!m) return 1;
  const n = parseInt(m[1], 16);
  return srgbLuminance(
    ((n >> 16) & 255) / 255,
    ((n >> 8) & 255) / 255,
    (n & 255) / 255
  );
};

const aabbOverlap = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
): boolean =>
  a.x < b.x + b.width &&
  a.x + a.width > b.x &&
  a.y < b.y + b.height &&
  a.y + a.height > b.y;

// Canonical filter token vocabulary — must match the client tokens 1:1.
// Each token is passed to ctx.filter as a CSS filter string.
const mapFilters = (filters: string[]): string => {
  const parts: string[] = [];
  for (const token of filters) {
    const parsed = parseDesignerFilterToken(token);
    if (!parsed) continue;
    parts.push(cssFilterForToken(parsed.key, parsed.value));
  }
  return parts.join(' ');
};

// Compute a cover source-rect from a source image to fill target w×h,
// cropped toward a focalPoint (0–1, default centre).
const computeCoverCrop = (
  srcW: number, srcH: number, targetW: number, targetH: number,
  focalPoint?: { x: number; y: number }
): { sx: number; sy: number; sw: number; sh: number } => {
  const fp = focalPoint || { x: 0.5, y: 0.5 };
  const targetRatio = targetW / targetH;
  const srcRatio = srcW / srcH;
  let sw: number, sh: number;
  if (srcRatio > targetRatio) {
    sh = srcH;
    sw = srcH * targetRatio;
  } else {
    sw = srcW;
    sh = srcW / targetRatio;
  }
  const sx = (srcW - sw) * Math.min(1, Math.max(0, fp.x));
  const sy = (srcH - sh) * Math.min(1, Math.max(0, fp.y));
  return { sx, sy, sw, sh };
};

// ----- SVG path sampling helpers for text-on-path (T-33) ---------------------

interface PathPoint {
  x: number;
  y: number;
}

const pathDistances = (
  points: PathPoint[]
): { distances: number[]; total: number } => {
  const distances: number[] = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const d = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    distances.push(d);
    total += d;
  }
  return { distances, total };
};

const pointAtDistance = (
  points: PathPoint[],
  distances: number[],
  target: number
): { x: number; y: number; angle: number } => {
  let acc = 0;
  for (let i = 0; i < distances.length; i++) {
    const d = distances[i];
    if (acc + d >= target) {
      const t = d === 0 ? 0 : (target - acc) / d;
      const p0 = points[i];
      const p1 = points[i + 1];
      const x = p0.x + (p1.x - p0.x) * t;
      const y = p0.y + (p1.y - p0.y) * t;
      const angle = Math.atan2(p1.y - p0.y, p1.x - p0.x);
      return { x, y, angle };
    }
    acc += d;
  }
  const last = points[points.length - 1];
  return { x: last.x, y: last.y, angle: 0 };
};

const sampleLine = (p0: PathPoint, p1: PathPoint): PathPoint[] => [p0, p1];

const sampleCubic = (
  p0: PathPoint,
  p1: PathPoint,
  p2: PathPoint,
  p3: PathPoint,
  n = 20
): PathPoint[] => {
  const out: PathPoint[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    const u2 = u * u;
    const u3 = u2 * u;
    const t2 = t * t;
    const t3 = t2 * t;
    const x = u3 * p0.x + 3 * u2 * t * p1.x + 3 * u * t2 * p2.x + t3 * p3.x;
    const y = u3 * p0.y + 3 * u2 * t * p1.y + 3 * u * t2 * p2.y + t3 * p3.y;
    out.push({ x, y });
  }
  return out;
};

const sampleQuad = (
  p0: PathPoint,
  p1: PathPoint,
  p2: PathPoint,
  n = 20
): PathPoint[] => {
  const out: PathPoint[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    const x = u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x;
    const y = u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y;
    out.push({ x, y });
  }
  return out;
};

const sampleArc = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  rx: number,
  ry: number,
  phiDeg: number,
  large: number,
  sweep: number,
  n = 24
): PathPoint[] => {
  if (!rx || !ry) return [{ x: x2, y: y2 }];
  const phi = (phiDeg * Math.PI) / 180;
  const cosP = Math.cos(phi);
  const sinP = Math.sin(phi);

  const dx2 = (x1 - x2) / 2;
  const dy2 = (y1 - y2) / 2;
  const x1p = cosP * dx2 + sinP * dy2;
  const y1p = -sinP * dx2 + cosP * dy2;

  let rxAbs = Math.abs(rx);
  let ryAbs = Math.abs(ry);
  const lambda = (x1p * x1p) / (rxAbs * rxAbs) + (y1p * y1p) / (ryAbs * ryAbs);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rxAbs *= s;
    ryAbs *= s;
  }

  const sign = large === sweep ? -1 : 1;
  const numerator =
    rxAbs * rxAbs * ryAbs * ryAbs -
    rxAbs * rxAbs * y1p * y1p -
    ryAbs * ryAbs * x1p * x1p;
  const denominator = rxAbs * rxAbs * y1p * y1p + ryAbs * ryAbs * x1p * x1p;
  const factor =
    denominator === 0 ? 0 : sign * Math.sqrt(Math.max(0, numerator / denominator));

  const cxp = factor * ((rxAbs * y1p) / ryAbs);
  const cyp = factor * (-(ryAbs * x1p) / rxAbs);

  const cx = cosP * cxp - sinP * cyp + (x1 + x2) / 2;
  const cy = sinP * cxp + cosP * cyp + (y1 + y2) / 2;

  const theta1 = Math.atan2((y1p - cyp) / ryAbs, (x1p - cxp) / rxAbs);
  const theta2 = Math.atan2((-y1p - cyp) / ryAbs, (-x1p - cxp) / rxAbs);
  let delta = theta2 - theta1;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  if (!sweep && delta > 0) delta -= 2 * Math.PI;

  const out: PathPoint[] = [];
  for (let i = 0; i <= n; i++) {
    const theta = theta1 + (delta * i) / n;
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    const x = cx + rxAbs * cosT * cosP - ryAbs * sinT * sinP;
    const y = cy + rxAbs * cosT * sinP + ryAbs * sinT * cosP;
    out.push({ x, y });
  }
  return out;
};

const tokenizePath = (d: string): string[] => {
  const m = d.match(/[MmLlHhVvCcSsQqTtAaZz]|-?\d*\.?\d+(?:[eE][+-]?\d+)?/g);
  return m ?? [];
};

const argCountFor = (cmd: string): number => {
  switch (cmd) {
    case 'M':
    case 'm':
    case 'L':
    case 'l':
    case 'T':
    case 't':
      return 2;
    case 'H':
    case 'h':
    case 'V':
    case 'v':
      return 1;
    case 'C':
    case 'c':
      return 6;
    case 'S':
    case 's':
    case 'Q':
    case 'q':
      return 4;
    case 'A':
    case 'a':
      return 7;
    case 'Z':
    case 'z':
      return 0;
    default:
      return 0;
  }
};

const parsePathCommands = (
  d: string
): { cmd: string; args: number[] }[] => {
  const tokens = tokenizePath(d);
  const out: { cmd: string; args: number[] }[] = [];
  let i = 0;
  let currentCmd = '';
  while (i < tokens.length) {
    const t = tokens[i];
    if (/^[MmLlHhVvCcSsQqTtAaZz]$/.test(t)) {
      currentCmd = t;
      i++;
    }
    if (!currentCmd) {
      i++;
      continue;
    }
    const count = argCountFor(currentCmd);
    if (count === 0) {
      out.push({ cmd: currentCmd, args: [] });
      currentCmd = '';
      continue;
    }
    const args: number[] = [];
    for (let k = 0; k < count && i < tokens.length; k++) {
      args.push(parseFloat(tokens[i]));
      i++;
    }
    out.push({ cmd: currentCmd, args });
  }
  return out;
};

const sampleSvgPath = (d: string): PathPoint[] => {
  const commands = parsePathCommands(d);
  const points: PathPoint[] = [];
  let current: PathPoint = { x: 0, y: 0 };
  let start: PathPoint = { x: 0, y: 0 };
  let lastCubic: PathPoint | null = null;
  let lastQuad: PathPoint | null = null;

  const addSamples = (samples: PathPoint[]) => {
    if (!samples.length) return;
    if (!points.length) {
      points.push(samples[0]);
    }
    for (let i = 1; i < samples.length; i++) {
      points.push(samples[i]);
    }
  };

  for (const c of commands) {
    const cmd = c.cmd;
    const a = c.args;
    switch (cmd) {
      case 'M':
        current = { x: a[0], y: a[1] };
        start = current;
        points.push(current);
        break;
      case 'm':
        current = { x: current.x + a[0], y: current.y + a[1] };
        start = current;
        points.push(current);
        break;
      case 'L': {
        const p = { x: a[0], y: a[1] };
        addSamples(sampleLine(current, p));
        current = p;
        break;
      }
      case 'l': {
        const p = { x: current.x + a[0], y: current.y + a[1] };
        addSamples(sampleLine(current, p));
        current = p;
        break;
      }
      case 'H': {
        const p = { x: a[0], y: current.y };
        addSamples(sampleLine(current, p));
        current = p;
        break;
      }
      case 'h': {
        const p = { x: current.x + a[0], y: current.y };
        addSamples(sampleLine(current, p));
        current = p;
        break;
      }
      case 'V': {
        const p = { x: current.x, y: a[0] };
        addSamples(sampleLine(current, p));
        current = p;
        break;
      }
      case 'v': {
        const p = { x: current.x, y: current.y + a[0] };
        addSamples(sampleLine(current, p));
        current = p;
        break;
      }
      case 'C': {
        const p1 = { x: a[0], y: a[1] };
        const p2 = { x: a[2], y: a[3] };
        const p = { x: a[4], y: a[5] };
        addSamples(sampleCubic(current, p1, p2, p));
        lastCubic = { x: a[2], y: a[3] };
        lastQuad = null;
        current = p;
        break;
      }
      case 'c': {
        const p1 = { x: current.x + a[0], y: current.y + a[1] };
        const p2 = { x: current.x + a[2], y: current.y + a[3] };
        const p = { x: current.x + a[4], y: current.y + a[5] };
        addSamples(sampleCubic(current, p1, p2, p));
        lastCubic = { x: current.x + a[2], y: current.y + a[3] };
        lastQuad = null;
        current = p;
        break;
      }
      case 'S': {
        const p1 = lastCubic
          ? { x: 2 * current.x - lastCubic.x, y: 2 * current.y - lastCubic.y }
          : current;
        const p2 = { x: a[0], y: a[1] };
        const p = { x: a[2], y: a[3] };
        addSamples(sampleCubic(current, p1, p2, p));
        lastCubic = { x: a[0], y: a[1] };
        lastQuad = null;
        current = p;
        break;
      }
      case 's': {
        const p1 = lastCubic
          ? { x: 2 * current.x - lastCubic.x, y: 2 * current.y - lastCubic.y }
          : current;
        const p2 = { x: current.x + a[0], y: current.y + a[1] };
        const p = { x: current.x + a[2], y: current.y + a[3] };
        addSamples(sampleCubic(current, p1, p2, p));
        lastCubic = { x: current.x + a[0], y: current.y + a[1] };
        lastQuad = null;
        current = p;
        break;
      }
      case 'Q': {
        const c1 = { x: a[0], y: a[1] };
        const p = { x: a[2], y: a[3] };
        addSamples(sampleQuad(current, c1, p));
        lastQuad = { x: a[0], y: a[1] };
        lastCubic = null;
        current = p;
        break;
      }
      case 'q': {
        const c1 = { x: current.x + a[0], y: current.y + a[1] };
        const p = { x: current.x + a[2], y: current.y + a[3] };
        addSamples(sampleQuad(current, c1, p));
        lastQuad = { x: current.x + a[0], y: current.y + a[1] };
        lastCubic = null;
        current = p;
        break;
      }
      case 'T': {
        const c1 = lastQuad
          ? { x: 2 * current.x - lastQuad.x, y: 2 * current.y - lastQuad.y }
          : current;
        const p = { x: a[0], y: a[1] };
        addSamples(sampleQuad(current, c1, p));
        lastQuad = c1;
        lastCubic = null;
        current = p;
        break;
      }
      case 't': {
        const c1 = lastQuad
          ? { x: 2 * current.x - lastQuad.x, y: 2 * current.y - lastQuad.y }
          : current;
        const p = { x: current.x + a[0], y: current.y + a[1] };
        addSamples(sampleQuad(current, c1, p));
        lastQuad = c1;
        lastCubic = null;
        current = p;
        break;
      }
      case 'A': {
        const p = { x: a[5], y: a[6] };
        addSamples(
          sampleArc(
            current.x,
            current.y,
            p.x,
            p.y,
            a[0],
            a[1],
            a[2],
            a[3],
            a[4]
          )
        );
        lastCubic = null;
        lastQuad = null;
        current = p;
        break;
      }
      case 'a': {
        const p = { x: current.x + a[5], y: current.y + a[6] };
        addSamples(
          sampleArc(
            current.x,
            current.y,
            p.x,
            p.y,
            a[0],
            a[1],
            a[2],
            a[3],
            a[4]
          )
        );
        lastCubic = null;
        lastQuad = null;
        current = p;
        break;
      }
      case 'Z':
      case 'z':
        if (current.x !== start.x || current.y !== start.y) {
          addSamples(sampleLine(current, start));
        }
        current = { ...start };
        break;
      default:
        break;
    }
  }

  return points;
};

@Injectable()
export class DesignRenderService {
  private readonly _logger = new Logger(DesignRenderService.name);

  constructor(private _fontLoaderService: FontLoaderService) {}

  async renderPage(
    doc: DesignerDoc,
    outputIndex: number,
    opts?: RenderOptions
  ): Promise<Buffer> {
    const output = doc.outputs?.[outputIndex] as DesignerOutput | undefined;
    if (!output) {
      throw new Error(`Output ${outputIndex} out of range`);
    }
    if (!('children' in output)) {
      throw new Error(`Output ${outputIndex} is a video output; use /render-video`);
    }

    // Symbol instances expand to ordinary elements before anything reads the
    // layer list, so nothing below this line needs to know symbols exist.
    const children = expandSymbols(output.children ?? [], doc.symbols);

    if (opts?.orgId) {
      await this._fontLoaderService.loadOrgFonts(opts.orgId);
    }
    await this._fontLoaderService.loadCuratedFonts(children);

    const ratio = opts?.pixelRatio && opts.pixelRatio > 0 ? opts.pixelRatio : 1;
    const width = Math.max(
      1,
      Math.min(Math.round(output.width * ratio), MAX_CANVAS_DIMENSION)
    );
    const height = Math.max(
      1,
      Math.min(Math.round(output.height * ratio), MAX_CANVAS_DIMENSION)
    );

    const { createCanvas } = await loadCanvasModule();
    const canvas = createCanvas(width, height);
    const ctx: any = canvas.getContext('2d');
    ctx.scale(ratio, ratio);

    if (!opts?.transparent) {
      await this.drawBackground(ctx, output);
    }

    await this.drawLayerTree(
      ctx,
      canvas,
      buildLayerTree(children),
      children,
      ratio,
      opts
    );

    return canvas.toBuffer('image/png');
  }

  async renderAllPages(
    doc: DesignerDoc,
    opts?: RenderOptions
  ): Promise<Buffer[]> {
    const out: Buffer[] = [];
    for (let i = 0; i < (doc.outputs?.length ?? 0); i++) {
      out.push(await this.renderPage(doc, i, opts));
    }
    return out;
  }

  /**
   * Deterministic WCAG contrast audit for text painted over IMAGERY (image
   * elements, image or gradient backgrounds) — the doc-validator already
   * covers solid-shape and solid-background backdrops, so those texts are
   * skipped here. For each remaining visible text element the painted
   * backdrop under its box is sampled from the rendered page (sharp
   * extract) and the contrast ratio against the text fill is computed (3:1
   * large text, 4.5:1 body).
   *
   * Sampling is done on a BACKDROP render — the same doc with every text
   * element hidden — so a text box's own glyphs never pollute the pixels the
   * audit judges it against. Pass `pages` (already-rendered composites, e.g.
   * from the saver) and `backdropPages` (the `hideText: true` render) to avoid
   * re-rendering; a missing backdrop page falls back to the composite rather
   * than skipping the element.
   */
  async auditTextContrast(
    doc: DesignerDoc,
    pages?: Buffer[],
    backdropPages?: Buffer[]
  ): Promise<TextContrastViolation[]> {
    const violations: TextContrastViolation[] = [];
    const rendered = pages ?? (await this.renderAllPages(doc));
    let backdrops = backdropPages;
    if (!backdrops) {
      try {
        backdrops = await this.renderAllPages(doc, { hideText: true });
      } catch (err) {
        this._logger.warn(
          `Backdrop render failed; sampling the composite instead: ${(err as Error)?.message}`
        );
      }
    }
    const sharp = (await import('sharp')).default;

    // A 1×1 canvas used only for text metrics — the glyph footprints below are
    // laid out with the renderer's own wrap/shrink-to-fit/align code, never a
    // second render. A missing native binary only costs the audit its glyph
    // precision (it falls back to the text box).
    let measureCtx: any = null;
    try {
      const { createCanvas } = await loadCanvasModule();
      measureCtx = createCanvas(1, 1).getContext('2d');
    } catch (err) {
      this._logger.warn(
        `Text metrics unavailable; measuring contrast over the whole text box: ${(err as Error)?.message}`
      );
    }

    for (
      let outputIndex = 0;
      outputIndex < (doc.outputs?.length ?? 0);
      outputIndex++
    ) {
      const out = doc.outputs[outputIndex] as DesignerOutput | undefined;
      const page = backdrops?.[outputIndex] ?? rendered[outputIndex];
      if (!out || !('children' in out) || !page) continue;

      let meta: { width?: number; height?: number };
      try {
        meta = await sharp(page).metadata();
      } catch {
        continue;
      }
      const pageW = meta.width || out.width;
      const pageH = meta.height || out.height;
      const scaleX = pageW / out.width;
      const scaleY = pageH / out.height;

      // The render path draws expandSymbols(children) — the audit must read
      // the same layer list, or text inside a symbol instance is never
      // checked and symbol-provided imagery is invisible to the backdrop scan.
      const children = expandSymbols(out.children ?? [], doc.symbols);

      for (let idx = 0; idx < children.length; idx++) {
        const el = children[idx];
        if (el.type !== 'text' || el.hidden || (el.opacity ?? 1) <= 0) continue;
        const hasText = !!(el.text?.trim() || el.richText?.length);
        if (!hasText || !(el.width > 0) || !(el.height > 0)) continue;
        const fillMatch = /^#?[0-9a-f]{6}$/i.exec((el.fill || '').trim());
        if (!fillMatch) continue;
        const fill = fillMatch[0].startsWith('#')
          ? fillMatch[0]
          : `#${fillMatch[0]}`;

        // Backdrop kind: the topmost earlier overlapping shape/image. A
        // solid shape backdrop is the doc-validator's job — skip; imagery
        // beneath (or an image/gradient output background) is what this
        // pass samples.
        let imagery = false;
        let solidShape = false;
        for (let k = idx - 1; k >= 0; k--) {
          const other = children[k];
          if (other.hidden) continue;
          if (other.type !== 'shape' && other.type !== 'image') continue;
          if (!aabbOverlap(el, other)) continue;
          if (other.type === 'image') {
            imagery = true;
          } else if (other.fill || other.fillGradient) {
            solidShape = true;
          } else {
            // Stroke-only shape (an outline CTA): it paints nothing across
            // its box, so it is transparent to this scan. Keep looking down —
            // stopping here hid the IMAGE under an unfilled button and shipped
            // a #FF00E5 label on a magenta photo at 1.73:1.
            continue;
          }
          break;
        }
        if (!imagery) {
          if (solidShape) continue;
          const bgType = out.bg?.type;
          if (bgType !== 'image' && bgType !== 'gradient') continue;
        }

        try {
          const fontSize = el.fontSize || 16;
          const isLarge =
            fontSize >= 24 ||
            ((el.fontWeight ?? 400) >= 700 && fontSize >= 18);
          const required = isLarge ? 3 : 4.5;
          const fillLuma = hexToLuminance(fill);

          // The GLYPH footprint, not the box: a text element's box is mostly
          // air (a centered short line in a full-width box, the leading
          // between wrapped lines, the ragged right edge), and every one of
          // those pixels dilutes both signals with backdrop no glyph ever
          // touches. Measured on live designs the box understated the
          // under-glyph crossing fraction by up to 11.6 points. The rects are
          // laid out with the renderer's OWN metrics on a 1×1 measuring
          // canvas — no extra render. Curved / path / rich text falls back to
          // the box, where its box is the only honest bound.
          const regions =
            (measureCtx && this.glyphLineRects(measureCtx, el)) || [
              { x: el.x, y: el.y, width: el.width, height: el.height },
            ];
          const sample = await this._sampleBackdropRegions(
            page,
            regions,
            { scaleX, scaleY, pageW, pageH },
            fillLuma,
            required
          );
          if (!sample) continue;
          const { mean, backdropStdev, crossingFraction } = sample;

          const backdropLuma = srgbLuminance(
            mean[0] / 255,
            mean[1] / 255,
            mean[2] / 255
          );
          const ratio =
            (Math.max(fillLuma, backdropLuma) + 0.05) /
            (Math.min(fillLuma, backdropLuma) + 0.05);
          if (ratio >= required) {
            if (
              backdropStdev >= BUSY_BACKDROP_STDEV &&
              crossingFraction >= BUSY_BACKDROP_CROSSING
            ) {
              violations.push({
                outputIndex,
                elementId: el.id,
                originId: el.originId,
                fill,
                ratio,
                backdropLuma,
                reason: 'busy',
                backdropStdev,
                crossingFraction,
              });
            }
            continue;
          }
          violations.push({
            outputIndex,
            elementId: el.id,
            originId: el.originId,
            fill,
            ratio,
            backdropLuma,
            reason: 'contrast',
            backdropStdev,
            crossingFraction,
          });
        } catch (err) {
          this._logger.warn(
            `Contrast sampling failed for element ${el.id}: ${(err as Error)?.message}`
          );
        }
      }
    }

    return violations;
  }

  /**
   * The per-LINE ink rects of a flat text element, in ELEMENT coordinates.
   *
   * Laid out with the renderer's own metrics — `fitFlatText` for the wrapped
   * lines and the shrunk-to-fit size, `measureLine` for each line's advance,
   * and the same `verticalAlign` / `align` offsets `drawText` applies — so the
   * rects land where the glyphs actually paint. Each line is inset vertically
   * by `GLYPH_ASCENDER_INSET_EM` (the air above the cap height with a `top`
   * baseline) and cut at one em (the descender), leaving the band the glyphs
   * occupy rather than the full leading.
   *
   * Returns null when the element is not laid out this way (rich text, text on
   * a path, curved or rotated text) — there the box is the only honest bound.
   */
  private glyphLineRects(
    ctx: any,
    el: DesignerElement
  ): { x: number; y: number; width: number; height: number }[] | null {
    // Rotated text paints its glyphs rotated about the centre, so unrotated
    // line rects would sample backdrop the glyphs never touch — fall back to
    // the box, as rich/path/curved text already do.
    if (
      el.richText?.length ||
      el.textPath ||
      (el.curve || 0) !== 0 ||
      (el.rotation || 0) !== 0
    ) {
      return null;
    }
    const text = el.text ?? '';
    if (!text.trim() || !(el.width > 0) || !(el.height > 0)) return null;

    const fontSize = el.fontSize || 16;
    const fontWeight = el.fontWeight || 400;
    const fontStyle = el.fontStyle === 'italic' ? 'italic' : 'normal';
    const fontFamily = el.fontFamily || 'sans-serif';
    const letterSpacing = el.letterSpacing || 0;
    const align = el.align || 'left';

    const fitted = this.fitFlatText(
      ctx, text, el, fontSize, fontStyle, fontWeight, fontFamily, letterSpacing
    );
    ctx.font = `${fontStyle} ${fontWeight} ${fitted.fontSize}px ${fontFamily}`;

    const contentHeight = fitted.lines.length * fitted.lineHeight;
    let y = 0;
    if (el.verticalAlign === 'middle') {
      y = Math.max(0, (el.height - contentHeight) / 2);
    } else if (el.verticalAlign === 'bottom') {
      y = Math.max(0, el.height - contentHeight);
    }

    const inset = fitted.fontSize * GLYPH_ASCENDER_INSET_EM;
    const rects: { x: number; y: number; width: number; height: number }[] = [];
    for (const line of fitted.lines) {
      const lineWidth = this.measureLine(ctx, line, letterSpacing);
      if (line.trim() && lineWidth > 0) {
        let x = 0;
        if (align === 'center') x = (el.width - lineWidth) / 2;
        else if (align === 'right') x = el.width - lineWidth;
        const left = Math.max(el.x, el.x + x);
        const top = Math.max(el.y, el.y + y + inset);
        rects.push({
          x: left,
          y: top,
          width: Math.max(1, Math.min(lineWidth, el.x + el.width - left)),
          height: Math.max(
            1,
            Math.min(fitted.fontSize - inset, el.y + el.height - top)
          ),
        });
      }
      y += fitted.lineHeight;
    }
    return rects.length > 0 ? rects : null;
  }

  /**
   * Sample the painted backdrop under a set of ELEMENT-space rects: ONE crop
   * of their union, its rows compacted down to the rects themselves, then a
   * single statistics pass. One decode however many lines the text wrapped
   * to, and the gaps between the lines never reach the statistics.
   */
  private async _sampleBackdropRegions(
    page: Buffer,
    regions: { x: number; y: number; width: number; height: number }[],
    frame: { scaleX: number; scaleY: number; pageW: number; pageH: number },
    fillLuma: number,
    required: number
  ): Promise<{
    mean: [number, number, number];
    backdropStdev: number;
    crossingFraction: number;
  } | null> {
    const { scaleX, scaleY, pageW, pageH } = frame;
    const boxes = regions
      .map((r) => {
        const left = Math.min(Math.max(0, Math.round(r.x * scaleX)), pageW - 1);
        const top = Math.min(Math.max(0, Math.round(r.y * scaleY)), pageH - 1);
        return {
          left,
          top,
          right: Math.min(
            pageW,
            Math.max(left + 1, Math.round((r.x + r.width) * scaleX))
          ),
          bottom: Math.min(
            pageH,
            Math.max(top + 1, Math.round((r.y + r.height) * scaleY))
          ),
        };
      })
      .filter((b) => b.right > b.left && b.bottom > b.top);
    if (boxes.length === 0) return null;

    const uLeft = Math.min(...boxes.map((b) => b.left));
    const uTop = Math.min(...boxes.map((b) => b.top));
    const uRight = Math.max(...boxes.map((b) => b.right));
    const uBottom = Math.max(...boxes.map((b) => b.bottom));

    // `.extract().stats()` reads the INPUT image and silently ignores the
    // queued crop, so the audit used to measure the WHOLE PAGE for every
    // element. Materialize the crop to raw pixels — one decode, and the
    // per-pixel pass needs them anyway.
    const sharp = (await import('sharp')).default;
    const { data, info } = await sharp(page)
      .extract({
        left: uLeft,
        top: uTop,
        width: uRight - uLeft,
        height: uBottom - uTop,
      })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const channels = info.channels;
    if (
      boxes.length === 1 &&
      boxes[0].left === uLeft &&
      boxes[0].top === uTop &&
      boxes[0].right === uRight &&
      boxes[0].bottom === uBottom
    ) {
      return this._sampleBackdropCrop(data, channels, fillLuma, required);
    }

    const unionWidth = uRight - uLeft;
    const total = boxes.reduce(
      (n, b) => n + (b.right - b.left) * (b.bottom - b.top),
      0
    );
    const packed = Buffer.allocUnsafe(total * channels);
    let offset = 0;
    for (const b of boxes) {
      const rowBytes = (b.right - b.left) * channels;
      for (let y = b.top; y < b.bottom; y++) {
        const start = ((y - uTop) * unionWidth + (b.left - uLeft)) * channels;
        data.copy(packed, offset, start, start + rowBytes);
        offset += rowBytes;
      }
    }
    return this._sampleBackdropCrop(
      packed.subarray(0, offset),
      channels,
      fillLuma,
      required
    );
  }

  /**
   * One pass over a raw RGB(A) crop: per-channel mean, the largest
   * per-channel standard deviation, and the fraction of pixels whose WCAG
   * ratio against `fillLuma` falls below `required`. Returns null for an
   * empty crop.
   */
  private _sampleBackdropCrop(
    data: Buffer,
    channels: number,
    fillLuma: number,
    required: number
  ): {
    mean: [number, number, number];
    backdropStdev: number;
    crossingFraction: number;
  } | null {
    const pixels = Math.floor(data.length / channels);
    if (pixels <= 0) return null;

    const sum = [0, 0, 0];
    const sumSq = [0, 0, 0];
    let crossings = 0;
    for (let p = 0; p < pixels; p++) {
      const i = p * channels;
      const r = data[i];
      const g = channels > 1 ? data[i + 1] : r;
      const b = channels > 2 ? data[i + 2] : r;
      sum[0] += r;
      sum[1] += g;
      sum[2] += b;
      sumSq[0] += r * r;
      sumSq[1] += g * g;
      sumSq[2] += b * b;
      const luma =
        0.2126 * SRGB_CHANNEL_LUT[r] +
        0.7152 * SRGB_CHANNEL_LUT[g] +
        0.0722 * SRGB_CHANNEL_LUT[b];
      const pixelRatio =
        (Math.max(fillLuma, luma) + 0.05) / (Math.min(fillLuma, luma) + 0.05);
      if (pixelRatio < required) crossings++;
    }

    const mean: [number, number, number] = [
      sum[0] / pixels,
      sum[1] / pixels,
      sum[2] / pixels,
    ];
    const backdropStdev = Math.max(
      ...mean.map((m, c) => Math.sqrt(Math.max(0, sumSq[c] / pixels - m * m)))
    );
    return { mean, backdropStdev, crossingFraction: crossings / pixels };
  }

  async renderContactSheet(
    doc: DesignerDoc,
    opts?: RenderOptions & { labels?: boolean; pages?: Buffer[] }
  ): Promise<Buffer> {
    // `pages` lets a caller that already rendered the doc (the AI Designer
    // saver) composite without re-rendering every output.
    const pages = opts?.pages ?? (await this.renderAllPages(doc, opts));
    const outputs = doc.outputs ?? [];
    if (pages.length === 0) {
      throw new Error('No outputs to composite');
    }

    const cols = Math.ceil(Math.sqrt(pages.length));
    const rows = Math.ceil(pages.length / cols);

    // Scale each page to a thumbnail while preserving aspect ratio.
    const thumbMaxW = 400;
    const thumbMaxH = 400;
    const thumbs = pages.map((buf, i) => {
      const out = outputs[i];
      const ratio = out ? Math.min(thumbMaxW / out.width, thumbMaxH / out.height, 1) : 1;
      return {
        buffer: buf,
        width: out ? Math.round(out.width * ratio) : thumbMaxW,
        height: out ? Math.round(out.height * ratio) : thumbMaxH,
        label: out ? `${out.name || out.formatId || `output-${i}`} (${out.width}×${out.height})` : `output-${i}`,
      };
    });

    const pad = 24;
    const colWidths: number[] = [];
    const rowHeights: number[] = [];
    for (let i = 0; i < cols; i++) {
      colWidths[i] = Math.max(
        pad,
        ...thumbs.filter((_, idx) => idx % cols === i).map((t) => t.width)
      );
    }
    for (let r = 0; r < rows; r++) {
      rowHeights[r] = Math.max(
        pad,
        ...thumbs.filter((_, idx) => Math.floor(idx / cols) === r).map((t) => t.height)
      );
    }

    const totalWidth = colWidths.reduce((a, b) => a + b, 0) + pad * (cols + 1);
    const totalHeight = rowHeights.reduce((a, b) => a + b, 0) + pad * (rows + 1) + rows * 24;

    const { createCanvas, loadImage } = await loadCanvasModule();
    const canvas = createCanvas(totalWidth, totalHeight);
    const ctx = canvas.getContext('2d');

    // White backdrop.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, totalWidth, totalHeight);

    let y = pad;
    for (let r = 0; r < rows; r++) {
      let x = pad;
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        const thumb = thumbs[idx];
        if (!thumb) break;

        const cellW = colWidths[c];
        const cellH = rowHeights[r];
        const dx = x + (cellW - thumb.width) / 2;
        const dy = y + (cellH - thumb.height) / 2;

        const img = await loadImage(thumb.buffer);
        ctx.drawImage(img, dx, dy, thumb.width, thumb.height);

        if (opts?.labels !== false) {
          ctx.fillStyle = '#111827';
          ctx.font = 'bold 14px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(thumb.label, x + cellW / 2, dy + thumb.height + 18);
        }

        x += cellW + pad;
      }
      y += rowHeights[r] + pad + 24;
    }

    return canvas.toBuffer('image/png');
  }

  async renderPdf(doc: DesignerDoc, opts?: RenderOptions): Promise<Buffer> {
    const outputs = doc.outputs ?? [];
    const pdf = new PDFDocument({ margin: 0, autoFirstPage: false });
    const chunks: Buffer[] = [];
    const done = new Promise<Buffer>((resolve, reject) => {
      pdf.on('data', (chunk: Buffer) => chunks.push(chunk));
      pdf.on('end', () => resolve(Buffer.concat(chunks)));
      pdf.on('error', reject);
    });

    for (let i = 0; i < outputs.length; i++) {
      const out = outputs[i];
      const png = await this.renderPage(doc, i, opts);
      const w = Math.max(1, Math.round(out.width));
      const h = Math.max(1, Math.round(out.height));
      pdf.addPage({ size: [w, h], margin: 0 });
      pdf.image(png, 0, 0, { width: w, height: h });
    }
    pdf.end();
    return done;
  }

  // -----------------------------------------------------------------

  private async drawBackground(
    ctx: any,
    output: DesignerOutput
  ): Promise<void> {
    const w = output.width;
    const h = output.height;
    const bg = output.bg;

    if (bg?.type === 'gradient' && bg.gradient) {
      ctx.save();
      ctx.fillStyle = this.buildGradient(ctx, bg.gradient, w, h);
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
      return;
    }

    if (bg?.type === 'image' && (bg.src || bg.fileId)) {
      const img = await this.loadImageSafe(bg.src);
      if (img) {
        ctx.save();
        // Cover-crop (uniform scale, focal-point crop) — never a non-uniform
        // stretch. The crop centers when the bg carries no focalPoint (same
        // math as image-element 'cover' fitMode below).
        const srcW = (img as any).naturalWidth || img.width || w;
        const srcH = (img as any).naturalHeight || img.height || h;
        const { sx, sy, sw, sh } = computeCoverCrop(srcW, srcH, w, h, bg.focalPoint);
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
        ctx.restore();
        return;
      }
    }

    const color = bg?.color || output.background || '#ffffff';
    ctx.save();
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  private async drawElement(
    ctx: any,
    el: DesignerElement,
    ignoreBlend = false
  ): Promise<void> {
    ctx.save();
    ctx.globalAlpha = el.opacity ?? 1;
    // Native blends composite for free here; the custom ones are handled by
    // `applyBlend` when the layer is drawn through an offscreen buffer.
    // Callers rendering the element into an EMPTY buffer pass `ignoreBlend`,
    // since blending against nothing erases the layer.
    if (!ignoreBlend && isNativeBlend(el.blendMode)) {
      ctx.globalCompositeOperation = canvasCompositeFor(el.blendMode);
    }

    const cx = el.x + el.width / 2;
    const cy = el.y + el.height / 2;
    ctx.translate(cx, cy);
    if (el.rotation) ctx.rotate((el.rotation * Math.PI) / 180);
    if (el.flipX || el.flipY) ctx.scale(el.flipX ? -1 : 1, el.flipY ? -1 : 1);
    ctx.translate(-el.width / 2, -el.height / 2);

    if (el.type === 'shape') {
      this.drawShape(ctx, el);
    } else if (el.type === 'text') {
      this.drawText(ctx, el);
    } else if (el.type === 'path') {
      this.drawPath(ctx, el);
    } else if (el.type === 'fill') {
      await this.drawFill(ctx, el);
    } else if (el.type === 'image' || el.type === 'icon' || el.type === 'raster') {
      // A raster layer is a flattened bitmap referenced by `src`, so it draws
      // through exactly the same path as an image — which is what makes painted
      // pixels survive PDF and video render, not just the Konva PNG export.
      await this.drawImage(ctx, el);
    }

    ctx.restore();
  }

  /**
   * Render a layer tree onto `ctx`.
   *
   * Groups composite as a unit: their members are drawn into an offscreen
   * canvas which is then blended onto the parent with the group's own opacity
   * and blend mode. That is the whole reason groups exist — a group opacity of
   * 50% must fade the composite, not each member independently.
   *
   * Adjustment layers transform the pixels ALREADY drawn beneath them in this
   * scope, which is why the loop needs the canvas as well as the context.
   */
  private async drawLayerTree(
    ctx: any,
    canvas: any,
    nodes: LayerNode[],
    allChildren: DesignerElement[],
    ratio: number,
    opts?: RenderOptions,
    depth = 0
  ): Promise<void> {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const el = node.element;
      if (el.hidden) continue;
      if (opts?.hideText && el.type === 'text') continue;

      try {
        if (el.type === 'group') {
          await this.drawGroup(ctx, canvas, node, allChildren, ratio, opts, depth);
          continue;
        }

        if (el.type === 'adjustment') {
          // Bound to the layer below when clipped, otherwise the whole scope.
          const below = el.clipped ? nodes[i - 1] : undefined;
          await this.applyAdjustmentLayer(ctx, canvas, el, allChildren, ratio, opts, below);
          continue;
        }

        if (el.maskSrc && el.maskEnabled !== false) {
          await this.drawMaskedElement(ctx, el, ratio);
        } else if (el.styles?.length) {
          await this.drawElementWithStyles(ctx, el, ratio);
        } else {
          await this.drawElement(ctx, el);
        }
      } catch (err) {
        this._logger.warn(
          `Skipping element ${el?.id} (${el?.type}) during render: ${(err as Error)?.message}`
        );
      }
    }
  }

  /**
   * Draw one element with its layer styles.
   *
   * The layer is rendered once into an offscreen buffer, and that buffer's
   * ALPHA is what every effect keys off — a drop shadow is the silhouette blurred
   * and offset, an inner shadow is the same silhouette inverted and clipped back
   * in. Working from the buffer is what lets these apply to any element type
   * (text, image, path, shape) with one implementation.
   */
  private async drawElementWithStyles(
    ctx: any,
    el: DesignerElement,
    ratio: number
  ): Promise<void> {
    const { under, over } = splitStyles(el.styles);
    if (!under.length && !over.length) {
      await this.drawElement(ctx, el);
      return;
    }

    const { createCanvas } = await loadCanvasModule();
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;

    // The layer alone, at page scale, so effects can read its silhouette.
    // `ignoreBlend` matters: inside an empty buffer there is nothing to blend
    // against, so a `multiply` layer would composite with transparent black and
    // vanish. The blend belongs to the finished stack, applied below.
    const layer = createCanvas(w, h);
    const layerCtx: any = layer.getContext('2d');
    layerCtx.scale(ratio, ratio);
    await this.drawElement(layerCtx, el, true);

    // Effects and layer composite into one buffer so the element's blend mode
    // applies to the whole stack, exactly as a group's does.
    const stack = createCanvas(w, h);
    const sctx: any = stack.getContext('2d');
    sctx.scale(ratio, ratio);

    for (const style of under) {
      this.drawUnderStyle(sctx, layer, style, ratio, createCanvas);
    }

    sctx.drawImage(layer, 0, 0, w / ratio, h / ratio);

    for (const style of over) {
      await this.drawOverStyle(sctx, layer, el, style, ratio, createCanvas);
    }

    ctx.save();
    this.applyBlend(ctx, stack, el.blendMode, ratio);
    ctx.restore();
  }

  /**
   * Draw an element through its painted layer mask.
   *
   * The layer goes into an offscreen buffer, the mask bitmap is composited
   * `destination-in`, and the result is drawn onto the page — the same stencil
   * the canvas applies through a cached Konva group. It wraps the WHOLE layer,
   * styles included, so a masked layer's drop shadow is masked too.
   */
  private async drawMaskedElement(
    ctx: any,
    el: DesignerElement,
    ratio: number
  ): Promise<void> {
    const mask = await this.loadImageSafe(el.maskSrc);
    if (!mask) {
      // An unreachable mask must not silently erase the layer.
      if (el.styles?.length) await this.drawElementWithStyles(ctx, el, ratio);
      else await this.drawElement(ctx, el);
      return;
    }

    const { createCanvas } = await loadCanvasModule();
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const buffer = createCanvas(w, h);
    const bctx: any = buffer.getContext('2d');
    bctx.scale(ratio, ratio);

    if (el.styles?.length) await this.drawElementWithStyles(bctx, el, ratio);
    else await this.drawElement(bctx, el);

    bctx.globalCompositeOperation = 'destination-in';
    bctx.drawImage(mask, el.x, el.y, el.width, el.height);
    bctx.globalCompositeOperation = 'source-over';

    // Composite through the layer's own blend mode, exactly as a styled or
    // grouped layer does — drawing the buffer bare would silently render a
    // masked `multiply` layer as `normal`.
    ctx.save();
    this.applyBlend(ctx, buffer, el.blendMode, ratio);
    ctx.restore();
  }

  /** Drop Shadow / Outer Glow — the layer's silhouette, blurred behind it. */
  private drawUnderStyle(
    ctx: any,
    layer: any,
    style: DesignerLayerStyle,
    ratio: number,
    createCanvas: (w: number, h: number) => any
  ): void {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const shadow = createCanvas(w, h);
    const sctx: any = shadow.getContext('2d');

    // Tint the silhouette: draw it, then flood the colour through source-in.
    sctx.drawImage(layer, 0, 0);
    sctx.globalCompositeOperation = 'source-in';
    sctx.fillStyle = style.color || '#000000';
    sctx.fillRect(0, 0, w, h);

    const offset = styleOffset(style);
    const blur = styleBlur(style);
    ctx.save();
    ctx.globalAlpha = style.opacity ?? 0.75;
    if (blur > 0) ctx.filter = `blur(${blur}px)`;
    ctx.drawImage(shadow, offset.x, offset.y, w / ratio, h / ratio);
    ctx.filter = 'none';
    ctx.restore();
  }

  /** Overlays, inner shadow/glow, stroke, bevel and satin — all clipped to the layer. */
  private async drawOverStyle(
    ctx: any,
    layer: any,
    el: DesignerElement,
    style: DesignerLayerStyle,
    ratio: number,
    createCanvas: (w: number, h: number) => any
  ): Promise<void> {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const buf = createCanvas(w, h);
    const bctx: any = buf.getContext('2d');

    if (style.type === 'color-overlay' || style.type === 'gradient-overlay' || style.type === 'pattern-overlay') {
      bctx.drawImage(layer, 0, 0);
      bctx.globalCompositeOperation = 'source-in';
      bctx.scale(ratio, ratio);
      if (style.type === 'gradient-overlay' && style.gradient) {
        bctx.fillStyle = this.buildGradient(bctx, style.gradient, el.width, el.height);
      } else if (style.type === 'pattern-overlay' && style.pattern) {
        const tile = await this.buildPatternTile(style.pattern);
        bctx.fillStyle = tile ? bctx.createPattern(tile, 'repeat') : (style.color || '#000000');
      } else {
        bctx.fillStyle = style.color || '#000000';
      }
      bctx.translate(el.x, el.y);
      bctx.fillRect(-el.x, -el.y, w / ratio, h / ratio);
    } else if (style.type === 'inner-shadow' || style.type === 'inner-glow' || style.type === 'satin') {
      // Inner effects light the INVERSE silhouette, then clip back inside the
      // layer — the same destination-in trick the text mask uses.
      const inverse = createCanvas(w, h);
      const ictx: any = inverse.getContext('2d');
      ictx.fillStyle = style.color || '#000000';
      ictx.fillRect(0, 0, w, h);
      ictx.globalCompositeOperation = 'destination-out';
      ictx.drawImage(layer, 0, 0);

      const offset = style.type === 'inner-glow' ? { x: 0, y: 0 } : styleOffset(style);
      const blur = styleBlur(style) || 4;
      bctx.filter = `blur(${blur}px)`;
      bctx.drawImage(inverse, offset.x * ratio, offset.y * ratio);
      bctx.filter = 'none';
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
      // Offset highlight and shadow copies of the silhouette in opposite
      // directions, clipped inside — a cheap but recognisable bevel.
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
    ctx.drawImage(buf, 0, 0, w / ratio, h / ratio);
    ctx.restore();
  }

  /** Draw a group's members offscreen, then composite the result as one layer. */
  private async drawGroup(
    ctx: any,
    canvas: any,
    node: LayerNode,
    allChildren: DesignerElement[],
    ratio: number,
    opts?: RenderOptions,
    depth = 0
  ): Promise<void> {
    if (!node.children.length) return;

    // Each level costs a page-size buffer, and nesting is unbounded in the
    // document. Past the cap, members draw straight into the parent: group
    // opacity and blend stop applying to the composite, which is a far better
    // failure than exhausting memory on a pathological document.
    if (depth >= MAX_GROUP_RENDER_DEPTH) {
      this._logger.warn(
        `Group nesting deeper than ${MAX_GROUP_RENDER_DEPTH}; drawing members inline`
      );
      await this.drawLayerTree(ctx, canvas, node.children, allChildren, ratio, opts, depth + 1);
      return;
    }

    const { createCanvas } = await loadCanvasModule();
    const groupCanvas = createCanvas(ctx.canvas.width, ctx.canvas.height);
    const groupCtx: any = groupCanvas.getContext('2d');
    groupCtx.scale(ratio, ratio);

    await this.drawLayerTree(
      groupCtx, groupCanvas, node.children, allChildren, ratio, opts, depth + 1
    );

    ctx.save();
    ctx.globalAlpha = node.element.opacity ?? 1;
    this.applyBlend(ctx, groupCanvas, node.element.blendMode, ratio);
    ctx.restore();
  }

  /**
   * Composite an offscreen canvas onto `ctx` under a blend mode.
   *
   * Native modes go through `globalCompositeOperation`; the rest are evaluated
   * per pixel by the shared `pixel-ops` module, which the Designer canvas uses
   * too — that shared implementation is what keeps PNG and PDF identical.
   */
  private applyBlend(ctx: any, source: any, mode: DesignerBlendMode | undefined, ratio: number): void {
    if (isNativeBlend(mode)) {
      ctx.globalCompositeOperation = canvasCompositeFor(mode);
      // The context is scaled; draw in logical units.
      ctx.drawImage(source, 0, 0, ctx.canvas.width / ratio, ctx.canvas.height / ratio);
      ctx.globalCompositeOperation = 'source-over';
      return;
    }

    // Custom blend: read both sides in DEVICE pixels. `ctx.scale(ratio)` is
    // applied once at page setup and never undone, so logical coordinates would
    // read the wrong region on a hi-dpi render.
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const backdrop = ctx.getImageData(0, 0, w, h);
    const src = source.getContext('2d').getImageData(0, 0, w, h);
    blendPixels(backdrop, src, mode as DesignerBlendMode, ctx.globalAlpha ?? 1);
    ctx.putImageData(backdrop, 0, 0);
  }

  /**
   * Transform everything drawn so far. Reads back in DEVICE pixels for the same
   * `ctx.scale(ratio)` reason as above.
   *
   * A CLIPPED adjustment reaches only the pixels its base layer actually
   * painted — not that layer's bounding box. The Designer canvas clips by
   * caching the base layer alone and filtering that bitmap, so its transparent
   * gaps are untouched; masking by the box here instead would recolour the
   * backdrop showing through those gaps and the PNG would stop matching the PDF.
   */
  private async applyAdjustmentLayer(
    ctx: any,
    canvas: any,
    el: DesignerElement,
    allChildren: DesignerElement[],
    ratio: number,
    opts?: RenderOptions,
    clipTo?: LayerNode
  ): Promise<void> {
    if (!el.adjustment) return;
    if (canvas.width <= 0 || canvas.height <= 0) return;

    // Unclipped: the whole scope. Clipped: only the region its base layer can
    // reach, so a small clipped adjustment costs a small readback rather than a
    // full page one — this runs on the shared render endpoint.
    const region = clipTo
      ? this.nodeRegion(clipTo, allChildren, canvas, ratio)
      : { x: 0, y: 0, w: canvas.width, h: canvas.height };
    if (!region || region.w <= 0 || region.h <= 0) return;

    const data = ctx.getImageData(region.x, region.y, region.w, region.h);
    const before = clipTo ? Uint8ClampedArray.from(data.data) : null;
    applyAdjustment(data, el.adjustment);

    if (clipTo && before) {
      const mask = await this.renderNodeAlone(clipTo, allChildren, region, canvas, ratio, opts);
      const px = data.data;
      for (let i = 0; i < px.length; i += 4) {
        const a = mask[i + 3] / 255;
        if (a >= 1) continue;
        // Feather with the base layer's own alpha so antialiased edges blend
        // instead of stepping.
        px[i] = before[i] + (px[i] - before[i]) * a;
        px[i + 1] = before[i + 1] + (px[i + 1] - before[i + 1]) * a;
        px[i + 2] = before[i + 2] + (px[i + 2] - before[i + 2]) * a;
        px[i + 3] = before[i + 3] + (px[i + 3] - before[i + 3]) * a;
      }
    }

    ctx.putImageData(data, region.x, region.y);
  }

  /**
   * The device-pixel region a node's own drawing can reach, clamped to the
   * canvas: its rotated bounding box plus whatever its effects and stroke add.
   * Returns null when the node lands entirely off-page.
   */
  private nodeRegion(
    node: LayerNode,
    allChildren: DesignerElement[],
    canvas: any,
    ratio: number
  ): { x: number; y: number; w: number; h: number } | null {
    const el = node.element;
    const box =
      el.type === 'group'
        ? groupBounds(allChildren, el.id)
        : { x: el.x, y: el.y, width: el.width, height: el.height };
    if (!box) return null;

    // Rotation is applied about the element's centre, so the axis-aligned box
    // it occupies is wider than width/height.
    const rot = ((el.rotation || 0) * Math.PI) / 180;
    const cos = Math.abs(Math.cos(rot));
    const sin = Math.abs(Math.sin(rot));
    const bw = box.width * cos + box.height * sin;
    const bh = box.width * sin + box.height * cos;

    // Slack for anything that paints outside the box: layer effects, a stroke
    // straddling the edge, a text shadow, plus a couple of pixels of
    // antialiasing. Too generous only costs a little memory; too tight would
    // silently crop the adjustment.
    const shadow = el.textShadow;
    const pad =
      stylePadding(el.styles) +
      (el.strokeWidth || 0) +
      (shadow
        ? (shadow.blur || 0) + Math.abs(shadow.offsetX || 0) + Math.abs(shadow.offsetY || 0)
        : 0) +
      4;

    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const x = Math.max(0, Math.floor((cx - bw / 2 - pad) * ratio));
    const y = Math.max(0, Math.floor((cy - bh / 2 - pad) * ratio));
    const w = Math.min(canvas.width - x, Math.ceil((bw + pad * 2) * ratio) + 2);
    const h = Math.min(canvas.height - y, Math.ceil((bh + pad * 2) * ratio) + 2);
    if (w <= 0 || h <= 0) return null;
    return { x, y, w, h };
  }

  /**
   * One layer (or group subtree) drawn alone, for use as a clipping mask; only
   * `region` is read back.
   *
   * The buffer is page-sized rather than region-sized on purpose. Every
   * offscreen buffer below this point (group compositing, layer styles) is
   * built from `ctx.canvas` dimensions and assumes the page origin, so handing
   * this path a translated context would misplace a styled or grouped base
   * layer. Only the readback is bounded, which is where the cost actually is.
   */
  private async renderNodeAlone(
    node: LayerNode,
    allChildren: DesignerElement[],
    region: { x: number; y: number; w: number; h: number },
    canvas: any,
    ratio: number,
    opts?: RenderOptions
  ): Promise<Uint8ClampedArray> {
    const { createCanvas } = await loadCanvasModule();
    const maskCanvas = createCanvas(canvas.width, canvas.height);
    const maskCtx: any = maskCanvas.getContext('2d');
    maskCtx.scale(ratio, ratio);
    await this.drawLayerTree(maskCtx, maskCanvas, [node], allChildren, ratio, opts);
    return maskCtx.getImageData(region.x, region.y, region.w, region.h).data;
  }

  /**
   * A repeatable tile for a pattern — either the uploaded image it names, or a
   * procedural preset drawn through the shared generator.
   */
  private async buildPatternTile(pattern: DesignerPattern): Promise<any | null> {
    if (pattern.src) {
      return this.loadImageSafe(pattern.src);
    }
    if (!pattern.preset) return null;

    const { createCanvas } = await loadCanvasModule();
    const size = tileSizeFor(pattern);
    const tile = createCanvas(size, size);
    drawPatternTile(tile.getContext('2d') as never, pattern, size);
    return tile;
  }

  /** A `fill` layer paints its box with a solid colour, gradient or pattern. */
  private async drawFill(ctx: any, el: DesignerElement): Promise<void> {
    const style = el.fillStyle;
    if (!style) return;

    if (style.type === 'gradient' && style.gradient) {
      ctx.fillStyle = this.buildGradient(ctx, style.gradient, el.width, el.height);
    } else if (style.type === 'pattern' && style.pattern) {
      const tile = await this.buildPatternTile(style.pattern);
      ctx.fillStyle = tile ? ctx.createPattern(tile, 'repeat') : (style.color || '#000000');
    } else {
      ctx.fillStyle = style.color || '#000000';
    }
    ctx.fillRect(0, 0, el.width, el.height);
  }

  /**
   * Pen-tool path. Traced through the shared `path-geometry` helper so the
   * exported curve is byte-for-byte the curve the canvas drew.
   */
  private drawPath(ctx: any, el: DesignerElement): void {
    const nodes = el.nodes;
    if (!nodes?.length) return;
    const fill = el.fillGradient
      ? this.buildGradient(ctx, el.fillGradient, el.width, el.height)
      : el.fill;

    tracePathNodes(ctx, nodes, !!el.closed);
    // Only a closed path is fillable; an open one would fill its implicit chord.
    if (fill && el.closed) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (el.stroke && (el.strokeWidth || 0) > 0) {
      ctx.strokeStyle = el.stroke;
      ctx.lineWidth = el.strokeWidth as number;
      this.applyStrokeStyle(ctx, el);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    this.drawArrowHeads(ctx, el, (el.nodes || []).map((n) => ({ x: n.x, y: n.y })));
  }

  /**
   * Apply the Illustrator-grade stroke options canvas2d supports natively.
   * Arrowheads are not among them; `drawArrowHeads` traces those.
   */
  private applyStrokeStyle(ctx: any, el: DesignerElement): void {
    const st = el.strokeStyle;
    ctx.setLineDash(st?.dash?.length ? st.dash : []);
    ctx.lineDashOffset = st?.dashOffset || 0;
    ctx.lineCap = st?.lineCap || 'butt';
    ctx.lineJoin = st?.lineJoin || 'miter';
    ctx.miterLimit = st?.miterLimit || 10;
  }

  /**
   * Arrowheads at the ends of a line or open path, filled with the stroke
   * colour. Shared geometry (designer-doc/stroke-style) so the head is the same
   * shape in the editor, the PDF and an exported frame.
   */
  private drawArrowHeads(ctx: any, el: DesignerElement, points: { x: number; y: number }[]): void {
    const st = el.strokeStyle;
    if (!st || (!st.arrowStart && !st.arrowEnd)) return;
    const ends = strokeEndpoints(points);
    if (!ends) return;
    const width = el.strokeWidth || 1;
    ctx.save();
    ctx.setLineDash([]);
    ctx.fillStyle = el.stroke || el.fill || '#000000';
    for (const [head, tip, angle] of [
      [st.arrowStart, ends.start, ends.startAngle] as const,
      [st.arrowEnd, ends.end, ends.endAngle] as const,
    ]) {
      const pts = arrowHeadPoints(head || 'none', tip, angle, width);
      if (!pts.length) continue;
      ctx.beginPath();
      pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  private drawShape(ctx: any, el: DesignerElement): void {
    const fill = el.fillGradient
      ? this.buildGradient(ctx, el.fillGradient, el.width, el.height)
      : el.fill;
    const shape = el.shape || 'rect';

    if (shape === 'line') {
      ctx.beginPath();
      ctx.moveTo(0, el.height / 2);
      ctx.lineTo(el.width, el.height / 2);
      ctx.strokeStyle = el.stroke || el.fill || '#000000';
      ctx.lineWidth = el.strokeWidth || 1;
      this.applyStrokeStyle(ctx, el);
      ctx.stroke();
      ctx.setLineDash([]);
      this.drawArrowHeads(ctx, el, [
        { x: 0, y: el.height / 2 },
        { x: el.width, y: el.height / 2 },
      ]);
      return;
    }

    if (shape === 'ellipse') {
      ctx.beginPath();
      ctx.ellipse(el.width / 2, el.height / 2, el.width / 2, el.height / 2, 0, 0, Math.PI * 2);
    } else if (shape === 'star' || shape === 'triangle' || shape === 'polygon') {
      // Shared with the canvas (designer-doc/shape-geometry) so the exported
      // polygon is the one the user drew.
      const pts = pointsForShape(shape, el.width, el.height, el.sides, el.innerRatio);
      this.tracePath(ctx, (pts || []).map((p) => [p.x, p.y] as [number, number]));
    } else {
      this.traceRoundRect(ctx, 0, 0, el.width, el.height, el.borderRadius || 0);
    }

    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (el.stroke && (el.strokeWidth || 0) > 0) {
      ctx.strokeStyle = el.stroke;
      ctx.lineWidth = el.strokeWidth as number;
      this.applyStrokeStyle(ctx, el);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  private drawText(ctx: any, el: DesignerElement): void {
    const text = el.text ?? '';
    const rich = el.richText;
    if (!text && !rich?.length) return;

    const flatText = rich?.length ? rich.map((r) => r.text).join('') : text;

    // Text-on-path takes precedence over straight/curved layout.
    if (el.textPath) {
      this.drawTextOnPath(ctx, flatText, el, el.textPath);
      return;
    }

    // Rich text branch
    if (rich?.length) {
      const curve = el.curve || 0;
      if (curve !== 0) {
        this.drawCurvedText(ctx, flatText, el, el.fontSize || 16, el.fontStyle ?? 'normal', el.fontWeight ?? 400, el.fontFamily || 'sans-serif', curve);
        return;
      }
      this.drawRichText(ctx, el);
      return;
    }

    // Flat text fallback
    const fontSize = el.fontSize || 16;
    const fontWeight = el.fontWeight || 400;
    const fontStyle = el.fontStyle === 'italic' ? 'italic' : 'normal';
    const fontFamily = el.fontFamily || 'sans-serif';
    const align = el.align || 'left';
    const letterSpacing = el.letterSpacing || 0;
    const curve = el.curve || 0;

    ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;
    ctx.textBaseline = 'top';
    ctx.fillStyle = el.fill || '#000000';
    if (typeof ctx.textAlign === 'string') ctx.textAlign = 'left';

    if (el.textShadow) {
      ctx.shadowColor = el.textShadow.color;
      ctx.shadowBlur = el.textShadow.blur || 0;
      ctx.shadowOffsetX = el.textShadow.offsetX || 0;
      ctx.shadowOffsetY = el.textShadow.offsetY || 0;
    }

    if (curve !== 0) {
      this.drawCurvedText(ctx, text, el, fontSize, fontStyle, fontWeight, fontFamily, curve);
      return;
    }

    // Auto-fit: shrink the font (down to a floor) until the wrapped block
    // fits the box height — a flat text element must never silently overflow
    // its box bottom.
    const fitted = this.fitFlatText(ctx, text, el, fontSize, fontStyle, fontWeight, fontFamily, letterSpacing);
    ctx.font = `${fontStyle} ${fontWeight} ${fitted.fontSize}px ${fontFamily}`;

    const contentHeight = fitted.lines.length * fitted.lineHeight;
    let y = 0;
    if (el.verticalAlign === 'middle') y = Math.max(0, (el.height - contentHeight) / 2);
    else if (el.verticalAlign === 'bottom') y = Math.max(0, el.height - contentHeight);

    for (const line of fitted.lines) {
      const lineWidth = this.measureLine(ctx, line, letterSpacing);
      let x = 0;
      if (align === 'center') x = (el.width - lineWidth) / 2;
      else if (align === 'right') x = el.width - lineWidth;
      this.drawTextLine(ctx, line, x, y, letterSpacing, el);
      y += fitted.lineHeight;
    }
  }

  /**
   * Measure (and shrink-to-fit) a flat text block. The algorithm lives in
   * `designer-doc/fit-text` so the Designer canvas lays text out identically —
   * see that module. The canvas font is left set to the returned size.
   */
  private fitFlatText(
    ctx: any, text: string, el: DesignerElement,
    fontSize: number, fontStyle: string, fontWeight: number,
    fontFamily: string, letterSpacing: number
  ): FittedText {
    return fitTextToBox(
      {
        text,
        width: el.width,
        height: el.height,
        fontSize,
        lineHeight: el.lineHeight,
        letterSpacing,
      },
      (line, size) => {
        ctx.font = `${fontStyle} ${fontWeight} ${size}px ${fontFamily}`;
        return ctx.measureText(line).width;
      }
    );
  }

  private drawRichText(ctx: any, el: DesignerElement): void {
    const runs = el.richText!;
    if (!runs.length) return;

    const maxWidth = el.width;
    const align = el.align || 'left';
    const lineHeightFactor = el.lineHeight ?? 1.2;

    if (el.textShadow) {
      ctx.shadowColor = el.textShadow.color;
      ctx.shadowBlur = el.textShadow.blur || 0;
      ctx.shadowOffsetX = el.textShadow.offsetX || 0;
      ctx.shadowOffsetY = el.textShadow.offsetY || 0;
    }

    interface Seg { text: string; run: TextRun; }
    const lines: Seg[][] = [[]];
    let lineWidth = 0;

    const setRunFont = (run: TextRun) => {
      const s = run.fontStyle ?? el.fontStyle ?? 'normal';
      const w = run.fontWeight ?? el.fontWeight ?? 400;
      const sz = run.fontSize ?? el.fontSize ?? 16;
      const f = run.fontFamily ?? el.fontFamily ?? 'sans-serif';
      ctx.font = `${s === 'italic' ? 'italic' : 'normal'} ${w} ${sz}px ${f}`;
    };

    for (const run of runs) {
      if (!run.text) continue;
      setRunFont(run);

      const paragraphs = run.text.split('\n');
      for (let pi = 0; pi < paragraphs.length; pi++) {
        const words = paragraphs[pi].split(' ');
        for (let wi = 0; wi < words.length; wi++) {
          const raw = words[wi];
          if (raw === '') {
            const spw = ctx.measureText(' ').width;
            if (lineWidth + spw > maxWidth && lineWidth > 0) { lines.push([]); lineWidth = 0; }
            lineWidth += spw;
            continue;
          }
          const display = wi < words.length - 1 ? raw + ' ' : raw;
          const ww = ctx.measureText(display).width;
          if (lineWidth > 0 && lineWidth + ww > maxWidth) { lines.push([]); lineWidth = 0; }
          lines[lines.length - 1].push({ text: display, run: { ...run } });
          lineWidth += ww;
        }
        if (pi < paragraphs.length - 1) { lines.push([]); lineWidth = 0; }
      }
    }

    let y = 0;
    for (const line of lines) {
      if (!line.length) { y += lineHeightFactor * (runs[0]?.fontSize ?? el.fontSize ?? 16); continue; }

      let totalW = 0;
      for (const seg of line) { setRunFont(seg.run); totalW += ctx.measureText(seg.text).width; }

      let x = 0;
      if (align === 'center') x = (maxWidth - totalW) / 2;
      else if (align === 'right') x = maxWidth - totalW;

      let lineH = 0;
      for (const seg of line) {
        const sz = seg.run.fontSize ?? el.fontSize ?? 16;
        lineH = Math.max(lineH, lineHeightFactor * sz);
      }

      for (const seg of line) {
        setRunFont(seg.run);
        const fill = seg.run.fill || el.fill || '#000000';
        const sz = seg.run.fontSize ?? el.fontSize ?? 16;
        ctx.fillStyle = fill;
        ctx.textBaseline = 'top';
        ctx.textAlign = 'left';

        if (el.textStroke?.width && el.textStroke.width > 0) {
          ctx.strokeStyle = el.textStroke.color;
          ctx.lineWidth = el.textStroke.width;
          ctx.strokeText(seg.text, x, y);
        }

        ctx.fillText(seg.text, x, y);

        if (seg.run.underline) {
          const uy = y + sz * 1.15;
          ctx.strokeStyle = fill;
          ctx.lineWidth = Math.max(1, sz / 14);
          ctx.beginPath();
          ctx.moveTo(x, uy);
          ctx.lineTo(x + ctx.measureText(seg.text).width, uy);
          ctx.stroke();
        }

        x += ctx.measureText(seg.text).width;
      }
      y += lineH;
    }
  }

  private drawCurvedText(
    ctx: any, text: string, el: DesignerElement,
    fontSize: number, fontStyle: string, fontWeight: number,
    fontFamily: string, curve: number
  ): void {
    const radius = Math.abs(curve) > 0 ? (el.width / 2) / Math.sin(Math.abs(curve) * Math.PI / 360) : Infinity;
    if (!isFinite(radius)) return;

    const totalAngle = (el.width / (2 * Math.PI * radius)) * (Math.PI * 2);
    const startAngle = -totalAngle / 2;
    let charOffset = 0;

    for (const ch of text) {
      const charWidth = ctx.measureText(ch).width;
      const midAngle = startAngle + (charOffset + charWidth / 2) / (2 * Math.PI * radius) * (Math.PI * 2);
      const cx = el.width / 2 + Math.sin(midAngle) * radius;
      const cy = -Math.cos(midAngle) * radius + radius;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(midAngle);
      if (el.textStroke && el.textStroke.width > 0) {
        ctx.strokeStyle = el.textStroke.color;
        ctx.lineWidth = el.textStroke.width;
        ctx.strokeText(ch, -charWidth / 2, 0);
      }
      ctx.fillText(ch, -charWidth / 2, 0);
      ctx.restore();
      charOffset += charWidth;
    }
  }

  // ----- Text on arbitrary path (T-33 server parity) -------------------------

  private drawTextOnPath(
    ctx: any, text: string, el: DesignerElement, pathData: string
  ): void {
    if (!text) return;
    const points = sampleSvgPath(pathData);
    if (points.length < 2) {
      // Invalid path: fall back to straight text.
      this.drawRichText(ctx, el);
      return;
    }

    const fontSize = el.fontSize || 16;
    const fontWeight = el.fontWeight || 400;
    const fontStyle = el.fontStyle === 'italic' ? 'italic' : 'normal';
    const fontFamily = el.fontFamily || 'sans-serif';
    const letterSpacing = el.letterSpacing || 0;

    ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = el.fill || '#000000';

    if (el.textShadow) {
      ctx.shadowColor = el.textShadow.color;
      ctx.shadowBlur = el.textShadow.blur || 0;
      ctx.shadowOffsetX = el.textShadow.offsetX || 0;
      ctx.shadowOffsetY = el.textShadow.offsetY || 0;
    }

    const { distances, total } = pathDistances(points);

    let textWidth = -letterSpacing;
    for (const ch of text) {
      textWidth += ctx.measureText(ch).width + letterSpacing;
    }

    const align = el.align || 'left';
    let offset = 0;
    if (align === 'center') offset = Math.max(0, (total - textWidth) / 2);
    else if (align === 'right') offset = Math.max(0, total - textWidth);

    let current = offset;
    for (const ch of text) {
      const cw = ctx.measureText(ch).width;
      const center = current + cw / 2;
      if (center > total) break;

      const { x, y, angle } = pointAtDistance(points, distances, center);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      if (el.textStroke && el.textStroke.width > 0) {
        ctx.strokeStyle = el.textStroke.color;
        ctx.lineWidth = el.textStroke.width;
        ctx.strokeText(ch, -cw / 2, 0);
      }
      ctx.fillText(ch, -cw / 2, 0);
      ctx.restore();
      current += cw + letterSpacing;
    }
  }

  private drawTextLine(
    ctx: any, line: string, startX: number, y: number,
    letterSpacing: number, el: DesignerElement
  ): void {
    if (!letterSpacing) {
      if (el.textStroke && el.textStroke.width > 0) {
        ctx.strokeText(line, startX, y);
      }
      ctx.fillText(line, startX, y);
      return;
    }

    let x = startX;
    for (const ch of line) {
      if (el.textStroke && el.textStroke.width > 0) {
        ctx.strokeText(ch, x, y);
      }
      ctx.fillText(ch, x, y);
      x += ctx.measureText(ch).width + letterSpacing;
    }
  }

  private async drawImage(ctx: any, el: DesignerElement): Promise<void> {
    const loaded = await this.loadElementImage(el);
    if (!loaded) return;
    const { img } = loaded;

    ctx.save();

    // Apply CSS filters via ctx.filter (server parity with client Konva filters)
    if (el.filters?.length) {
      const filterStr = mapFilters(el.filters);
      if (filterStr) ctx.filter = filterStr;
    }

    // Apply mask (photo-in-shape / photo-in-text). Shape masks clip via a path;
    // text masks are applied as an alpha stencil using destination-in after the
    // image is drawn, because standard Canvas does not expose glyph paths.
    const textMask = el.mask?.type === 'text' ? el.mask : undefined;
    const shapeMask = el.mask?.type === 'shape' ? el.mask : undefined;

    if (shapeMask) {
      this.traceMask(ctx, shapeMask, el.width, el.height);
      ctx.clip();
    }

    // Apply border-radius clip (only if no mask — mask supersedes)
    if (!el.mask && el.borderRadius && el.borderRadius > 0) {
      this.traceRoundRect(ctx, 0, 0, el.width, el.height, el.borderRadius);
      ctx.clip();
    }

    // fitMode cover-crop (server parity with client ImageNode)
    if (el.fitMode === 'cover') {
      const { sx, sy, sw, sh } = computeCoverCrop(
        (img as any).naturalWidth || img.width || el.width,
        (img as any).naturalHeight || img.height || el.height,
        el.width, el.height,
        el.focalPoint
      );
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, el.width, el.height);
    } else if (el.fitMode === 'fill') {
      ctx.drawImage(img, 0, 0, el.width, el.height);
    } else {
      // 'contain' or default — letterbox behaviour. A smart-filtered bitmap
      // was already cropped at evaluation time; applying el.crop again would
      // read outside it.
      const crop = loaded.preCropped ? undefined : el.crop;
      if (crop) {
        ctx.drawImage(img, crop.x, crop.y, crop.width, crop.height, 0, 0, el.width, el.height);
      } else {
        const srcW = (img as any).naturalWidth || img.width || el.width;
        const srcH = (img as any).naturalHeight || img.height || el.height;
        const scale = Math.min(el.width / srcW, el.height / srcH, 1);
        const dw = srcW * scale;
        const dh = srcH * scale;
        const dx = (el.width - dw) / 2;
        const dy = (el.height - dh) / 2;
        ctx.drawImage(img, 0, 0, srcW, srcH, dx, dy, dw, dh);
      }
    }

    // Text mask: stencil the already-drawn image to the glyph shapes.
    if (textMask) {
      ctx.filter = 'none';
      await this.applyTextMask(ctx, textMask, el.width, el.height);
    }

    ctx.restore();
  }

  private async applyTextMask(
    ctx: any,
    mask: DesignerMask,
    w: number,
    h: number,
  ): Promise<void> {
    const text = mask.text?.trim();
    if (!text) return;

    const { createCanvas } = await loadCanvasModule();
    const maskCanvas = createCanvas(w, h);
    const mctx = maskCanvas.getContext('2d');

    const fontFamily = mask.fontFamily || 'sans-serif';
    const fontWeight = mask.fontWeight ?? 700;
    // Scale font to fill the frame height; leave a small margin so descenders fit.
    const fontSize = Math.max(8, Math.round(h * 0.85));

    mctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
    mctx.textAlign = 'center';
    mctx.textBaseline = 'middle';
    mctx.fillStyle = '#ffffff';
    mctx.fillText(text, w / 2, h / 2);

    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(maskCanvas, 0, 0, w, h, 0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
  }

  // -----------------------------------------------------------------
  // Shape tracing helpers for masks

  private traceMask(ctx: any, mask: DesignerMask, w: number, h: number): void {
    // Text masks are applied via applyTextMask using a destination-in stencil.
    if (mask.type !== 'shape') return;
    const shape = mask.shape || 'ellipse';
    ctx.beginPath();
    if (shape === 'ellipse') {
      ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    } else if (shape === 'rounded-rect') {
      this.traceRoundRect(ctx, 0, 0, w, h, mask.cornerRadius || 8);
    } else if (shape === 'triangle') {
      this.tracePath(ctx, [[w / 2, 0], [w, h], [0, h]]);
    } else if (shape === 'star') {
      this.tracePath(
        ctx,
        starPoints(w, h).map((p) => [p.x, p.y] as [number, number])
      );
    } else if (shape === 'hexagon') {
      this.tracePath(ctx, this.hexagonPoints(w, h));
    } else if (shape === 'heart') {
      this.tracePath(ctx, this.heartPoints(w, h));
    }
    ctx.closePath();
  }

  private hexagonPoints(w: number, h: number): Array<[number, number]> {
    const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2;
    const pts: Array<[number, number]> = [];
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i - Math.PI / 6;
      pts.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]);
    }
    return pts;
  }

  private heartPoints(w: number, h: number): Array<[number, number]> {
    const pts: Array<[number, number]> = [];
    const scale = Math.min(w, h) / 100;
    for (let i = 0; i <= 40; i++) {
      const t = (i / 40) * Math.PI * 2;
      const x = 16 * Math.pow(Math.sin(t), 3);
      const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
      pts.push([50 + x * scale, 50 - y * scale]);
    }
    return pts;
  }

  // -----------------------------------------------------------------

  private buildGradient(ctx: any, g: DesignerGradient, width: number, height: number): any {
    let grad: any;
    if (g.type === 'radial') {
      const r = Math.max(width, height) / 2;
      grad = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, r);
    } else {
      const angle = ((g.angle ?? 0) * Math.PI) / 180;
      const halfW = width / 2, halfH = height / 2;
      const dx = Math.cos(angle) * halfW, dy = Math.sin(angle) * halfH;
      grad = ctx.createLinearGradient(halfW - dx, halfH - dy, halfW + dx, halfH + dy);
    }
    for (const stop of g.stops ?? []) {
      grad.addColorStop(Math.min(1, Math.max(0, stop.offset)), stop.color);
    }
    return grad;
  }

  private traceRoundRect(ctx: any, x: number, y: number, w: number, h: number, r: number): void {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    if (radius <= 0) { ctx.rect(x, y, w, h); return; }
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  private tracePath(ctx: any, points: Array<[number, number]>): void {
    if (!points.length) return;
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
    ctx.closePath();
  }

  /**
   * Width of one line at the font ALREADY set on `ctx` — callers set the fitted
   * size before calling, so the size argument to the shared helper is unused
   * here.
   */
  private measureLine(ctx: any, line: string, letterSpacing: number): number {
    return measureLineWidth(line, 0, letterSpacing, (t) => ctx.measureText(t).width);
  }

  /**
   * Evaluated smart-filter stacks, keyed by source URL + recipe.
   *
   * CONTENT-ADDRESSED, which is what makes a single shared cache safe here: the
   * key names the exact pixels in and the exact operations over them, so two
   * concurrent renders — or two orgs that happen to reference the same URL —
   * asking for the same key genuinely want the same answer. Scoping it to one
   * render pass instead would need either a context threaded through every draw
   * call or a mutable field that two overlapping renders would stomp on.
   *
   * The one assumption is that a URL's bytes do not change under it. That holds
   * by contract: `originalSrc` is written once and never rewritten, and a
   * re-bake uploads to a new file rather than overwriting.
   */
  private readonly _smartFilterCache = new Map<string, any>();

  private _cacheSmartFilter(key: string, canvas: any): void {
    this._smartFilterCache.set(key, canvas);
    while (this._smartFilterCache.size > SMART_FILTER_CACHE_MAX) {
      const oldest = this._smartFilterCache.keys().next().value;
      if (oldest === undefined) break;
      this._smartFilterCache.delete(oldest);
    }
  }

  /**
   * The bitmap an element draws, with its smart-filter stack applied.
   *
   * Smart filters are stored as a RECIPE plus the pre-filter pixels, and the
   * client re-bakes them into `src` to keep the canvas responsive. That made the
   * renderers' job free — they drew a plain bitmap — but it also meant the
   * recipe only ever became pixels if a browser was involved. A document built
   * through `POST /media/apply-ops`, through the SDK, or by the AI Designer
   * rendered completely unfiltered, and since the AI Designer's vision critic
   * reviews the SERVER render, a treatment it asked for was invisible to the
   * design, the preview and the critique alike.
   *
   * So the recipe is evaluated here too. The client bake stays, but as an
   * optimisation rather than a correctness requirement: whichever way the
   * document arrived, this is what it looks like.
   */
  private async loadElementImage(
    el: DesignerElement
  ): Promise<{ img: any; preCropped: boolean } | null> {
    if (!hasSmartFilters(el)) {
      const img = await this.loadImageSafe(el.src);
      return img ? { img, preCropped: false } : null;
    }

    const source = smartFilterSource(el);
    if (!source) return null;

    // An explicit crop is in ORIGINAL source pixels, so it must be applied
    // BEFORE the stack is evaluated (and before any downscale): evaluating the
    // full >16MP source at the capped size would leave the crop coordinates
    // pointing at pixels the cached bitmap no longer has.
    const crop = el.crop;
    const key =
      smartFilterCacheKey(source, el.smartFilters) +
      (crop ? `|crop:${crop.x},${crop.y},${crop.width},${crop.height}` : '');
    const cached = this._smartFilterCache.get(key);
    if (cached) return { img: cached, preCropped: !!crop };

    const img = await this.loadImageSafe(source);
    if (!img) return null;

    try {
      const { createCanvas } = await loadCanvasModule();
      const srcW = Math.max(1, Math.round(img.naturalWidth || img.width));
      const srcH = Math.max(1, Math.round(img.naturalHeight || img.height));
      // The crop rect, clamped into the source — a crop can outlive a
      // re-uploaded image's dimensions.
      const sx = crop ? Math.min(Math.max(0, crop.x), srcW - 1) : 0;
      const sy = crop ? Math.min(Math.max(0, crop.y), srcH - 1) : 0;
      const baseW = crop ? Math.min(Math.max(1, crop.width), srcW - sx) : srcW;
      const baseH = crop ? Math.min(Math.max(1, crop.height), srcH - sy) : srcH;

      // Evaluate at the (possibly cropped) SOURCE's own resolution, not the
      // element's box. A stack is a pixel operation, not a geometry one:
      // keeping the source dimensions is what leaves `naturalWidth`/
      // `naturalHeight`, `crop`, `fitMode` and `focalPoint` still meaning what
      // they meant before a filter was added.
      const area = baseW * baseH;
      const scale = area > MAX_SMART_FILTER_PIXELS ? Math.sqrt(MAX_SMART_FILTER_PIXELS / area) : 1;
      const w = Math.max(1, Math.round(baseW * scale));
      const h = Math.max(1, Math.round(baseH * scale));

      const canvas = createCanvas(w, h);
      const cctx = canvas.getContext('2d');
      cctx.drawImage(img, sx, sy, baseW, baseH, 0, 0, w, h);
      const data = cctx.getImageData(0, 0, w, h);
      applySmartFilters(data, el.smartFilters);
      cctx.putImageData(data, 0, 0);

      this._cacheSmartFilter(key, canvas);
      return { img: canvas, preCropped: !!crop };
    } catch (err) {
      // Fail soft, as everything else on the draw path does: an unfiltered
      // image is a worse design, a missing one is a broken render.
      this._logger.warn(
        `Smart filters skipped for element ${el?.id}: ${(err as Error)?.message}`
      );
      return { img, preCropped: false };
    }
  }

  private async loadImageSafe(src?: string): Promise<any | null> {
    if (!src) return null;
    try {
      const { loadImage } = await loadCanvasModule();
      if (src.startsWith('data:')) return await loadImage(src);
      // Local-storage uploads (dev/local disk) resolve to a localhost URL that
      // safeFetch rightly refuses (private host). Read them from disk instead —
      // same pattern as the vision critic — with a traversal guard.
      const localPath = this._localUploadPath(src);
      if (localPath) {
        const buffer = await readFile(localPath);
        if (buffer.byteLength > MAX_IMAGE_BYTES) return null;
        return await this._decodeImage(buffer, loadImage);
      }
      const res = await safeFetch(src);
      if (!res.ok) return null;
      const contentLength = res.headers.get('content-length');
      if (contentLength && parseInt(contentLength, 10) > MAX_IMAGE_BYTES) return null;
      const arrayBuffer = await res.arrayBuffer();
      if (arrayBuffer.byteLength > MAX_IMAGE_BYTES) return null;
      return await this._decodeImage(Buffer.from(arrayBuffer), loadImage);
    } catch (err) {
      this._logger.warn(`Failed to load image: ${(err as Error)?.message}`);
      return null;
    }
  }

  /** node-canvas can't decode WebP (uploads store generated assets as .webp);
   *  transcode through sharp when direct decode fails. */
  private async _decodeImage(buffer: Buffer, loadImage: (b: Buffer) => Promise<any>) {
    try {
      return await loadImage(buffer);
    } catch {
      const sharp = (await import('sharp')).default;
      const png = await sharp(buffer).png().toBuffer();
      return await loadImage(png);
    }
  }

  /** Map a local-storage upload URL to its on-disk path, or null when the src
   *  is not local storage. Resolved path must stay inside UPLOAD_DIRECTORY. */
  private _localUploadPath(src: string): string | null {
    const frontendUrl = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
    let key: string | null = null;
    if (frontendUrl && src.startsWith(`${frontendUrl}/uploads/`)) {
      key = src.slice(`${frontendUrl}/uploads/`.length);
    } else if (src.startsWith('/uploads/')) {
      key = src.slice('/uploads/'.length);
    }
    if (!key) return null;
    const uploadDirectory = path.resolve(process.env.UPLOAD_DIRECTORY || './uploads');
    const resolved = path.resolve(uploadDirectory, decodeURIComponent(key));
    if (resolved !== uploadDirectory && !resolved.startsWith(uploadDirectory + path.sep)) {
      this._logger.warn(`Blocked upload path traversal in render: ${src}`);
      return null;
    }
    return resolved;
  }
}
