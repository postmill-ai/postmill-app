'use client';

import React, { FC, useState } from 'react';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import type { BackgroundRemovalAsset, BackgroundRemovalFit } from './background-removal';

export const BackgroundRemovalDialog: FC<{
  originalUrl: string;
  asset: BackgroundRemovalAsset;
  onApply: (fit: BackgroundRemovalFit) => void | Promise<void>;
  onCancel: () => void;
}> = ({ originalUrl, asset, onApply, onCancel }) => {
  const t = useT();
  const [fit, setFit] = useState<BackgroundRemovalFit>('frame');
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options: { value: BackgroundRemovalFit; label: string; description: string }[] = [
    {
      value: 'frame',
      label: t('designer_bg_fit_frame', 'Preserve frame'),
      description: t('designer_bg_fit_frame_hint', 'Keep the current position and dimensions; fit the whole result inside them.'),
    },
    {
      value: 'canvas',
      label: t('designer_bg_fit_canvas', 'Fit to canvas'),
      description: t('designer_bg_fit_canvas_hint', 'Center and scale the result to fit within the canvas without cropping.'),
    },
    {
      value: 'manual',
      label: t('designer_bg_fit_manual', 'Keep manual geometry'),
      description: t('designer_bg_fit_manual_hint', 'Keep the current frame and fitting mode so you can adjust it yourself.'),
    },
  ];
  const apply = async () => {
    if (applying) return;
    setApplying(true);
    setError(null);
    try {
      await onApply(fit);
      setApplying(false);
    } catch (cause) {
      setError((cause as Error)?.message || t('background_removal_failed', 'Background removal failed'));
      setApplying(false);
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {[
          { label: t('designer_before', 'Before'), src: originalUrl },
          { label: t('designer_after', 'After'), src: asset.url },
        ].map((preview) => (
          <div key={preview.label} className="flex flex-col gap-1.5">
            <div className="text-[12px] font-medium text-textColor/70">{preview.label}</div>
            <div className="h-[240px] rounded-md border border-studioBorder bg-designerCanvas flex items-center justify-center overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element -- generated media preview */}
              <img src={preview.src} alt={preview.label} className="max-w-full max-h-full object-contain" />
            </div>
          </div>
        ))}
      </div>
      <fieldset disabled={applying} className="flex flex-col gap-2">
        <legend className="text-[12px] font-medium text-textColor mb-1">
          {t('designer_bg_result_sizing', 'Result sizing')}
        </legend>
        {options.map((option) => (
          <label key={option.value} className="flex items-start gap-2 rounded-md border border-studioBorder p-2.5 cursor-pointer hover:bg-boxHover">
            <input
              type="radio"
              aria-label={option.label}
              name="background-removal-fit"
              value={option.value}
              checked={fit === option.value}
              onChange={() => setFit(option.value)}
              className="mt-1 accent-designerAccent"
            />
            <span>
              <span className="block text-[12px] font-medium text-textColor">{option.label}</span>
              <span className="block text-[11px] text-newTextColor/60">{option.description}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {error && <div role="alert" className="text-[12px] text-dangerText">{error}</div>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={applying} className="px-3 py-1.5 rounded-md border border-studioBorder text-[12px] text-textColor hover:bg-boxHover disabled:opacity-50">
          {t('cancel', 'Cancel')}
        </button>
        <button type="button" onClick={apply} disabled={applying} className="px-3 py-1.5 rounded-md bg-designerAccent text-[12px] text-white hover:bg-designerAccent/80 disabled:opacity-50">
          {applying ? t('designer_processing_ellipsis', 'Processing...') : t('designer_apply_result', 'Apply result')}
        </button>
      </div>
    </div>
  );
};
