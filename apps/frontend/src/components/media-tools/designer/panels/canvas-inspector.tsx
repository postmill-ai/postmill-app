'use client';

import React, { FC, useState } from 'react';
import { ColorSwatch, Slider } from '../controls';
import { useBrandColors } from './use-brand-colors';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import type { DesignerOutput, VideoOutput } from '../designer.store';

interface CanvasInspectorProps {
  store: any;
  onSetBackgroundImage: () => void;
}

// Shown in the right column when nothing is selected (D-6): properties for the
// current canvas/output — size, background, and (video) duration.
export const CanvasInspector: FC<CanvasInspectorProps> = ({ store, onSetBackgroundImage }) => {
  const t = useT();
  const doc = store((s: any) => s.doc);
  const currentOutput = store((s: any) => s.currentOutput);
  const brandColors = useBrandColors();
  const brandEnforcement = store((s: any) => s.brandEnforcement);
  const out = doc.outputs[currentOutput] as DesignerOutput | VideoOutput | undefined;

  // Inputs are seeded from the active output; the parent remounts this component
  // (via a key) when the output or its dimensions change, so no in-render sync.
  const [w, setW] = useState(String(out?.width ?? 1080));
  const [h, setH] = useState(String(out?.height ?? 1080));

  if (!out) return null;
  const isVideo = doc.mode === 'video';
  const bgColor = !isVideo ? (out as DesignerOutput).background || '#ffffff' : '#000000';

  const applySize = () => {
    const nw = parseInt(w, 10);
    const nh = parseInt(h, 10);
    if (nw > 0 && nh > 0) store.getState().resizeOutput(currentOutput, nw, nh);
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="text-[11px] text-textColor/50 mb-1">{t('designer_label_format', 'Format')}</div>
        <div className="text-[13px] text-textColor font-medium">{out.name}</div>
        <div className="text-[11px] text-textColor/40">
          {out.width} × {out.height}
        </div>
      </div>

      {!isVideo && (
        <div className="space-y-2">
          <div className="text-[11px] text-textColor/50">{t('designer_label_canvas_size', 'Canvas size')}</div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={w}
              onChange={(e) => setW(e.target.value)}
              aria-label={t('designer_label_width', 'Width')}
              className="w-full h-[34px] rounded-[6px] border border-studioBorder bg-newBgColor px-2 text-[13px] text-textColor text-center outline-none focus:border-designerAccent"
            />
            <span className="text-textColor/30">×</span>
            <input
              type="number"
              value={h}
              onChange={(e) => setH(e.target.value)}
              aria-label={t('designer_label_height', 'Height')}
              className="w-full h-[34px] rounded-[6px] border border-studioBorder bg-newBgColor px-2 text-[13px] text-textColor text-center outline-none focus:border-designerAccent"
            />
            <button
              onClick={applySize}
              className="h-[34px] px-3 rounded-[6px] text-[12px] bg-designerAccent text-white hover:bg-designerAccent/80 shrink-0"
            >
              {t('apply', 'Apply')}
            </button>
          </div>
        </div>
      )}

      {!isVideo && (
        <div className="space-y-2">
          <div className="text-[11px] text-textColor/50">{t('designer_label_background', 'Background')}</div>
          <ColorSwatch
            label={t('color', 'Color')}
            value={bgColor}
            onChange={(hex) => store.getState().setOutputBackground({ type: 'color', color: hex })}
            brandColors={brandColors}
            brandEnforcement={brandEnforcement}
          />
          <button
            onClick={onSetBackgroundImage}
            className="w-full px-3 py-2 rounded-md text-[12px] border border-studioBorder text-textColor hover:bg-boxHover transition-colors"
          >
            {t('designer_set_background_image', 'Set background image…')}
          </button>
        </div>
      )}

      {isVideo && (
        <div className="space-y-2">
          <div className="text-[11px] text-textColor/50">
            {t('designer_duration_fps', 'Duration · {{fps}} fps', { fps: (out as VideoOutput).fps ?? 30 })}
          </div>
          <Slider
            label={t('designer_label_seconds', 'Seconds')}
            min={1}
            max={60}
            step={1}
            value={Math.round(((out as VideoOutput).durationMs ?? 10000) / 1000)}
            onChange={(n) => store.getState().setVideoDuration(currentOutput, n * 1000)}
          />
        </div>
      )}
    </div>
  );
};
