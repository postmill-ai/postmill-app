'use client';

import React, { FC, useState } from 'react';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import { Stepper } from '../controls';
import {
  armCutoutRefinement,
  createCutoutMask,
  findCutoutTarget,
  finishCutoutRefinement,
  updateCutoutTarget,
} from '../cutout-refinement';

export const CutoutRefineControls: FC<{
  store: any;
  targetId: string;
}> = ({ store, targetId }) => {
  const t = useT();
  const fetch = useFetch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const doc = store((state: any) => state.doc);
  const currentOutput = store((state: any) => state.currentOutput);
  const currentPage = store((state: any) => state.currentPage);
  const maskTargetId = store((state: any) => state.maskTargetId);
  const activeTool = store((state: any) => state.activeTool);
  const toolOptions = store((state: any) => state.toolOptions);
  void doc;
  void currentOutput;
  void currentPage;
  const target = findCutoutTarget(store, targetId);
  if (!target?.src) return null;

  const arm = async (tool: 'brush' | 'eraser') => {
    setError(null);
    try {
      if (await armCutoutRefinement(store, targetId)) {
        store.getState().setActiveTool(tool);
      }
    } catch (cause) {
      setError((cause as Error)?.message || t('designer_cutout_mask_failed', 'Could not prepare the cutout mask.'));
    }
  };
  const create = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await createCutoutMask({ store, fetch, id: targetId });
    } catch (cause) {
      setError((cause as Error)?.message || t('designer_cutout_mask_failed', 'Could not prepare the cutout mask.'));
    } finally {
      setBusy(false);
    }
  };
  const options = toolOptions[activeTool] || {};

  return (
    <div className="pt-3 border-t border-studioBorder space-y-2">
      <div className="text-xs font-semibold text-textColor/70 uppercase tracking-wider">
        {t('designer_cutout_refinement', 'Cutout refinement')}
      </div>
      {!target.originalSrc && (
        <p className="text-[11px] text-textColor/50">
          {t('designer_cutout_original_unavailable', 'Original background is unavailable for this flattened cutout.')}
        </p>
      )}
      {!target.maskSrc ? (
        <button
          type="button"
          onClick={create}
          disabled={busy}
          className="w-full px-3 py-2 rounded-sm text-[12px] border border-studioBorder text-textColor hover:bg-boxHover disabled:opacity-50"
        >
          {busy ? t('designer_processing_ellipsis', 'Processing...') : t('designer_cutout_create_mask', 'Create Restore/Erase mask')}
        </button>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              aria-pressed={maskTargetId === targetId && activeTool === 'brush'}
              onClick={() => arm('brush')}
              className={`px-3 py-2 rounded-sm border text-[12px] ${maskTargetId === targetId && activeTool === 'brush' ? 'border-designerAccent bg-designerAccent/10' : 'border-studioBorder hover:bg-boxHover'}`}
            >
              {t('designer_cutout_restore', 'Restore')}
            </button>
            <button
              type="button"
              aria-pressed={maskTargetId === targetId && activeTool === 'eraser'}
              onClick={() => arm('eraser')}
              className={`px-3 py-2 rounded-sm border text-[12px] ${maskTargetId === targetId && activeTool === 'eraser' ? 'border-designerAccent bg-designerAccent/10' : 'border-studioBorder hover:bg-boxHover'}`}
            >
              {t('designer_cutout_erase', 'Erase')}
            </button>
          </div>
          {maskTargetId === targetId && (activeTool === 'brush' || activeTool === 'eraser') && (
            <div className="grid grid-cols-2 gap-2">
              <Stepper
                label={t('designer_cutout_brush_size', 'Brush size')}
                min={1}
                max={500}
                value={Number(options.size ?? (activeTool === 'brush' ? 24 : 32))}
                onChange={(value) => store.getState().setToolOption(activeTool, 'size', value)}
              />
              <Stepper
                label={t('designer_cutout_brush_hardness', 'Brush hardness')}
                min={0}
                max={100}
                value={Number(options.hardness ?? 80)}
                onChange={(value) => store.getState().setToolOption(activeTool, 'hardness', value)}
              />
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                updateCutoutTarget(store, targetId, { maskEnabled: target.maskEnabled === false });
                store.getState().pushHistory('Toggle cutout mask');
              }}
              className="px-3 py-2 rounded-sm border border-studioBorder text-[12px] text-textColor hover:bg-boxHover"
            >
              {target.maskEnabled === false
                ? t('designer_cutout_show_cutout', 'Show cutout')
                : t('designer_cutout_show_original', 'Show original')}
            </button>
            <button
              type="button"
              onClick={() => finishCutoutRefinement(store)}
              className="px-3 py-2 rounded-sm border border-studioBorder text-[12px] text-textColor hover:bg-boxHover"
            >
              {t('designer_cutout_done', 'Done')}
            </button>
          </div>
        </>
      )}
      {error && <div role="alert" className="text-[11px] text-dangerText">{error}</div>}
    </div>
  );
};
