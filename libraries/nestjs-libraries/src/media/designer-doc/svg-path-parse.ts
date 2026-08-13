/**
 * SVG path data (`d`) → editable `DesignerPathNode[]`.
 *
 * The Designer could TRACE a path and EXPORT one, and could not ingest one:
 * there was no `d` parser anywhere in the repo (the only other SVG path code
 * flattens to sample points for text-on-path, which throws the control points
 * away and is useless for editing). That single gap is why SVG import produced
 * a bitmap, why the Custom Shape tool drew a rounded rectangle and reported "no
 * options", and why nothing could round-trip its own SVG export.
 *
 * The node model is cubic-only, which is the same model the Pen tool writes:
 * every anchor carries an optional in/out control point. So quadratics are
 * elevated to cubics and arcs are converted to cubics here, once, rather than
 * teaching four renderers three curve types.
 */

import type { DesignerPathNode } from './path-geometry';

export interface ParsedSubpath {
  nodes: DesignerPathNode[];
  closed: boolean;
}

/** One command: a letter and its already-parsed numbers. */
interface Command {
  code: string;
  args: number[];
}

const ARG_COUNT: Record<string, number> = {
  M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0,
};

/**
 * Tokenise `d`.
 *
 * SVG's grammar is deliberately permissive — `M0,0L1 1` and `M 0 0 L 1 1` are
 * the same path, exponents are legal, and a repeated argument list implies a
 * repeat of the command (with `M` implying `L`). Getting this wrong on real
 * files is the difference between importing an icon and importing nothing.
 */
const tokenize = (d: string): Command[] => {
  const commands: Command[] = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?)/g;
  let match: RegExpExecArray | null;
  let code: string | null = null;
  let args: number[] = [];

  const flush = (): void => {
    if (!code) return;
    const need = ARG_COUNT[code.toUpperCase()];
    if (need === 0) {
      commands.push({ code, args: [] });
      return;
    }
    // A repeated argument list repeats the command; a second `M` list is `L`.
    let first = true;
    while (args.length >= need) {
      const chunk = args.splice(0, need);
      const effective = first || code.toUpperCase() !== 'M'
        ? code
        : code === 'M' ? 'L' : 'l';
      commands.push({ code: effective, args: chunk });
      first = false;
    }
  };

  while ((match = re.exec(d)) !== null) {
    if (match[1]) {
      flush();
      code = match[1];
      args = [];
      if (ARG_COUNT[code.toUpperCase()] === 0) flush();
    } else if (code) {
      args.push(parseFloat(match[2]));
    }
  }
  flush();
  return commands;
};

/**
 * An elliptical arc as up to four cubic segments.
 *
 * Straight out of the SVG implementation notes (F.6.5), which is the only way
 * to get this right — the endpoint parameterisation the `A` command uses has to
 * be converted to a centre parameterisation first, including the radii
 * correction for an arc too small to span its endpoints.
 */
