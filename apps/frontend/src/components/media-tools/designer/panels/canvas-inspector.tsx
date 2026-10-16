'use client';

import React, { FC, useCallback, useState } from 'react';
import { ColorSwatch, Slider, SegmentedControl, Stepper } from '../controls';
import { useBrandColors } from './use-brand-colors';
import { GradientEditor, gradientCss } from '../controls/gradient-editor';
import { useMediaPicker } from '../../use-media-picker';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import type { DesignerBackground, DesignerGradient, DesignerOutput, DesignerTexture, VideoOutput } from '../designer.store';

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

  // Seeded from the document, not hard-initialized: opening a design whose
  // background is already an image must land on the Image tab.
  const [bgMode, setBgMode] = useState<BgMode>(
    () => ((out as DesignerOutput | undefined)?.bg?.type as BgMode) ?? 'color'
  );
  // The gradient lives on the document, not in local state — the old
  // start/end/angle trio could only ever describe two stops, and needed an
  // "Apply" button because it wasn't reading what was already there.
  const bgGradient = (out as DesignerOutput | undefined)?.bg?.gradient as
    | DesignerGradient
    | undefined;
  const bg = (out as DesignerOutput | undefined)?.bg;
  const bgImage = bg?.type === 'image' ? bg : undefined;

  // Local during a focal drag: setOutputBackground pushes a history entry on
  // every call, so the pointer-move stream must not commit per frame — only
  // the drop point does.
  const [focalDrag, setFocalDrag] = useState<{ x: number; y: number } | null>(null);
  const focal = focalDrag ?? bgImage?.focalPoint ?? { x: 0.5, y: 0.5 };

  const setColor = useCallback(
    (color: string) => store.getState().setOutputBackground({ type: 'color', color }),
    [store]
  );

  const patchBg = useCallback(
    (patch: Partial<DesignerBackground>) => {
      const current = store.getState().doc.outputs[store.getState().currentOutput]?.bg;
      if (!current) return;
      store.getState().setOutputBackground({ ...current, ...patch });
    },
    [store]
  );

  // Silent twin of patchBg for the texture sliders: a slider drag is a stream
  // of ticks, and each committed setOutputBackground pushes a history entry —
  // write per tick, pushHistory once on release (the effects panel's pattern).
  const patchBgSilent = useCallback(
    (patch: Partial<DesignerBackground>) => {
      const state = store.getState();
      const current = state.doc.outputs[state.currentOutput]?.bg;
      if (!current) return;
      state.setOutputBackground({ ...current, ...patch }, false);
    },
    [store]
  );

  const setTextureType = useCallback(
    (type: 'none' | 'grain' | 'paper') => {
      const state = store.getState();
      const out = state.doc.outputs[state.currentOutput];
      if (!out) return;
      // A doc may carry no `bg` object yet (plain `background` color) — anchor
      // the texture on that color so enabling one never blanks the page.
      const current = out.bg ?? { type: 'color' as const, color: out.background || '#ffffff' };
      if (type === 'none') {
        state.setOutputBackground({ ...current, texture: undefined });
        return;
      }
      // Retune rather than reset when switching kinds: intensity/scale/seed the
      // user dialed in carry across.
      const prev = current.texture;
      state.setOutputBackground({
        ...current,
        texture: {
          type,
          intensity: prev?.intensity ?? 0.35,
          scale: prev?.scale ?? 1,
          seed: prev?.seed ?? 0,
        },
      });
    },
    [store]
  );

  const focalFromEvent = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    };
  };

  const handleFocalPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setFocalDrag(focalFromEvent(e));
  };

  const handleFocalPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!focalDrag) return;
    setFocalDrag(focalFromEvent(e));
  };

  const handleFocalPointerUp = () => {
    if (focalDrag) patchBg({ focalPoint: focalDrag });
    setFocalDrag(null);
  };

  const nudgeFocal = (dx: number, dy: number) =>
    patchBg({
      focalPoint: {
        x: Math.min(1, Math.max(0, focal.x + dx)),
        y: Math.min(1, Math.max(0, focal.y + dy)),
      },
    });

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
        naturalWidth: item.width || undefined,
        naturalHeight: item.height || undefined,
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

          {bgMode === 'image' &&
            (bgImage?.src ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-textColor/50">{t('designer_label_focal_point', 'Focal point')}</span>
                  <button
                    className="text-[10px] text-btnPrimaryAccent"
                    onClick={() => patchBg({ focalPoint: { x: 0.5, y: 0.5 } })}
                  >
                    {t('designer_center', 'Center')}
                  </button>
                </div>
                {/* The drag pad doubles as the preview thumbnail — the same
                    pattern the image inspector uses for a layer's focal point.
                    The renderer cover-crops the background around this point. */}
                <div
                  className="relative w-full h-[96px] rounded-sm overflow-hidden border border-studioBorder bg-newBgColorInner cursor-crosshair"
                  style={{
                    backgroundImage: `url(${bgImage.src})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                  }}
                  onPointerDown={handleFocalPointerDown}
                  onPointerMove={handleFocalPointerMove}
                  onPointerUp={handleFocalPointerUp}
                  onPointerLeave={handleFocalPointerUp}
                >
                  <div
                    className="absolute w-3 h-3 rounded-full border-2 border-white bg-designerAccent shadow pointer-events-none"
                    style={{
                      left: `calc(${focal.x * 100}% - 6px)`,
                      top: `calc(${focal.y * 100}% - 6px)`,
                    }}
                  />
                </div>
                <div className="grid grid-cols-3 gap-1">
                  <div />
                  <button
                    className="px-2 py-1 bg-newBgColor hover:bg-studioBorder/10 rounded-sm border border-studioBorder text-xs"
                    onClick={() => nudgeFocal(0, -0.02)}
                    aria-label={t('designer_move_focal_point_up', 'Move focal point up')}
                  >
                    ↑
                  </button>
                  <div />
                  <button
                    className="px-2 py-1 bg-newBgColor hover:bg-studioBorder/10 rounded-sm border border-studioBorder text-xs"
                    onClick={() => nudgeFocal(-0.02, 0)}
                    aria-label={t('designer_move_focal_point_left', 'Move focal point left')}
                  >
                    ←
                  </button>
                  <button
                    className="px-2 py-1 bg-newBgColor hover:bg-studioBorder/10 rounded-sm border border-studioBorder text-xs"
                    onClick={() => nudgeFocal(0, 0.02)}
                    aria-label={t('designer_move_focal_point_down', 'Move focal point down')}
                  >
                    ↓
                  </button>
                  <button
                    className="px-2 py-1 bg-newBgColor hover:bg-studioBorder/10 rounded-sm border border-studioBorder text-xs"
                    onClick={() => nudgeFocal(0.02, 0)}
                    aria-label={t('designer_move_focal_point_right', 'Move focal point right')}
                  >
                    →
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Stepper
                    label={t('designer_focal_x', 'Focal X')}
                    min={0}
                    max={100}
                    step={1}
                    value={Math.round(focal.x * 100)}
                    onChange={(n) =>
                      patchBg({ focalPoint: { x: n / 100, y: focal.y } })
                    }
                  />
                  <Stepper
                    label={t('designer_focal_y', 'Focal Y')}
                    min={0}
                    max={100}
                    step={1}
                    value={Math.round(focal.y * 100)}
                    onChange={(n) =>
                      patchBg({ focalPoint: { x: focal.x, y: n / 100 } })
                    }
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={imagePicker.open}
                    className="px-3 py-2 rounded-lg text-[12px] font-medium border border-designerAccent text-btnPrimaryAccent hover:bg-designerAccent/10"
                  >
                    {t('designer_replace_image', 'Replace image…')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setColor(bgColor)}
                    className="px-3 py-2 rounded-lg text-[12px] font-medium border border-studioBorder bg-newBgColor text-textColor/70 hover:text-textColor hover:bg-studioBorder/10"
                  >
                    {t('designer_remove_background_image', 'Remove')}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={imagePicker.open}
                className="w-full px-3 py-2 rounded-lg text-[12px] font-medium bg-designerAccent text-white hover:bg-designerAccent/80"
              >
                {t('designer_choose_from_media_library', 'Choose from media library…')}
              </button>
            ))}

          {/* A texture is an overlay ON the chosen base (color, gradient or
              image) — procedural, seeded and deterministic, so the canvas, the
              export and the video frames all paint the same speckle. */}
          <div className="space-y-2 pt-2 border-t border-studioBorder">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-textColor/50">{t('designer_label_texture', 'Texture')}</span>
              {bg?.texture && (
                <button
                  type="button"
                  className="text-[10px] text-btnPrimaryAccent"
                  title={t('designer_texture_reseed_hint', 'New random grain')}
                  // Edit-time randomness only — the seed is stored on the doc,
                  // so every render afterwards is deterministic.
                  onClick={() =>
                    patchBg({
                      texture: {
                        ...(bg.texture as DesignerTexture),
                        seed: Math.floor(Math.random() * 2147483647),
                      },
                    })
                  }
                >
                  {t('designer_texture_reseed', 'Reseed')}
                </button>
              )}
            </div>
            <SegmentedControl
              value={bg?.texture?.type ?? 'none'}
              options={[
                { value: 'none', label: t('designer_texture_none', 'None') },
                { value: 'grain', label: t('designer_texture_grain', 'Grain') },
                { value: 'paper', label: t('designer_texture_paper', 'Paper') },
              ]}
              onChange={(v) => setTextureType(v as 'none' | 'grain' | 'paper')}
            />
            {bg?.texture && (
              <div className="flex flex-col gap-3">
                <Slider
                  label={t('designer_texture_intensity', 'Intensity')}
                  min={0}
                  max={100}
                  suffix="%"
                  value={Math.round((bg.texture.intensity ?? 0.35) * 100)}
                  onChange={(n) =>
                    patchBgSilent({
                      texture: { ...(bg.texture as DesignerTexture), intensity: n / 100 },
                    })
                  }
                  onCommit={() => store.getState().pushHistory('Background texture')}
                />
                <Slider
                  label={t('designer_texture_scale', 'Scale')}
                  min={0.25}
                  max={4}
                  step={0.25}
                  suffix="×"
                  value={bg.texture.scale ?? 1}
                  onChange={(n) =>
                    patchBgSilent({
                      texture: { ...(bg.texture as DesignerTexture), scale: n },
                    })
                  }
                  onCommit={() => store.getState().pushHistory('Background texture')}
                />
              </div>
            )}
          </div>
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
