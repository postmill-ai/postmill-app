'use client';

import React, { FC, useCallback, useMemo, useRef, useState } from 'react';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { curveLut } from '@postmill-ai/nestjs-libraries/media/designer-doc/pixel-ops';
import {
  CURVE_CHANNELS,
  IDENTITY_CURVE,
  type CurveChannel,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/adjustment-descriptors';
import { Histogram } from './histogram';

/**
 * Photoshop's Curves, drawn from the same LUT the renderers use.
 *
 * The plotted line is `curveLut` evaluated at all 256 levels rather than a
 * lookalike bezier, so what you see is precisely what the pixels get — a
 * separate drawing path is a divergence waiting to happen.
 */

export type CurvePoint = { x: number; y: number };

const MAX_POINTS = 32; // The schema's own cap.
const HIT_RADIUS = 10; // In curve units (0–255).

const sorted = (points: CurvePoint[]) => [...points].sort((a, b) => a.x - b.x);

const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));

/** The nearest point to (x, y), or -1 when nothing is within grabbing range. */
export const findPoint = (points: CurvePoint[], x: number, y: number): number => {
  let best = -1;
  let bestDist = HIT_RADIUS;
  points.forEach((p, i) => {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return best;
};

/**
 * Add a control point, keeping the list sorted and unique in x.
 *
 * Two points at the same x make the curve vertical, which the LUT resolves by
 * taking whichever it walked to first — so the click is ignored instead.
 */
export const addPoint = (points: CurvePoint[], x: number, y: number): CurvePoint[] => {
  const px = clamp(Math.round(x), 0, 255);
  const py = clamp(Math.round(y), 0, 255);
  if (points.length >= MAX_POINTS) return points;
  if (points.some((p) => Math.abs(p.x - px) < 1)) return points;
  return sorted([...points, { x: px, y: py }]);
};

/**
 * Move a control point. The two endpoints keep their x — dragging the black
 * point sideways is Levels' job, not Curves'. Interior points cannot cross
 * their neighbours, which is what would otherwise produce a vertical segment.
 */
export const movePoint = (
  points: CurvePoint[],
  index: number,
  x: number,
  y: number
): CurvePoint[] => {
  if (index < 0 || index >= points.length) return points;
  const list = sorted(points);
  const isEnd = index === 0 || index === list.length - 1;
  const lower = index > 0 ? list[index - 1].x + 1 : 0;
  const upper = index < list.length - 1 ? list[index + 1].x - 1 : 255;
  const next = [...list];
  next[index] = {
    x: isEnd ? list[index].x : clamp(Math.round(x), lower, upper),
    y: clamp(Math.round(y), 0, 255),
  };
  return next;
};

/** Remove a control point. The two endpoints are permanent. */
export const removePoint = (points: CurvePoint[], index: number): CurvePoint[] => {
  const list = sorted(points);
  if (index <= 0 || index >= list.length - 1) return list;
  return list.filter((_, i) => i !== index);
};

interface CurvesEditorProps {
  curves: Record<string, CurvePoint[]> | undefined;
  onChange: (curves: Record<string, CurvePoint[]>) => void;
  /** Called once when a drag ends, so one history entry covers the whole drag. */
  onCommit?: () => void;
  /** Changes whenever the document does, to re-sample the histogram. */
  nonce?: unknown;
}

const SIZE = 256;

export const CurvesEditor: FC<CurvesEditorProps> = ({
  curves,
  onChange,
  onCommit,
  nonce,
}) => {
  const t = useT();
  const [channel, setChannel] = useState<CurveChannel>('rgb');
  const [dragging, setDragging] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const points = useMemo(
    () => sorted(curves?.[channel]?.length ? curves[channel] : IDENTITY_CURVE),
    [curves, channel]
  );

  const path = useMemo(() => {
    const lut = curveLut(points);
    let d = `M0,${SIZE - lut[0]}`;
    for (let x = 1; x < 256; x++) d += ` L${x},${SIZE - lut[x]}`;
    return d;
  }, [points]);

  const write = useCallback(
    (next: CurvePoint[]) => onChange({ ...(curves || {}), [channel]: next }),
    [curves, channel, onChange]
  );

  /** Pointer position in curve units, y flipped so up is brighter. */
  const toCurve = (e: React.PointerEvent | React.MouseEvent) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: ((e.clientX - rect.left) / rect.width) * 255,
      y: 255 - ((e.clientY - rect.top) / rect.height) * 255,
    };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const { x, y } = toCurve(e);
    const hit = findPoint(points, x, y);
    if (hit >= 0) {
      setDragging(hit);
      (e.target as Element).setPointerCapture?.(e.pointerId);
      return;
    }
    const next = addPoint(points, x, y);
    if (next !== points) {
      write(next);
      setDragging(next.findIndex((p) => Math.abs(p.x - Math.round(x)) < 1));
      (e.target as Element).setPointerCapture?.(e.pointerId);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (dragging === null) return;
    const { x, y } = toCurve(e);
    write(movePoint(points, dragging, x, y));
  };

  const endDrag = () => {
    if (dragging === null) return;
    setDragging(null);
    onCommit?.();
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1">
        {CURVE_CHANNELS.map((ch) => (
          <button
            key={ch}
            type="button"
            onClick={() => setChannel(ch)}
            aria-pressed={channel === ch}
            className={`px-2 h-[22px] rounded text-[11px] uppercase ${
              channel === ch
                ? 'bg-designerAccent text-white'
                : 'text-textColor/60 hover:bg-boxHover'
            }`}
          >
            {ch}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            write(IDENTITY_CURVE.map((p) => ({ ...p })));
            onCommit?.();
          }}
          className="ml-auto px-2 h-[22px] rounded-sm text-[11px] text-textColor/60 hover:bg-boxHover"
        >
          {t('designer_curves_reset', 'Reset')}
        </button>
      </div>

      <div className="relative">
        {/* The master curve reads the composite, so it shows luminance. */}
        <Histogram
          nonce={nonce}
          channel={channel === 'rgb' ? 'luma' : channel}
          height={SIZE}
          className="rounded-[6px]!"
        />
        <svg
          ref={svgRef}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          preserveAspectRatio="none"
          className="absolute inset-0 w-full h-full touch-none cursor-crosshair"
          role="application"
          aria-label={t('designer_curves_editor', 'Curves editor')}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerLeave={endDrag}
          onContextMenu={(e) => {
            e.preventDefault();
            const { x, y } = toCurve(e);
            const hit = findPoint(points, x, y);
            if (hit >= 0) {
              write(removePoint(points, hit));
              onCommit?.();
            }
          }}
        >
          {[64, 128, 192].map((g) => (
            <g key={g} stroke="currentColor" className="text-studioBorder" strokeWidth={0.5}>
              <line x1={g} y1={0} x2={g} y2={SIZE} />
              <line x1={0} y1={g} x2={SIZE} y2={g} />
            </g>
          ))}
          <line
            x1={0}
            y1={SIZE}
            x2={SIZE}
            y2={0}
            stroke="currentColor"
            className="text-textColor/20"
            strokeDasharray="4 4"
            strokeWidth={0.8}
          />
          <path
            d={path}
            fill="none"
            stroke="currentColor"
            className="text-btnPrimaryAccent"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
          {points.map((p, i) => (
            <circle
              key={`${p.x}-${i}`}
              cx={p.x}
              cy={SIZE - p.y}
              r={4}
              className="fill-designerAccent stroke-white"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
              data-testid="curve-point"
            />
          ))}
        </svg>
      </div>

      <p className="text-[10px] text-textColor/40">
        {t(
          'designer_curves_hint',
          'Click to add a point, drag to shape, right-click a point to remove it.'
        )}
      </p>
    </div>
  );
};