const arcToCubics = (
  x1: number,
  y1: number,
  rx: number,
  ry: number,
  angleDeg: number,
  largeArc: boolean,
  sweep: boolean,
  x2: number,
  y2: number
): { c1x: number; c1y: number; c2x: number; c2y: number; x: number; y: number }[] => {
  if (x1 === x2 && y1 === y2) return [];
  // Zero radii mean a straight line, per the spec.
  if (!rx || !ry) return [{ c1x: x1, c1y: y1, c2x: x2, c2y: y2, x: x2, y: y2 }];

  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const phi = (angleDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cosPhi * dx + sinPhi * dy;
  const y1p = -sinPhi * dx + cosPhi * dy;

  // Scale the radii up if they are too small to reach across the chord.
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }

  const sign = largeArc === sweep ? -1 : 1;
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const co = sign * Math.sqrt(Math.max(0, num / den));
  const cxp = (co * rx * y1p) / ry;
  const cyp = (-co * ry * x1p) / rx;

  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;

  const angle = (ux: number, uy: number, vx: number, vy: number): number => {
    const dot = ux * vx + uy * vy;
    const len = Math.sqrt(ux * ux + uy * uy) * Math.sqrt(vx * vx + vy * vy);
    const a = Math.acos(Math.min(1, Math.max(-1, dot / (len || 1))));
    return ux * vy - uy * vx < 0 ? -a : a;
  };

  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let delta = angle(
    (x1p - cxp) / rx,
    (y1p - cyp) / ry,
    (-x1p - cxp) / rx,
    (-y1p - cyp) / ry
  );
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;

  // A cubic approximates a circular arc well only up to ~90°.
  const segments = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2)));
  const step = delta / segments;
  const k = (4 / 3) * Math.tan(step / 4);

  const out: ReturnType<typeof arcToCubics> = [];
  let theta = theta1;
  let px = x1;
  let py = y1;
  for (let i = 0; i < segments; i++) {
    const next = theta + step;
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    const cosN = Math.cos(next);
    const sinN = Math.sin(next);

    const point = (c: number, s: number) => ({
      x: cx + cosPhi * rx * c - sinPhi * ry * s,
      y: cy + sinPhi * rx * c + cosPhi * ry * s,
    });
    const derivative = (c: number, s: number) => ({
      x: -cosPhi * rx * s - sinPhi * ry * c,
      y: -sinPhi * rx * s + cosPhi * ry * c,
    });

    const end = point(cosN, sinN);
    const d1 = derivative(cosT, sinT);
    const d2 = derivative(cosN, sinN);

    out.push({
      c1x: px + k * d1.x,
      c1y: py + k * d1.y,
      c2x: end.x - k * d2.x,
      c2y: end.y - k * d2.y,
      x: end.x,
      y: end.y,
    });

    theta = next;
    px = end.x;
    py = end.y;
  }
  return out;
};

/**
 * Parse `d` into subpaths of editable nodes.
 *
 * Returns one entry per `M`, because a real icon is usually several subpaths
 * (a letter with a counter, a ring, a plus sign) and the Designer's `path`
 * element holds ONE contour — the caller decides whether to make several
 * elements or keep only the largest.
 */
