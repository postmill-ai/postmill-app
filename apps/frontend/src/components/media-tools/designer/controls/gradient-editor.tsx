'use client';

import React, { FC, useCallback, useRef } from 'react';
import { ColorSwatch, SegmentedControl, Slider } from './index';
import type { DesignerGradient } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.schema';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';

/**
 * The gradient editor.
 *
 * The schema has always allowed `stops: {offset, color}[]` of any length, and
 * **nothing in the product could author more than two**: the Gradient tool
 * hardcoded `[fill, #FFFFFF]`, the canvas background offered start/end/angle,
 * `defaultStyle` seeded two. A three-stop ramp was expressible, storable and
 * renderable, and unreachable.
 *
 * One editor, mounted everywhere a gradient exists, so a ramp authored on a
 * shape behaves the same as one on the page background or in a Gradient
 * Overlay.
 */

const DEFAULT_GRADIENT: DesignerGradient = {
  type: 'linear',
  angle: 0,
  stops: [
    { offset: 0, color: '#2B5CD3' },
    { offset: 1, color: '#FFFFFF' },
  ],
};

/** CSS for the preview strip — the same ramp, drawn by the browser. */
export const gradientCss = (g: DesignerGradient): string => {
  const stops = [...(g.stops || [])]
    .sort((a, b) => a.offset - b.offset)
    .map((s) => `${s.color} ${Math.round(s.offset * 100)}%`)
    .join(', ');
  if (!stops) return 'transparent';
  return g.type === 'radial'
    ? `radial-gradient(circle at ${Math.round((g.focalX ?? 0.5) * 100)}% ${Math.round(
        (g.focalY ?? 0.5) * 100
      )}%, ${stops})`
    : // CSS angles run clockwise from "up"; the document's run
      // counter-clockwise from "right", which is what both renderers use.
      `linear-gradient(${90 - (g.angle ?? 0)}deg, ${stops})`;
};

export const GradientEditor: FC<{
  value?: DesignerGradient;
  onChange: (next: DesignerGradient) => void;
  /** Called once when a drag ends, for a single history entry. */
  onCommit?: () => void;
  brandColors?: string[];
  brandEnforcement?: boolean;
}> = ({ value, onChange, onCommit, brandColors, brandEnforcement }) => {
  const t = useT();
  const gradient = value?.stops?.length ? value : DEFAULT_GRADIENT;
  const stops = gradient.stops;
  const stripRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<number | null>(null);

  const patch = useCallback(
    (next: Partial<DesignerGradient>) => onChange({ ...gradient, ...next }),
    [gradient, onChange]
  );

  const setStop = (index: number, next: Partial<(typeof stops)[number]>) =>
    patch({ stops: stops.map((s, i) => (i === index ? { ...s, ...next } : s)) });

  const addStop = () => {
    // New stop in the widest gap, coloured by interpolating its neighbours —
    // the useful default, rather than a black stop the user must then fix.
    const sorted = [...stops].sort((a, b) => a.offset - b.offset);
    let gap = 0;
    let at = 0.5;
    for (let i = 0; i < sorted.length - 1; i++) {
      const size = sorted[i + 1].offset - sorted[i].offset;
      if (size > gap) {
        gap = size;
        at = sorted[i].offset + size / 2;
      }
    }
    const before = [...sorted].reverse().find((s) => s.offset <= at) || sorted[0];
    patch({ stops: [...stops, { offset: at, color: before.color }] });
  };

  const removeStop = (index: number) => {
    // Two is the floor: one stop is a flat fill wearing a gradient's clothes.
    if (stops.length <= 2) return;
    patch({ stops: stops.filter((_, i) => i !== index) });
  };

  const offsetFromEvent = (clientX: number): number => {
    const rect = stripRef.current?.getBoundingClientRect();
    if (!rect || !rect.width) return 0;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  };

  const onPointerDown = (index: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    dragging.current = index;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (dragging.current === null) return;
    setStop(dragging.current, { offset: offsetFromEvent(e.clientX) });
  };

  const endDrag = () => {
    if (dragging.current === null) return;
    dragging.current = null;
    onCommit?.();
  };

  return (
    <div className="flex flex-col gap-3" data-testid="gradient-editor">
      <div
        ref={stripRef}
        className="relative w-full h-10 rounded-lg border border-studioBorder"
        style={{ background: gradientCss({ ...gradient, type: 'linear', angle: 0 }) }}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
      >
        {stops.map((stop, i) => (
          <button
            key={i}
            type="button"
            aria-label={t('designer_gradient_stop', 'Gradient stop {{n}}', { n: i + 1 })}
            data-stop-index={i}
            onPointerDown={onPointerDown(i)}
            onDoubleClick={() => removeStop(i)}
            className="absolute top-[-4px] w-[14px] h-[48px] -translate-x-1/2 rounded-[3px] border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
            style={{ left: `${stop.offset * 100}%`, backgroundColor: stop.color }}
          />
        ))}
      </div>

      <div className="flex items-center justify-between">
        <SegmentedControl
          value={gradient.type}
          options={[
            { value: 'linear', label: t('designer_linear', 'Linear') },
            { value: 'radial', label: t('designer_radial', 'Radial') },
          ]}
          onChange={(v) => patch({ type: v as 'linear' | 'radial' })}
        />
        <button
          type="button"
          onClick={addStop}
          className="ml-2 px-2 h-[26px] rounded-md border border-studioBorder text-[12px] text-textColor hover:border-designerAccent"
        >
          {t('designer_add_stop', 'Add stop')}
        </button>
      </div>

      <div className="flex flex-col gap-2">
        {stops.map((stop, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="flex-1">
              <ColorSwatch
                label={t('designer_gradient_stop', 'Gradient stop {{n}}', { n: i + 1 })}
                value={stop.color}
                onChange={(hex) => setStop(i, { color: hex })}
                brandColors={brandColors}
                brandEnforcement={brandEnforcement}
              />
            </div>
            <div className="w-[92px]">
              <Slider
                label={t('designer_gradient_position', 'Position')}
                min={0}
                max={100}
                value={Math.round(stop.offset * 100)}
                onChange={(n) => setStop(i, { offset: n / 100 })}
                onCommit={onCommit}
                suffix="%"
              />
            </div>
            <button
              type="button"
              aria-label={t('designer_remove_stop', 'Remove stop')}
              disabled={stops.length <= 2}
              onClick={() => removeStop(i)}
              className="text-textColor/50 hover:text-textColor disabled:opacity-30 text-[14px] leading-none px-1"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {gradient.type === 'linear' ? (
        <Slider
          label={t('designer_label_angle', 'Angle')}
          min={0}
          max={360}
          suffix="°"
          value={gradient.angle ?? 0}
          onChange={(n) => patch({ angle: n })}
          onCommit={onCommit}
        />
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <Slider
            label={t('designer_gradient_focal_x', 'Focal X')}
            min={0}
            max={100}
            suffix="%"
            value={Math.round((gradient.focalX ?? 0.5) * 100)}
            onChange={(n) => patch({ focalX: n / 100 })}
            onCommit={onCommit}
          />
          <Slider
            label={t('designer_gradient_focal_y', 'Focal Y')}
            min={0}
            max={100}
            suffix="%"
            value={Math.round((gradient.focalY ?? 0.5) * 100)}
            onChange={(n) => patch({ focalY: n / 100 })}
            onCommit={onCommit}
          />
        </div>
      )}
    </div>
  );
};
