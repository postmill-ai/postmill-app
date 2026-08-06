'use client';

import React, { FC, useEffect, useRef } from 'react';

export const RULER_SIZE = 20;

// Pick a "nice" major-tick interval (1/2/5 × 10ⁿ doc px) so labels stay ~70px
// apart on screen regardless of zoom.
const niceStep = (zoom: number) => {
  const target = 70 / zoom;
  const pow = Math.pow(10, Math.floor(Math.log10(target)));
  const base = target / pow;
  const mult = base > 5 ? 10 : base > 2 ? 5 : base > 1 ? 2 : 1;
  return mult * pow;
};

const drawRuler = (
  canvas: HTMLCanvasElement,
  axis: 'x' | 'y',
  zoom: number,
  offset: number, // viewportX (x) or viewportY (y)
  lengthCss: number
) => {
  const dpr = window.devicePixelRatio || 1;
  const breadth = RULER_SIZE;
  canvas.width = (axis === 'x' ? lengthCss : breadth) * dpr;
  canvas.height = (axis === 'x' ? breadth : lengthCss) * dpr;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const W = axis === 'x' ? lengthCss : breadth;
  const H = axis === 'x' ? breadth : lengthCss;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#f3f4f6';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#d1d5db';
  ctx.lineWidth = 1;
  ctx.beginPath();
  // inner edge line
  if (axis === 'x') {
    ctx.moveTo(0, breadth - 0.5);
    ctx.lineTo(W, breadth - 0.5);
  } else {
    ctx.moveTo(breadth - 0.5, 0);
    ctx.lineTo(breadth - 0.5, H);
  }
  ctx.stroke();

  const major = niceStep(zoom);
  const minor = major / 5;
  const span = axis === 'x' ? lengthCss : lengthCss;
  const startIdx = Math.floor((-offset / zoom) / minor);
  const endIdx = Math.ceil((span - offset) / zoom / minor);

  ctx.fillStyle = '#6b7280';
  ctx.font = '9px ui-sans-serif, system-ui, sans-serif';
  ctx.textBaseline = 'middle';

  for (let i = startIdx; i <= endIdx; i++) {
    const d = i * minor;
    const p = offset + d * zoom; // screen position along the axis
    const isMajor = i % 5 === 0;
    const tick = isMajor ? breadth * 0.55 : breadth * 0.3;
    ctx.strokeStyle = isMajor ? '#9ca3af' : '#cbd5e1';
    ctx.beginPath();
    if (axis === 'x') {
      ctx.moveTo(Math.round(p) + 0.5, breadth);
      ctx.lineTo(Math.round(p) + 0.5, breadth - tick);
    } else {
      ctx.moveTo(breadth, Math.round(p) + 0.5);
      ctx.lineTo(breadth - tick, Math.round(p) + 0.5);
    }
    ctx.stroke();
    if (isMajor) {
      const label = String(Math.round(d));
      if (axis === 'x') {
        ctx.textAlign = 'left';
        ctx.fillText(label, Math.round(p) + 3, breadth * 0.34);
      } else {
        ctx.save();
        ctx.translate(breadth * 0.34, Math.round(p) + 3);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'right';
        ctx.fillText(label, 0, 0);
        ctx.restore();
      }
    }
  }
};

interface RulersProps {
  zoom: number;
  viewportX: number;
  viewportY: number;
  width: number; // container width (css px)
  height: number; // container height (css px)
  /**
   * Pull a guide out of a ruler. Given, the rulers stop being decoration and
   * become the guide source they look like — until now you could read a
   * measurement off them and nothing else.
   */
  onDragOutGuide?: (axis: 'x' | 'y', position: number) => void;
}

// Top + left measurement rulers that track pan/zoom, mapping screen ↔ document
// pixels. Doc coordinate 0 is the artboard's top-left corner; negatives show
// off-artboard space. Purely visual (pointer-events: none) — overlays the stage.
export const Rulers: FC<RulersProps> = ({
  zoom,
  viewportX,
  viewportY,
  width,
  height,
  onDragOutGuide,
}) => {
  const topRef = useRef<HTMLCanvasElement>(null);
  const leftRef = useRef<HTMLCanvasElement>(null);

  /**
   * A press on a ruler drops a guide at that document coordinate; dragging
   * before release moves it, and the store keeps the last position.
   *
   * `axis` is the guide's own axis: the TOP ruler makes vertical guides, which
   * are constrained in x.
   */
  const startGuide = (axis: 'x' | 'y') => (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!onDragOutGuide) return;
    e.preventDefault();
    const canvas = e.currentTarget;
    canvas.setPointerCapture?.(e.pointerId);
    const rect = canvas.getBoundingClientRect();
    const at = (ev: { clientX: number; clientY: number }) =>
      axis === 'x'
        ? (ev.clientX - rect.left - viewportX) / zoom
        : (ev.clientY - rect.top - viewportY) / zoom;
    let position = at(e);
    const move = (ev: PointerEvent) => {
      position = at(ev);
    };
    const teardown = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
    };
    const up = () => {
      teardown();
      onDragOutGuide(axis, Math.round(position));
    };
    // A cancelled pointer (touch stolen by the OS, pen out of range) never
    // fires pointerup — without this the window listeners stayed attached.
    const cancel = () => teardown();
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  };

  useEffect(() => {
    if (topRef.current && width > 0) drawRuler(topRef.current, 'x', zoom, viewportX, width);
  }, [zoom, viewportX, width]);

  useEffect(() => {
    if (leftRef.current && height > 0) drawRuler(leftRef.current, 'y', zoom, viewportY, height);
  }, [zoom, viewportY, height]);

  return (
    <div className="absolute inset-0 pointer-events-none z-10">
      <canvas
        ref={topRef}
        onPointerDown={startGuide('x')}
        className={`absolute top-0 left-0 ${onDragOutGuide ? 'pointer-events-auto cursor-ew-resize' : ''}`}
        style={{ width, height: RULER_SIZE }}
      />
      <canvas
        ref={leftRef}
        onPointerDown={startGuide('y')}
        className={`absolute top-0 left-0 ${onDragOutGuide ? 'pointer-events-auto cursor-ns-resize' : ''}`}
        style={{ width: RULER_SIZE, height }}
      />
      {/* corner square hides the overlap */}
      <div
        className="absolute top-0 left-0 bg-[#e5e7eb] border-r border-b border-[#d1d5db]"
        style={{ width: RULER_SIZE, height: RULER_SIZE }}
      />
    </div>
  );
};
