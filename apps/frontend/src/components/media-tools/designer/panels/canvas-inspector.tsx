'use client';

import React, { FC, useCallback, useState } from 'react';
import { ColorSwatch, Slider, SegmentedControl } from '../controls';
import { useBrandColors } from './use-brand-colors';
import { GradientEditor, gradientCss } from '../controls/gradient-editor';
import { useMediaPicker } from '../../use-media-picker';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import type { DesignerGradient, DesignerOutput, VideoOutput } from '../designer.store';

interface CanvasInspectorProps {
  store: any;
}

/**
 * Background presets, moved here from the old left-rail Background panel along
 * with the gradient builder. Background is a property of the canvas, so it
 * belongs with the canvas's other properties rather than in a rail of its own.
 */
const COLOR_PRESETS = [
  { label: 'White', labelKey: 'designer_color_white', color: '#ffffff' },
  { label: 'Black', labelKey: 'designer_color_black', color: '#000000' },
  { label: 'Blue', labelKey: 'blue', color: '#2B5CD3' },
  { label: 'Dark Blue', labelKey: 'designer_color_dark_blue', color: '#1e2a4a' },
  { label: 'Red', labelKey: 'designer_color_red', color: '#e53935' },
  { label: 'Green', labelKey: 'green', color: '#43a047' },
  { label: 'Purple', labelKey: 'purple', color: '#7b1fa2' },
  { label: 'Orange', labelKey: 'orange', color: '#fb8c00' },
  { label: 'Gray', labelKey: 'designer_color_gray', color: '#9e9e9e' },
  { label: 'Light Gray', labelKey: 'designer_color_light_gray', color: '#f5f5f5' },
];

type BgMode = 'color' | 'gradient' | 'image';

// Shown in the right column when nothing is selected (D-6): properties for the
// current canvas/output — size, background, and (video) duration.
export const CanvasInspector: FC<CanvasInspectorProps> = ({ store }) => {
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

  const [bgMode, setBgMode] = useState<BgMode>('color');
  // The gradient lives on the document, not in local state — the old
  // start/end/angle trio could only ever describe two stops, and needed an
  // "Apply" button because it wasn't reading what was already there.
  const bgGradient = (out as DesignerOutput | undefined)?.bg?.gradient as
    | DesignerGradient
    | undefined;

  const setColor = useCallback(
    (color: string) => store.getState().setOutputBackground({ type: 'color', color }),
    [store]
  );



  // One picker, no second file browser: MediaSelectorModal already lists My
  // Files alongside the stock tabs.
  const imagePicker = useMediaPicker({
    title: t('background_image', 'Background image'),
    kinds: ['image'],
    onSelect: (item) => {
      if (item.type !== 'image') return;
      store.getState().setOutputBackground({
        type: 'image',
        src: item.url,
        fileId: item.fileId,
      });
    },
  });



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
              className="w-full h-[34px] rounded-[6px] border border-studioBorder bg-newBgColor px-2 text-[13px] text-textColor text-center outline-hidden focus:border-designerAccent"
            />
            <span className="text-textColor/30">×</span>
            <input
              type="number"
              value={h}
              onChange={(e) => setH(e.target.value)}
              aria-label={t('designer_label_height', 'Height')}
              className="w-full h-[34px] rounded-[6px] border border-studioBorder bg-newBgColor px-2 text-[13px] text-textColor text-center outline-hidden focus:border-designerAccent"
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

          <SegmentedControl
            value={bgMode}
            options={[
              { value: 'color', label: t('color', 'Color') },
              { value: 'gradient', label: t('designer_gradient', 'Gradient') },
              { value: 'image', label: t('provider_chip_image', 'Image') },
            ]}
            onChange={(v) => setBgMode(v as BgMode)}
          />

          {bgMode === 'color' && (
            <>
              <div className="grid grid-cols-5 gap-2">
                {COLOR_PRESETS.map((preset) => (
                  <button
                    key={preset.color}
                    onClick={() => setColor(preset.color)}
                    title={t(preset.labelKey, preset.label)}
                    aria-label={t(preset.labelKey, preset.label)}
                    className={`w-full aspect-square rounded-lg border-2 transition-all ${
                      bgColor === preset.color
                        ? 'border-designerAccent ring-1 ring-designerAccent'
                        : 'border-studioBorder hover:border-designerAccent'
                    }`}
                  >
                    <div
                      className="w-full h-full rounded-[5px]"
                      style={{ backgroundColor: preset.color }}
                    />
                  </button>
                ))}
              </div>
              <ColorSwatch
                label={t('custom_color', 'Custom color')}
                value={/^#[0-9a-fA-F]{6}$/.test(bgColor) ? bgColor : '#ffffff'}
                onChange={setColor}
                brandColors={brandColors}
                brandEnforcement={brandEnforcement}
              />
            </>
          )}

          {bgMode === 'gradient' && (
            <div className="flex flex-col gap-3">
              <div
                className="w-full h-16 rounded-lg border border-studioBorder"
                style={{ background: bgGradient ? gradientCss(bgGradient) : 'transparent' }}
              />
              {/* The two-stop start/end pair is gone: the same editor every
                  other gradient surface uses, so a page background can carry a
                  multi-stop ramp like anything else. */}
              <GradientEditor
                value={bgGradient}
                onChange={(g: DesignerGradient) =>
                  store.getState().setOutputBackground({ type: 'gradient', gradient: g })
                }
                brandColors={brandColors}
                brandEnforcement={brandEnforcement}
              />
            </div>
          )}

          {bgMode === 'image' && (
            <button
              type="button"
              onClick={imagePicker.open}
              className="w-full px-3 py-2 rounded-lg text-[12px] font-medium bg-designerAccent text-white hover:bg-designerAccent/80"
            >
              {t('designer_choose_from_media_library', 'Choose from media library…')}
            </button>
          )}
          {imagePicker.element}
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