export const parseSvgPathData = (d: string): ParsedSubpath[] => {
  const commands = tokenize(d || '');
  const subpaths: ParsedSubpath[] = [];
  let current: ParsedSubpath | null = null;

  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  // Reflection point for S/T, which mirror the PREVIOUS command's control point.
  let lastControl: { x: number; y: number } | null = null;
  let lastCode = '';

  const anchor = (nx: number, ny: number): DesignerPathNode => ({ x: nx, y: ny });

  /** Record a cubic segment: the outgoing handle goes on the previous node. */
  const cubic = (c1x: number, c1y: number, c2x: number, c2y: number, nx: number, ny: number) => {
    if (!current) return;
    const previous = current.nodes[current.nodes.length - 1];
    if (previous) {
      previous.outX = c1x;
      previous.outY = c1y;
    }
    current.nodes.push({ x: nx, y: ny, inX: c2x, inY: c2y });
  };

  for (const { code, args } of commands) {
    const upper = code.toUpperCase();
    const relative = code !== upper;

    switch (upper) {
      case 'M': {
        const nx = relative ? x + args[0] : args[0];
        const ny = relative ? y + args[1] : args[1];
        current = { nodes: [anchor(nx, ny)], closed: false };
        subpaths.push(current);
        x = startX = nx;
        y = startY = ny;
        lastControl = null;
        break;
      }
      case 'L':
      case 'H':
      case 'V': {
        if (!current) break;
        const nx =
          upper === 'V' ? x : relative ? x + args[0] : args[0];
        const ny =
          upper === 'H' ? y : relative ? y + args[upper === 'V' ? 0 : 1] : args[upper === 'V' ? 0 : 1];
        current.nodes.push(anchor(nx, ny));
        x = nx;
        y = ny;
        lastControl = null;
        break;
      }
      case 'C': {
        if (!current) break;
        const [a1, a2, a3, a4, a5, a6] = args;
        const c1x = relative ? x + a1 : a1;
        const c1y = relative ? y + a2 : a2;
        const c2x = relative ? x + a3 : a3;
        const c2y = relative ? y + a4 : a4;
        const nx = relative ? x + a5 : a5;
        const ny = relative ? y + a6 : a6;
        cubic(c1x, c1y, c2x, c2y, nx, ny);
        lastControl = { x: c2x, y: c2y };
        x = nx;
        y = ny;
        break;
      }
      case 'S': {
        if (!current) break;
        const [a1, a2, a3, a4] = args;
        // The first control mirrors the previous one, or sits on the anchor
        // when the previous command wasn't a cubic.
        const mirrored = 'CS'.includes(lastCode.toUpperCase()) && lastControl
          ? { x: 2 * x - lastControl.x, y: 2 * y - lastControl.y }
          : { x, y };
        const c2x = relative ? x + a1 : a1;
        const c2y = relative ? y + a2 : a2;
        const nx = relative ? x + a3 : a3;
        const ny = relative ? y + a4 : a4;
        cubic(mirrored.x, mirrored.y, c2x, c2y, nx, ny);
        lastControl = { x: c2x, y: c2y };
        x = nx;
        y = ny;
        break;
      }
      case 'Q':
      case 'T': {
        if (!current) break;
        let qx: number;
        let qy: number;
        let nx: number;
        let ny: number;
        if (upper === 'Q') {
          qx = relative ? x + args[0] : args[0];
          qy = relative ? y + args[1] : args[1];
          nx = relative ? x + args[2] : args[2];
          ny = relative ? y + args[3] : args[3];
        } else {
          const mirrored = 'QT'.includes(lastCode.toUpperCase()) && lastControl
            ? { x: 2 * x - lastControl.x, y: 2 * y - lastControl.y }
            : { x, y };
          qx = mirrored.x;
          qy = mirrored.y;
          nx = relative ? x + args[0] : args[0];
          ny = relative ? y + args[1] : args[1];
        }
        // Quadratic elevated to cubic: the node model has one curve type.
        cubic(
          x + (2 / 3) * (qx - x),
          y + (2 / 3) * (qy - y),
          nx + (2 / 3) * (qx - nx),
          ny + (2 / 3) * (qy - ny),
          nx,
          ny
        );
        lastControl = { x: qx, y: qy };
        x = nx;
        y = ny;
        break;
      }
      case 'A': {
        if (!current) break;
        const [rx, ry, rot, large, sweep, ax, ay] = args;
        const nx = relative ? x + ax : ax;
        const ny = relative ? y + ay : ay;
        for (const seg of arcToCubics(x, y, rx, ry, rot, !!large, !!sweep, nx, ny)) {
          cubic(seg.c1x, seg.c1y, seg.c2x, seg.c2y, seg.x, seg.y);
        }
        x = nx;
        y = ny;
        lastControl = null;
        break;
      }
      case 'Z': {
        if (!current) break;
        current.closed = true;
        x = startX;
        y = startY;
        lastControl = null;
        break;
      }
    }
    lastCode = code;
  }

  // A `Z` back onto the start anchor leaves a duplicate node; the renderers
  // close the contour themselves, so drop it.
  for (const subpath of subpaths) {
    const nodes = subpath.nodes;
    if (subpath.closed && nodes.length > 1) {
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (Math.abs(first.x - last.x) < 1e-6 && Math.abs(first.y - last.y) < 1e-6) {
        if (last.inX !== undefined) {
          first.inX = last.inX;
          first.inY = last.inY;
        }
        nodes.pop();
      }
    }
  }

  return subpaths.filter((s) => s.nodes.length > 1);
};
