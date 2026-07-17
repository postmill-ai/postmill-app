/// <reference types="./pdfkit" />
import { Injectable, Logger } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { safeFetch } from '@gitroom/nestjs-libraries/dtos/webhooks/safe.fetch';
import {
  DesignerDoc,
  DesignerElement,
  DesignerGradient,
  DesignerOutput,
  DesignerMask,
  RenderOptions,
  TextRun,
} from './design-render.types';
import { FontLoaderService } from './font-loader.service';
import {
  cssFilterForToken,
  parseDesignerFilterToken,
} from './filter-tokens';
import { MAX_CANVAS_DIMENSION } from '../designer-doc/designer-doc.limits';

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

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

    if (opts?.orgId) {
      await this._fontLoaderService.loadOrgFonts(opts.orgId);
    }
    await this._fontLoaderService.loadCuratedFonts(output.children ?? []);

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

    for (const el of output.children ?? []) {
      if (el.hidden) continue;
      try {
        await this.drawElement(ctx, el);
      } catch (err) {
        this._logger.warn(
          `Skipping element ${el?.id} (${el?.type}) during render: ${(err as Error)?.message}`
        );
      }
    }

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
        ctx.drawImage(img, 0, 0, w, h);
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

  private async drawElement(ctx: any, el: DesignerElement): Promise<void> {
    ctx.save();
    ctx.globalAlpha = el.opacity ?? 1;

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
    } else if (el.type === 'image' || el.type === 'icon') {
      await this.drawImage(ctx, el);
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
      ctx.stroke();
      return;
    }

    if (shape === 'ellipse') {
      ctx.beginPath();
      ctx.ellipse(el.width / 2, el.height / 2, el.width / 2, el.height / 2, 0, 0, Math.PI * 2);
    } else if (shape === 'star') {
      this.tracePath(ctx, this.starPoints(el.width, el.height));
    } else {
      this.traceRoundRect(ctx, 0, 0, el.width, el.height, el.borderRadius || 0);
    }

    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (el.stroke && (el.strokeWidth || 0) > 0) {
      ctx.strokeStyle = el.stroke;
      ctx.lineWidth = el.strokeWidth as number;
      ctx.stroke();
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
    const lineHeight = (el.lineHeight || 1.2) * fontSize;
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

    const lines = this.wrapLines(ctx, text, el.width, letterSpacing);
    let y = 0;
    for (const line of lines) {
      const lineWidth = this.measureLine(ctx, line, letterSpacing);
      let x = 0;
      if (align === 'center') x = (el.width - lineWidth) / 2;
      else if (align === 'right') x = el.width - lineWidth;
      this.drawTextLine(ctx, line, x, y, letterSpacing, el);
      y += lineHeight;
    }
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
    const img = await this.loadImageSafe(el.src);
    if (!img) return;

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
      // 'contain' or default — letterbox behaviour
      const crop = el.crop;
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
      this.tracePath(ctx, this.starPoints(w, h));
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

  private starPoints(w: number, h: number): Array<[number, number]> {
    const cx = w / 2, cy = h / 2;
    const outerX = w / 2, outerY = h / 2;
    const inner = 0.5;
    const points: Array<[number, number]> = [];
    for (let i = 0; i < 10; i++) {
      const angle = (Math.PI / 5) * i - Math.PI / 2;
      const rx = i % 2 === 0 ? outerX : outerX * inner;
      const ry = i % 2 === 0 ? outerY : outerY * inner;
      points.push([cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry]);
    }
    return points;
  }

  private tracePath(ctx: any, points: Array<[number, number]>): void {
    if (!points.length) return;
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
    ctx.closePath();
  }

  private measureLine(ctx: any, line: string, letterSpacing: number): number {
    if (!letterSpacing) return ctx.measureText(line).width;
    let w = 0;
    for (const ch of line) w += ctx.measureText(ch).width + letterSpacing;
    return w;
  }

  private wrapLines(ctx: any, text: string, maxWidth: number, letterSpacing: number): string[] {
    const out: string[] = [];
    for (const rawLine of text.split('\n')) {
      const words = rawLine.split(' ');
      let current = '';
      for (const word of words) {
        const candidate = current ? `${current} ${word}` : word;
        if (this.measureLine(ctx, candidate, letterSpacing) > maxWidth && current) {
          out.push(current);
          current = word;
        } else {
          current = candidate;
        }
      }
      out.push(current);
    }
    return out;
  }

  private async loadImageSafe(src?: string): Promise<any | null> {
    if (!src) return null;
    try {
      const { loadImage } = await loadCanvasModule();
      if (src.startsWith('data:')) return await loadImage(src);
      const res = await safeFetch(src);
      if (!res.ok) return null;
      const contentLength = res.headers.get('content-length');
      if (contentLength && parseInt(contentLength, 10) > MAX_IMAGE_BYTES) return null;
      const arrayBuffer = await res.arrayBuffer();
      if (arrayBuffer.byteLength > MAX_IMAGE_BYTES) return null;
      return await loadImage(Buffer.from(arrayBuffer));
    } catch (err) {
      this._logger.warn(`Failed to load image: ${(err as Error)?.message}`);
      return null;
    }
  }
}
