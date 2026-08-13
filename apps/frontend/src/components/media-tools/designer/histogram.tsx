'use client';

import React, { FC, useEffect, useRef, useState } from 'react';
import { sharedStageRef } from './stage-ref';

/**
 * The tonal distribution of what an adjustment layer is looking at.
 *
 * Levels and Curves are unusable without one — you are guessing where the black
 * point is. The counts come from a downscaled readback of the live stage, which
 * is the same composited backdrop the adjustment itself transforms, so the
 * peaks line up with the sliders sitting under them.
 */

export interface HistogramData {
  /** 256 buckets per channel, normalised 0–1 against the tallest bucket. */
  luma: number[];
  r: number[];
  g: number[];
  b: number[];
}

const EMPTY = (): number[] => new Array(256).fill(0);

export const buildHistogram = (data: Uint8ClampedArray): HistogramData => {
  const luma = EMPTY();
  const r = EMPTY();
  const g = EMPTY();
  const b = EMPTY();

  for (let i = 0; i < data.length; i += 4) {
    // Fully transparent pixels are not tone, they are absence — counting them
    // puts a spike at 0 that no adjustment can move.
    if (data[i + 3] === 0) continue;
    const rv = data[i];
    const gv = data[i + 1];
    const bv = data[i + 2];
    r[rv]++;
    g[gv]++;
    b[bv]++;
    luma[Math.min(255, Math.round(0.2126 * rv + 0.7152 * gv + 0.0722 * bv))]++;
  }

  const normalise = (bins: number[]) => {
    const peak = Math.max(...bins) || 1;
    return bins.map((n) => n / peak);
  };

  return {
    luma: normalise(luma),
    r: normalise(r),
    g: normalise(g),
    b: normalise(b),
  };
};

/**
 * Read the stage at a small fixed size. A full-resolution readback of a 4K
 * artboard is tens of megabytes for a 256-bucket answer; the shape of the
 * distribution survives the downscale.
 */
export const sampleStageHistogram = (maxSide = 240): HistogramData | null => {
  const stage = sharedStageRef.current;
  if (!stage) return null;
  try {
    const w = stage.width();
    const h = stage.height();
    if (!w || !h) return null;
    const scale = Math.min(1, maxSide / Math.max(w, h));
    const canvas = stage.toCanvas({ pixelRatio: scale });
    const ctx = (canvas as HTMLCanvasElement).getContext('2d');
    if (!ctx) return null;
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return buildHistogram(image.data);
  } catch {
    // A tainted canvas (a cross-origin image without CORS) throws here. No
    // histogram is better than no inspector.
    return null;
  }
};

interface HistogramProps {
  /** Bumped by the caller to force a re-sample — e.g. the document version. */
  nonce?: unknown;
  channel?: 'luma' | 'r' | 'g' | 'b';
  height?: number;
  className?: string;
}

const STROKE: Record<string, string> = {
  luma: 'rgba(148,163,184,0.85)',
  r: 'rgba(248,113,113,0.85)',
  g: 'rgba(74,222,128,0.85)',
  b: 'rgba(96,165,250,0.85)',
};

export const Histogram: FC<HistogramProps> = ({
  nonce,
  channel = 'luma',
  height = 56,
  className,
}) => {
  const [data, setData] = useState<HistogramData | null>(null);
  const frame = useRef<number>(0);

  useEffect(() => {
    // One frame of slack lets the stage finish drawing the change that
    // triggered this before it is read back.
    frame.current = requestAnimationFrame(() => setData(sampleStageHistogram()));
    return () => cancelAnimationFrame(frame.current);
  }, [nonce, channel]);

  const bins = data?.[channel];

  return (
    <div
      className={`relative rounded-[4px] bg-newBgColor border border-studioBorder overflow-hidden ${className || ''}`}
      style={{ height }}
      data-testid="histogram"
      aria-hidden
    >
      {bins ? (
        <svg
          viewBox={`0 0 256 ${height}`}
          preserveAspectRatio="none"
          className="w-full h-full"
        >
          <path
            d={
              `M0,${height} ` +
              bins.map((v, i) => `L${i},${height - v * (height - 2)}`).join(' ') +
              ` L255,${height} Z`
            }
            fill={STROKE[channel]}
            fillOpacity={0.35}
            stroke={STROKE[channel]}
            strokeWidth={0.6}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      ) : null}
    </div>
  );
};
