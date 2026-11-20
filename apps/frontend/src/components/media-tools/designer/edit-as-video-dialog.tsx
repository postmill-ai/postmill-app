'use client';

import React, { FC, useRef, useState } from 'react';
import { Button } from '@postmill-ai/react/form/button';
import { Input } from '@postmill-ai/react/form/input';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { runManualSave } from './manual-save';
import type { createDesignerStore } from './designer.store';
import type { DesignAutosave } from './designer-autosave';

type Store = ReturnType<typeof createDesignerStore>;

type ConversionFallback = {
  outputId: string;
  pageNumber: number;
  sourceIds: string[];
  sourceTypes: string[];
  reason: string;
};

type ConversionSummary = {
  outputs: {
    outputId: string;
    name: string;
    pageCount: number;
    pageDurationMs: number;
    durationMs: number;
    hiddenLayerCount: number;
    fallbacks: ConversionFallback[];
  }[];
  totalPages: number;
  totalFallbacks: number;
};

type ConvertedDesign = {
  id: string;
  name: string;
  doc: ReturnType<Store['getState']>['doc'];
};

interface EditAsVideoDialogProps {
  store: Store;
  designAutosave: DesignAutosave;
  fetchFn: (url: string, init?: RequestInit) => Promise<Response>;
  onConverted: (design: ConvertedDesign) => void;
  onClose: () => void;
}

