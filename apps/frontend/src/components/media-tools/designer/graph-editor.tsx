'use client';

import React, { FC, useMemo, useRef, useState } from 'react';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import {
  DEFAULT_IN_HANDLE,
  DEFAULT_OUT_HANDLE,
  interpolateClipKeyframes,
  type EaseHandles,
  type Keyframe,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/keyframes';
import type { VideoClip } from './designer.store';

/**
 * After Effects' graph editor: each animated property as a curve, with the
 * bezier handles that shape it.
 *
 * The plotted curve is `interpolateClipKeyframes` sampled across the clip —
 * the same function playback and the frame renderer call — so the line you drag
 * is the motion you get rather than an illustration of it.
 */

export const GRAPH_PROPS = ['x', 'y', 'width', 'height', 'rotation', 'opacity'] as const;
export type GraphProp = (typeof GRAPH_PROPS)[number];

/** Which properties this clip actually animates. Nothing else is worth a curve. */
export const animatedProps = (keyframes: Keyframe[] | undefined): GraphProp[] =>
  GRAPH_PROPS.filter((p) =>
    (keyframes || []).some((kf) => (kf.props as Record<string, number>)[p] !== undefined)
  );

/**
 * The value range a property's curve is drawn against, padded so a flat curve
 * sits in the middle of the plot instead of on its floor.
 */
export const graphRange = (
  clip: VideoClip,
  prop: GraphProp
): { min: number; max: number } => {
  const values = (clip.keyframes || [])
    .map((kf) => (kf.props as Record<string, number>)[prop])
    .filter((v): v is number => typeof v === 'number');
  if (!values.length) return { min: 0, max: 1 };
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (max - min < 1e-6) {
    const pad = Math.max(1, Math.abs(max) * 0.1);
    min -= pad;
    max += pad;
  }
  const margin = (max - min) * 0.1;
  return { min: min - margin, max: max + margin };
};

/** Sample the real interpolation across the clip, for plotting. */
export const graphSamples = (
  clip: VideoClip,
  prop: GraphProp,
  totalMs: number,
  count = 120
): number[] => {
  const out: number[] = [];
  for (let i = 0; i <= count; i++) {
    const ms = (i / count) * totalMs;
    out.push(interpolateClipKeyframes(clip as never, ms)[prop]);
  }
  return out;
};

/** Write one bezier handle onto one keyframe, preserving the other side. */
export const setEaseHandle = (
  keyframes: Keyframe[],
  index: number,
  which: 'in' | 'out',
  handle: [number, number]
): Keyframe[] =>
  keyframes.map((kf, i) => {
    if (i !== index) return kf;
    // A preset name and handles cannot coexist — handles win once dragged, and
    // keeping the string would leave the stored ease ambiguous.
    const existing: EaseHandles =
      kf.ease && typeof kf.ease === 'object' ? kf.ease : {};
    return { ...kf, ease: { ...existing, [which]: handle } };
  });

/** Reset a keyframe to linear, discarding any handles it carries. */
export const clearEaseHandles = (keyframes: Keyframe[], index: number): Keyframe[] =>
  keyframes.map((kf, i) => (i === index ? { ...kf, ease: 'linear' } : kf));

/**
 * A handle's absolute position on the plot.
 *
 * Handles are stored in normalised SEGMENT space (0–1 across the gap to the
 * neighbour), so they survive a keyframe being dragged along the timeline —
 * storing pixels would silently reshape the curve every time.
 */
export const handlePosition = (
  keyframes: Keyframe[],
  index: number,
  which: 'in' | 'out',
  prop: GraphProp
): { tMs: number; value: number } | null => {
  const sorted = [...keyframes].sort((a, b) => a.tMs - b.tMs);
  const kf = sorted[index];
  if (!kf) return null;
  const neighbour = which === 'out' ? sorted[index + 1] : sorted[index - 1];
  if (!neighbour) return null;

  const own = (kf.props as Record<string, number>)[prop];
  const other = (neighbour.props as Record<string, number>)[prop];
  if (own === undefined || other === undefined) return null;

  const stored: EaseHandles = kf.ease && typeof kf.ease === 'object' ? kf.ease : {};
  const h =
    which === 'out'
      ? stored.out || DEFAULT_OUT_HANDLE
      : // An incoming handle is measured from the segment's START, so it reads
        // backwards from this keyframe.
        stored.in || DEFAULT_IN_HANDLE;

  const spanMs = neighbour.tMs - kf.tMs;
  const spanValue = other - own;
  const fraction = which === 'out' ? h[0] : 1 - h[0];
  const valueFraction = which === 'out' ? h[1] : 1 - h[1];

  return {
    tMs: kf.tMs + spanMs * fraction,
    value: own + spanValue * valueFraction,
  };
};

interface GraphEditorProps {
  clip: VideoClip;
  totalMs: number;
  onChange: (keyframes: Keyframe[]) => void;
  onCommit?: () => void;
}

const H = 160;
const W = 480;

export const GraphEditor: FC<GraphEditorProps> = ({
  clip,
  totalMs,
  onChange,
  onCommit,
}) => {
  const t = useT();
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<
    { index: number; which: 'in' | 'out' } | null
  >(null);

  const keyframes = useMemo(
    () => [...(clip.keyframes || [])].sort((a, b) => a.tMs - b.tMs) as Keyframe[],
    [clip.keyframes]
  );
  const props = useMemo(() => animatedProps(keyframes), [keyframes]);
  const [prop, setProp] = useState<GraphProp>(props[0] || 'opacity');
  const active = props.includes(prop) ? prop : props[0];

  const range = useMemo(
    () => (active ? graphRange(clip, active) : { min: 0, max: 1 }),
    [clip, active]
  );

  const toX = (ms: number) => (totalMs > 0 ? (ms / totalMs) * W : 0);
  const toY = (v: number) =>
    H - ((v - range.min) / Math.max(1e-6, range.max - range.min)) * H;

  const path = useMemo(() => {
    if (!active) return '';
    // Inlined from `toY` so the dependency list is complete without a disable.
    const y = (v: number) =>
      H - ((v - range.min) / Math.max(1e-6, range.max - range.min)) * H;
    const samples = graphSamples(clip, active, totalMs);
    return samples
      .map((v, i) => `${i === 0 ? 'M' : 'L'}${(i / (samples.length - 1)) * W},${y(v)}`)
      .join(' ');
  }, [clip, active, totalMs, range.min, range.max]);

  if (!active) {
    return (
      <p className="text-[11px] text-textColor/40 p-3">
        {t(
          'designer_graph_no_keyframes',
          'Add keyframes to a property to shape its curve here.'
        )}
      </p>
    );
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const ms = ((e.clientX - rect.left) / rect.width) * totalMs;
    const value =
      range.max - ((e.clientY - rect.top) / rect.height) * (range.max - range.min);

    const kf = keyframes[drag.index];
    const neighbour =
      drag.which === 'out' ? keyframes[drag.index + 1] : keyframes[drag.index - 1];
    if (!kf || !neighbour) return;

    const spanMs = neighbour.tMs - kf.tMs;
    const own = (kf.props as Record<string, number>)[active];
    const other = (neighbour.props as Record<string, number>)[active];
    if (!spanMs || own === undefined || other === undefined) return;

    const rawX = (ms - kf.tMs) / spanMs;
    const rawY = other - own === 0 ? 0.5 : (value - own) / (other - own);
    // Clamped to the segment: a handle outside it makes time run backwards.
    const x = Math.max(0, Math.min(1, drag.which === 'out' ? rawX : 1 - rawX));
    const y = drag.which === 'out' ? rawY : 1 - rawY;

    onChange(setEaseHandle(keyframes, drag.index, drag.which, [x, y]));
  };

  return (
    <div className="p-2 space-y-2" data-testid="graph-editor">
      <div className="flex items-center gap-1">
        {props.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setProp(p)}
            aria-pressed={active === p}
            className={`px-2 h-[20px] rounded text-[10px] capitalize ${
              active === p
                ? 'bg-designerAccent text-white'
                : 'text-textColor/60 hover:bg-boxHover'
            }`}
          >
            {p}
          </button>
        ))}
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="w-full h-[160px] rounded-sm border border-studioBorder bg-newBgColor touch-none"
        role="application"
        aria-label={t('designer_graph_editor', 'Keyframe graph editor')}
        onPointerMove={onPointerMove}
        onPointerUp={() => {
          if (!drag) return;
          setDrag(null);
          onCommit?.();
        }}
        onPointerLeave={() => {
          if (!drag) return;
          setDrag(null);
          onCommit?.();
        }}
      >
        <path
          d={path}
          fill="none"
          stroke="currentColor"
          className="text-btnPrimaryAccent"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />

        {keyframes.map((kf, i) => {
          const value = (kf.props as Record<string, number>)[active];
          if (value === undefined) return null;
          return (
            <g key={`${kf.tMs}-${i}`}>
              {(['in', 'out'] as const).map((which) => {
                const pos = handlePosition(keyframes, i, which, active);
                if (!pos) return null;
                return (
                  <g key={which}>
                    <line
                      x1={toX(kf.tMs)}
                      y1={toY(value)}
                      x2={toX(pos.tMs)}
                      y2={toY(pos.value)}
                      stroke="currentColor"
                      className="text-textColor/30"
                      strokeWidth={1}
                      vectorEffect="non-scaling-stroke"
                    />
                    <circle
                      cx={toX(pos.tMs)}
                      cy={toY(pos.value)}
                      r={4}
                      data-testid={`handle-${which}-${i}`}
                      className="fill-newBgColor stroke-designerAccent cursor-grab"
                      strokeWidth={1.5}
                      vectorEffect="non-scaling-stroke"
                      onPointerDown={(e) => {
                        (e.target as Element).setPointerCapture?.(e.pointerId);
                        setDrag({ index: i, which });
                      }}
                    />
                  </g>
                );
              })}
              <circle
                cx={toX(kf.tMs)}
                cy={toY(value)}
                r={4.5}
                data-testid={`keyframe-${i}`}
                className="fill-designerAccent stroke-white"
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
                onDoubleClick={() => {
                  onChange(clearEaseHandles(keyframes, i));
                  onCommit?.();
                }}
              />
            </g>
          );
        })}
      </svg>

      <p className="text-[10px] text-textColor/40">
        {t(
          'designer_graph_hint',
          'Drag a handle to shape the easing. Double-click a keyframe to make it linear.'
        )}
      </p>
    </div>
  );
};
