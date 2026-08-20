'use client';

import React, { FC, useState } from 'react';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { ColorSwatch, SegmentedControl, Slider, Stepper } from './controls';
import { SELECTABLE_BLEND_MODES } from '@postmill-ai/nestjs-libraries/media/designer-doc/pixel-ops';
import type {
  DesignerBlendMode,
  FillContents,
} from './designer.store';

/**
 * Edit ▸ Fill and Edit ▸ Stroke, laid out as Photoshop lays them out: Contents
 * first, then a Blending block both dialogs share.
 */

export interface FillSettings {
  contents: FillContents;
  color: string;
  blendMode: DesignerBlendMode;
  opacity: number;
  preserveTransparency: boolean;
}

export interface StrokeSettings extends FillSettings {
  width: number;
  location: 'inside' | 'center' | 'outside';
}

const BLEND_LABELS: Record<string, string> = {
  normal: 'Normal',
  multiply: 'Multiply',
  screen: 'Screen',
  overlay: 'Overlay',
  darken: 'Darken',
  lighten: 'Lighten',
  'color-dodge': 'Color Dodge',
  'color-burn': 'Color Burn',
  'hard-light': 'Hard Light',
  'soft-light': 'Soft Light',
  difference: 'Difference',
  exclusion: 'Exclusion',
  hue: 'Hue',
  saturation: 'Saturation',
  color: 'Color',
  luminosity: 'Luminosity',
};

const Blending: FC<{
  value: FillSettings;
  onChange: (next: Partial<FillSettings>) => void;
}> = ({ value, onChange }) => {
  const t = useT();
  return (
    <>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-textColor/60">
          {t('layer_blend_mode', 'Blend mode')}
        </span>
        <select
          value={value.blendMode}
          onChange={(e) => onChange({ blendMode: e.target.value as DesignerBlendMode })}
          className="h-[30px] px-2 rounded-md bg-newBgColor border border-studioBorder text-[12px] text-textColor outline-hidden"
        >
          {SELECTABLE_BLEND_MODES.map((m) => (
            <option key={m} value={m}>{BLEND_LABELS[m] || m}</option>
          ))}
        </select>
      </label>

      <Slider
        label={t('opacity', 'Opacity')}
        min={0}
        max={100}
        suffix="%"
        value={Math.round(value.opacity * 100)}
        onChange={(n) => onChange({ opacity: n / 100 })}
      />

      <label className="flex items-center gap-2 text-[12px] text-textColor">
        <input
          type="checkbox"
          checked={value.preserveTransparency}
          onChange={(e) => onChange({ preserveTransparency: e.target.checked })}
          className="accent-designerAccent w-3.5 h-3.5"
        />
        {t('designer_preserve_transparency', 'Preserve Transparency')}
      </label>
    </>
  );
};

const CONTENTS: { value: FillContents; label: string; labelKey: string }[] = [
  { value: 'color', label: 'Color', labelKey: 'color' },
  { value: 'black', label: 'Black', labelKey: 'designer_color_black' },
  { value: 'white', label: 'White', labelKey: 'designer_color_white' },
  { value: 'gray', label: '50% Gray', labelKey: 'designer_color_50_gray' },
];

export const FillDialog: FC<{
  initial: FillSettings;
  onApply: (settings: FillSettings) => void;
  onClose: () => void;
}> = ({ initial, onApply, onClose }) => {
  const t = useT();
  const [settings, setSettings] = useState<FillSettings>(initial);
  const patch = (next: Partial<FillSettings>) =>
    setSettings((prev) => ({ ...prev, ...next }));

  return (
    <div className="flex flex-col gap-3 min-w-[280px]">
      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-textColor/60">
          {t('designer_contents', 'Contents')}
        </span>
        <select
          value={settings.contents}
          onChange={(e) => patch({ contents: e.target.value as FillContents })}
          className="h-[30px] px-2 rounded-md bg-newBgColor border border-studioBorder text-[12px] text-textColor outline-hidden"
        >
          {CONTENTS.map((c) => (
            <option key={c.value} value={c.value}>{t(c.labelKey, c.label)}</option>
          ))}
        </select>
      </label>

      {settings.contents === 'color' && (
        <ColorSwatch
          label={t('color', 'Color')}
          value={settings.color}
          onChange={(hex) => patch({ color: hex })}
        />
      )}

      <Blending value={settings} onChange={patch} />

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1.5 rounded-md text-[12px] border border-studioBorder text-textColor hover:bg-boxHover"
        >
          {t('cancel', 'Cancel')}
        </button>
        <button
          type="button"
          onClick={() => onApply(settings)}
          className="px-4 py-1.5 rounded-md text-[12px] bg-designerAccent text-white hover:bg-designerAccent/80"
        >
          {t('designer_fill', 'Fill')}
        </button>
      </div>
    </div>
  );
};

export const StrokeDialog: FC<{
  initial: StrokeSettings;
  onApply: (settings: StrokeSettings) => void;
  onClose: () => void;
}> = ({ initial, onApply, onClose }) => {
  const t = useT();
  const [settings, setSettings] = useState<StrokeSettings>(initial);
  const patch = (next: Partial<StrokeSettings>) =>
    setSettings((prev) => ({ ...prev, ...next }));

  return (
    <div className="flex flex-col gap-3 min-w-[280px]">
      <Stepper
        label={t('designer_stroke_width', 'Width')}
        min={1}
        max={250}
        value={settings.width}
        onChange={(n) => patch({ width: n })}
      />

      <ColorSwatch
        label={t('color', 'Color')}
        value={settings.color}
        onChange={(hex) => patch({ color: hex })}
      />

      <div className="flex flex-col gap-1">
        <span className="text-[11px] text-textColor/60">
          {t('designer_stroke_location', 'Location')}
        </span>
        <SegmentedControl
          value={settings.location}
          options={[
            { value: 'inside', label: t('designer_stroke_inside', 'Inside') },
            { value: 'center', label: t('designer_stroke_center', 'Center') },
            { value: 'outside', label: t('designer_stroke_outside', 'Outside') },
          ]}
          onChange={(v) => patch({ location: v as StrokeSettings['location'] })}
        />
      </div>

      <Blending value={settings} onChange={patch} />

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1.5 rounded-md text-[12px] border border-studioBorder text-textColor hover:bg-boxHover"
        >
          {t('cancel', 'Cancel')}
        </button>
        <button
          type="button"
          onClick={() => onApply(settings)}
          className="px-4 py-1.5 rounded-md text-[12px] bg-designerAccent text-white hover:bg-designerAccent/80"
        >
          {t('designer_stroke', 'Stroke')}
        </button>
      </div>
    </div>
  );
};
