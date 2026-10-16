'use client';

import React, { FC, useState } from 'react';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { OUTPAINT_MODES, type OutpaintMode } from './ai-image-actions';

/**
 * Small mode picker for AI image expansion (outpainting), shared by the Tools
 * menu action and the inspector's AI Tools section so both entry points offer
 * the same choices (D-10: one implementation).
 */

const MODE_LABEL_KEYS: Record<OutpaintMode, [string, string]> = {
  'zoom-1.5x': ['designer_outpaint_zoom_1_5x', 'Zoom out 1.5×'],
  'zoom-2x': ['designer_outpaint_zoom_2x', 'Zoom out 2×'],
  'make-square': ['designer_outpaint_make_square', 'Make square'],
  left: ['designer_outpaint_left', 'Extend left'],
  right: ['designer_outpaint_right', 'Extend right'],
  top: ['designer_outpaint_top', 'Extend up'],
  bottom: ['designer_outpaint_bottom', 'Extend down'],
};

interface OutpaintDialogProps {
  busy?: boolean;
  onApply: (mode: OutpaintMode, prompt?: string) => void;
  onCancel: () => void;
}

export const OutpaintDialog: FC<OutpaintDialogProps> = ({ busy, onApply, onCancel }) => {
  const t = useT();
  const [mode, setMode] = useState<OutpaintMode>('zoom-1.5x');
  const [prompt, setPrompt] = useState('');

  return (
    <div className="flex flex-col gap-3 min-w-[300px]">
      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-textColor/60">
          {t('designer_outpaint_mode', 'Expand mode')}
        </span>
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as OutpaintMode)}
          className="h-[30px] px-2 rounded-md bg-newBgColor border border-studioBorder text-[12px] text-textColor outline-hidden"
        >
          {OUTPAINT_MODES.map((m) => (
            <option key={m} value={m}>
              {t(MODE_LABEL_KEYS[m][0], MODE_LABEL_KEYS[m][1])}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-textColor/60">
          {t('designer_outpaint_prompt', 'Prompt (optional — guides the new area)')}
        </span>
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={t('designer_placeholder_outpaint', 'e.g. grassy field, studio backdrop…')}
          className="h-[30px] px-2 rounded-md bg-newBgColor border border-studioBorder text-[12px] text-textColor outline-hidden"
        />
      </label>

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 rounded-md text-[12px] border border-studioBorder text-textColor hover:bg-boxHover"
        >
          {t('cancel', 'Cancel')}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onApply(mode, prompt.trim() || undefined)}
          className="px-4 py-1.5 rounded-md text-[12px] bg-designerAccent text-white hover:bg-designerAccent/80 disabled:opacity-50"
        >
          {busy ? t('designer_processing_ellipsis', 'Processing...') : t('designer_outpaint_apply', 'Expand')}
        </button>
      </div>
    </div>
  );
};