const makeIdempotencyKey = () => {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {}
  return `edit-video-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

export const EditAsVideoDialog: FC<EditAsVideoDialogProps> = ({
  store,
  designAutosave,
  fetchFn,
  onConverted,
  onClose,
}) => {
  const t = useT();
  const idempotencyKey = useRef(makeIdempotencyKey()).current;
  const pendingRef = useRef(false);
  const [seconds, setSeconds] = useState('5');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState<ConversionSummary | null>(null);
  const state = store.getState();
  const variantCount = state.doc.outputs.length;
  const pageCount = state.doc.outputs.reduce(
    (total, output) => total + 1 + ('pages' in output ? output.pages?.length ?? 0 : 0),
    0,
  );

  const convert = async () => {
    if (pendingRef.current) return;
    const durationSeconds = Number(seconds);
    const pageDurationMs = Math.round(durationSeconds * 1000);
    if (
      !Number.isFinite(durationSeconds) ||
      pageDurationMs < 100 ||
      pageDurationMs > 180000
    ) {
      setError(t('edit_as_video_invalid_duration', 'Enter a page duration between 0.1 and 180 seconds.'));
      return;
    }
    if (state.doc.outputs.some((output) =>
      (1 + ('pages' in output ? output.pages?.length ?? 0 : 0)) * pageDurationMs > 180000
    )) {
      setError(t('edit_as_video_duration_overflow', 'The selected duration makes at least one variant longer than 180 seconds. Choose a shorter page duration.'));
      return;
    }

    pendingRef.current = true;
    setPending(true);
    setError('');
    try {
      const saved = await runManualSave(store, designAutosave);
      if (saved !== 'persisted') {
        throw new Error(t('edit_as_video_save_failed', 'Save the current design before converting it. Your source was not converted.'));
      }
      const sourceId = store.getState().designId;
      if (!sourceId) {
        throw new Error(t('edit_as_video_save_failed', 'Save the current design before converting it. Your source was not converted.'));
      }
      const response = await fetchFn(`/media/designs/${sourceId}/convert-to-video`, {
        method: 'POST',
        headers: { 'X-Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ pageDurationMs }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const message = Array.isArray(data?.message) ? data.message.join(' ') : data?.message;
        throw new Error(message || t('edit_as_video_failed', 'Could not create the video design. Your source remains open and unchanged by the conversion.'));
      }
      onConverted(data.design as ConvertedDesign);
      setSummary(data.summary as ConversionSummary);
    } catch (caught) {
      setError(caught instanceof Error
        ? caught.message
        : t('edit_as_video_failed', 'Could not create the video design. Your source remains open and unchanged by the conversion.'));
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-[16px] text-textColor">
      {summary ? (
        <>
          <div className="flex flex-col gap-[6px]">
            <h3 className="text-[18px] font-[600]">
              {t('edit_as_video_ready', 'Your video design is ready')}
            </h3>
            <p className="text-[14px] text-newTextColor/70">
              {t(
                'edit_as_video_ready_summary',
                '{{pages}} scenes across {{variants}} variants. The original static design remains separate.',
                { pages: summary.totalPages, variants: summary.outputs.length },
              )}
            </p>
          </div>
          <div className="flex max-h-[320px] flex-col gap-[12px] overflow-y-auto rounded-[12px] border border-newTableBorder bg-newBgColorInner p-[12px]">
            {summary.outputs.map((output) => (
              <div key={output.outputId} className="flex flex-col gap-[4px] text-[13px]">
                <div className="font-[600]">{output.name}</div>
                <div className="text-newTextColor/70">
                  {t(
                    'edit_as_video_output_timing',
                    '{{pages}} scenes × {{seconds}}s = {{total}}s',
                    {
                      pages: output.pageCount,
                      seconds: output.pageDurationMs / 1000,
                      total: output.durationMs / 1000,
                    },
                  )}
                </div>
                {output.hiddenLayerCount > 0 && (
                  <div className="text-newTextColor/70">
                    {t('edit_as_video_hidden_retained', '{{count}} hidden layers retained on hidden tracks.', { count: output.hiddenLayerCount })}
                  </div>
                )}
                {output.fallbacks.map((fallback, index) => (
                  <div key={`${fallback.outputId}-${fallback.pageNumber}-${index}`} className="text-newTextColor/70">
                    {t(
                      'edit_as_video_fallback_item',
                      'Scene {{scene}}: {{types}} rasterized ({{reason}}); {{count}} source layers affected.',
                      {
                        scene: fallback.pageNumber + 1,
                        types: fallback.sourceTypes.join(', '),
                        reason: fallback.reason,
                        count: fallback.sourceIds.length,
                      },
                    )}
                  </div>
                ))}
              </div>
            ))}
            {summary.totalFallbacks === 0 && (
              <p className="text-[13px] text-newTextColor/70">
                {t('edit_as_video_all_editable', 'All supported content remains editable. No raster fallbacks were needed.')}
              </p>
            )}
          </div>
          <div className="flex justify-end">
            <Button onClick={onClose}>{t('edit_as_video_done', 'Done')}</Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-[14px] text-newTextColor/70">
            {t(
              'edit_as_video_description',
              'Create a new editable video design from {{variants}} variants and {{pages}} pages. Each page becomes one scene. Your static original stays separate.',
              { variants: variantCount, pages: pageCount },
            )}
          </p>
          <Input
            disableForm
            name="pageDurationSeconds"
            label={t('edit_as_video_page_duration', 'Page duration (seconds)')}
            aria-label={t('edit_as_video_page_duration', 'Page duration (seconds)')}
            type="number"
            min="0.1"
            max="180"
            step="0.1"
            value={seconds}
            disabled={pending}
            removeError
            onChange={(event) => setSeconds(event.target.value)}
          />
          <p className="text-[13px] text-newTextColor/70">
            {t('edit_as_video_fallback_notice', 'Unsupported effects are preserved as internal raster assets and listed in the conversion summary. Hidden layers remain hidden and editable.')}
          </p>
          {error && <div role="alert" className="text-[13px] text-dangerText">{error}</div>}
          <div className="flex justify-end gap-[8px]">
            <Button secondary onClick={onClose} disabled={pending}>
              {t('cancel', 'Cancel')}
            </Button>
            <Button loading={pending} onClick={convert}>
              {t('edit_as_video_convert', 'Create video design')}
            </Button>
          </div>
        </>
      )}
    </div>
  );
};
