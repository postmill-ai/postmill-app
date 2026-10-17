'use client';

import React, { FC, useState } from 'react';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { isValidSegmentWindow } from './segment-regenerate';

interface SegmentRegenerateDialogProps {
  /** Clip duration in ms — the bounds inputs are clip-relative seconds. */
  clipDurationMs: number;
  defaultStartMs: number;
  defaultEndMs: number;
  onClose: () => void;
  onConfirm: (window: { startMs: number; endMs: number }, prompt: string) => void | Promise<void>;
}

const inputClass =
  'w-full px-[12px] py-[9px] rounded-[8px] bg-newBgColorInner border border-studioBorder text-[13px] text-textColor outline-hidden focus:border-[#2B5CD3] transition-colors';

export const SegmentRegenerateDialog: FC<SegmentRegenerateDialogProps> = ({
  clipDurationMs,
  defaultStartMs,
  defaultEndMs,
  onClose,
  onConfirm,
}) => {
  const t = useT();
  const [prompt, setPrompt] = useState('');
  const [startSec, setStartSec] = useState((defaultStartMs / 1000).toFixed(1));
  const [endSec, setEndSec] = useState((defaultEndMs / 1000).toFixed(1));
  const [busy, setBusy] = useState(false);

  const window = {
    startMs: Math.round(parseFloat(startSec) * 1000) || 0,
    endMs: Math.round(parseFloat(endSec) * 1000) || 0,
  };
  const windowValid = isValidSegmentWindow(window, clipDurationMs);
  const canConfirm = prompt.trim().length > 0 && windowValid && !busy;
  const clipDurationSec = clipDurationMs / 1000;

  const handleConfirm = async () => {
    if (!canConfirm) return;
    setBusy(true);
    try {
      await onConfirm(window, prompt.trim());
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-[16px] p-[4px] min-w-[340px]">
      <h3 className="text-[14px] font-medium text-textColor">
        {t('designer_regenerate_segment_title', 'Regenerate segment with AI')}
      </h3>

      <div>
        <label htmlFor="segment-prompt" className="block text-[12px] text-newTextColor/70 mb-[6px]">
          {t('designer_prompt_label', 'Prompt')} <span className="text-amber-600">*</span>
        </label>
        <textarea
          id="segment-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={t('designer_segment_prompt_placeholder', 'Describe the transformation…')}
          rows={3}
          className={`${inputClass} resize-y min-h-[72px]`}
        />
      </div>

      <div className="flex gap-[12px]">
        <div className="flex-1">
          <label htmlFor="segment-start" className="block text-[12px] text-newTextColor/70 mb-[6px]">
            {t('designer_segment_start_label', 'Segment start (s)')}
          </label>
          <input
            id="segment-start"
            type="number"
            min={0}
            max={clipDurationSec}
            step={0.1}
            value={startSec}
            onChange={(e) => setStartSec(e.target.value)}
            className={inputClass}
          />
        </div>
        <div className="flex-1">
          <label htmlFor="segment-end" className="block text-[12px] text-newTextColor/70 mb-[6px]">
            {t('designer_segment_end_label', 'Segment end (s)')}
          </label>
          <input
            id="segment-end"
            type="number"
            min={0}
            max={clipDurationSec}
            step={0.1}
            value={endSec}
            onChange={(e) => setEndSec(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>
      {!windowValid && (
        <div className="text-[12px] text-amber-600">
          {t(
            'designer_segment_invalid_window',
            'Pick a window inside the clip, at least 0.1s and at most 30s long.',
          )}
        </div>
      )}

      <div className="flex justify-end gap-[8px] pt-[4px]">
        <button
          type="button"
          onClick={onClose}
          className="px-[12px] py-[8px] rounded-[8px] text-[13px] text-textColor hover:bg-studioBorder/30 transition-colors"
        >
          {t('cancel', 'Cancel')}
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={!canConfirm}
          className="px-[12px] py-[8px] rounded-[8px] text-[13px] bg-[#2B5CD3] text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#244bb0] transition-colors"
        >
          {busy ? t('designer_starting_ellipsis', 'Starting…') : t('designer_regenerate_segment_action', 'Regenerate segment')}
        </button>
      </div>
    </div>
  );
};
