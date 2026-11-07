'use client';

import React, { FC, useState } from 'react';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { OUTPAINT_MODES, type OutpaintCandidate, type OutpaintMode } from './outpaint';

const MODE_LABEL_KEYS: Record<OutpaintMode, [string, string]> = {
  'zoom-1.5x': ['designer_outpaint_zoom_1_5x', 'Zoom out 1.5×'],
  'zoom-2x': ['designer_outpaint_zoom_2x', 'Zoom out 2×'],
  'make-square': ['designer_outpaint_make_square', 'Make square'],
  left: ['designer_outpaint_left', 'Extend left'],
  right: ['designer_outpaint_right', 'Extend right'],
  top: ['designer_outpaint_top', 'Extend up'],
  bottom: ['designer_outpaint_bottom', 'Extend down'],
};

export interface OutpaintRequest {
  scope: 'image' | 'page';
  mode?: OutpaintMode;
  prompt?: string;
  targetWidth?: number;
  targetHeight?: number;
}

interface OutpaintDialogProps {
  pageWidth: number;
  pageHeight: number;
  onPrepare: (request: OutpaintRequest) => Promise<OutpaintCandidate>;
  onApply: (candidate: OutpaintCandidate) => Promise<boolean>;
  onCancel: () => void;
}

export const OutpaintDialog: FC<OutpaintDialogProps> = ({
  pageWidth,
  pageHeight,
  onPrepare,
  onApply,
  onCancel,
}) => {
  const t = useT();
  const [scope, setScope] = useState<'image' | 'page'>('image');
  const [mode, setMode] = useState<OutpaintMode>('zoom-1.5x');
  const [prompt, setPrompt] = useState('');
  const [targetWidth, setTargetWidth] = useState(Math.round(pageWidth * 1.5));
  const [targetHeight, setTargetHeight] = useState(Math.round(pageHeight * 1.5));
  const [candidate, setCandidate] = useState<OutpaintCandidate | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const prepare = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const next = await onPrepare({
        scope,
        mode: scope === 'image' ? mode : undefined,
        prompt: prompt.trim() || undefined,
        targetWidth: scope === 'page' ? targetWidth : undefined,
        targetHeight: scope === 'page' ? targetHeight : undefined,
      });
      setCandidate(next);
    } catch (cause) {
      setError((cause as Error)?.message || t('designer_outpaint_failed', 'Image expansion failed'));
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!candidate || busy) return;
    setBusy(true);
    setError('');
    try {
      const applied = await onApply(candidate);
      if (!applied) {
        setError(t('designer_outpaint_outdated', 'The design changed before this expansion could be applied. Please generate it again.'));
        return;
      }
      onCancel();
    } catch (cause) {
      setError((cause as Error)?.message || t('designer_outpaint_failed', 'Image expansion failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 min-w-[300px]">
      {candidate && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            { label: t('designer_before', 'Before'), src: candidate.sourceUrl },
            { label: t('designer_after', 'After'), src: candidate.assetUrl },
          ].map((preview) => (
            <div key={preview.label} className="flex flex-col gap-1.5">
              <div className="text-[12px] font-medium text-textColor/70">{preview.label}</div>
              <div className="h-[220px] rounded-md border border-studioBorder bg-designerCanvas flex items-center justify-center overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element -- generated expansion preview */}
                <img src={preview.src} alt={preview.label} className="max-w-full max-h-full object-contain" />
              </div>
            </div>
          ))}
        </div>
      )}
      {!candidate && (
        <>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-textColor/60">{t('designer_outpaint_scope', 'Expand what?')}</span>
            <select
              value={scope}
              onChange={(event) => setScope(event.target.value as 'image' | 'page')}
              className="h-[30px] px-2 rounded-md bg-newBgColor border border-studioBorder text-[12px] text-textColor outline-hidden"
            >
              <option value="image">{t('designer_outpaint_scope_image', 'Selected image')}</option>
              <option value="page">{t('designer_outpaint_scope_page', 'Whole page')}</option>
            </select>
          </label>
          {scope === 'image' ? (
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-textColor/60">{t('designer_outpaint_mode', 'Expand mode')}</span>
              <select
                value={mode}
                onChange={(event) => setMode(event.target.value as OutpaintMode)}
                className="h-[30px] px-2 rounded-md bg-newBgColor border border-studioBorder text-[12px] text-textColor outline-hidden"
              >
                {OUTPAINT_MODES.map((item) => (
                  <option key={item} value={item}>{t(MODE_LABEL_KEYS[item][0], MODE_LABEL_KEYS[item][1])}</option>
                ))}
              </select>
            </label>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-textColor/60">{t('designer_width', 'Width')}</span>
                <input
                  type="number"
                  min={pageWidth}
                  value={targetWidth}
                  onChange={(event) => setTargetWidth(Number(event.target.value))}
                  className="h-[30px] px-2 rounded-md bg-newBgColor border border-studioBorder text-[12px] text-textColor outline-hidden"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-textColor/60">{t('designer_height', 'Height')}</span>
                <input
                  type="number"
                  min={pageHeight}
                  value={targetHeight}
                  onChange={(event) => setTargetHeight(Number(event.target.value))}
                  className="h-[30px] px-2 rounded-md bg-newBgColor border border-studioBorder text-[12px] text-textColor outline-hidden"
                />
              </label>
            </div>
          )}
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-textColor/60">{t('designer_outpaint_prompt', 'Prompt (optional — guides the new area)')}</span>
            <input
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={t('designer_placeholder_outpaint', 'e.g. grassy field, studio backdrop…')}
              className="h-[30px] px-2 rounded-md bg-newBgColor border border-studioBorder text-[12px] text-textColor outline-hidden"
            />
          </label>
        </>
      )}
      {error && <div role="alert" className="text-[12px] text-dangerText">{error}</div>}
      <div className="flex justify-end gap-2 pt-1">
        {candidate ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => setCandidate(null)}
            className="px-3 py-1.5 rounded-md text-[12px] border border-studioBorder text-textColor hover:bg-boxHover disabled:opacity-50"
          >
            {t('designer_outpaint_change_settings', 'Change settings')}
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="px-3 py-1.5 rounded-md text-[12px] border border-studioBorder text-textColor hover:bg-boxHover disabled:opacity-50"
          >
            {t('cancel', 'Cancel')}
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={candidate ? apply : prepare}
          className="px-4 py-1.5 rounded-md text-[12px] bg-designerAccent text-white hover:bg-designerAccent/80 disabled:opacity-50"
        >
          {busy
            ? t('designer_processing_ellipsis', 'Processing...')
            : candidate
              ? t('designer_apply_result', 'Apply result')
              : t('designer_outpaint_apply', 'Expand')}
        </button>
      </div>
    </div>
  );
};
