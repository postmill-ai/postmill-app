'use client';

import React, { FC, useCallback } from 'react';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { useToaster } from '@postmill-ai/react/toaster/toaster';
import { MAX_VIDEO_DURATION_MS } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.limits';
import type { VideoOutput } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.schema';
import {
  DeleteLayerIcon,
  DuplicateClipIcon,
  SplitClipIcon,
} from '@postmill-ai/frontend/components/ui/icons/designer-tools';
import { Stepper } from './controls';
import { canSplitClipAt } from './timeline-split';

type Store = ReturnType<typeof import('./designer.store').createDesignerStore>;

export const TimelineTransportControls: FC<{
  store: Store;
  outputIndex: number;
}> = ({ store, outputIndex }) => {
  const t = useT();
  const toaster = useToaster();
  const output = store((state) => state.doc.outputs[outputIndex] as VideoOutput | undefined);
  const selectedClip = store((state) => state.selectedClip);
  const playheadMs = store((state) => state.playheadMs);
  const selected = selectedClip?.outputIndex === outputIndex ? selectedClip : null;
  const splitEnabled = !!selected && canSplitClipAt(output, selected.trackId, selected.clipId, playheadMs);
  const selectedTrack = selected
    ? output?.tracks.find((track) => track.id === selected.trackId)
    : undefined;

  const split = useCallback(() => {
    const state = store.getState();
    const target = state.selectedClip;
    const current = state.doc.outputs[outputIndex] as VideoOutput | undefined;
    if (!target || target.outputIndex !== outputIndex ||
      !canSplitClipAt(current, target.trackId, target.clipId, state.playheadMs)) return;
    state.splitClip(outputIndex, target.trackId, target.clipId, state.playheadMs);
  }, [store, outputIndex]);

  const duplicate = useCallback(() => {
    const state = store.getState();
    const target = state.selectedClip;
    if (!target || target.outputIndex !== outputIndex) return;
    const id = state.duplicateClip(outputIndex, target.trackId, target.clipId);
    if (!id) {
      toaster.show(
        t('no_room_to_duplicate_clip', 'No room to duplicate — the timeline is at the 180 s limit'),
        'warning'
      );
    }
  }, [store, outputIndex, toaster, t]);

  const remove = useCallback(() => {
    const state = store.getState();
    const refs = state.selectedClips.length
      ? state.selectedClips
      : state.selectedClip?.outputIndex === outputIndex
        ? [{ trackId: state.selectedClip.trackId, clipId: state.selectedClip.clipId }]
        : [];
    if (refs.length) state.removeClips(outputIndex, refs);
  }, [store, outputIndex]);

  return (
    <div className="flex items-center gap-1" role="group" aria-label={t('designer_clip_editing', 'Clip editing')}>
      <button
        type="button"
        onClick={split}
        disabled={!splitEnabled}
        title={t('designer_split_clip_hint', 'Split the selected clip at the playhead (S)')}
        aria-label={t('designer_split_clip', 'Split clip')}
        className="w-7 h-7 flex items-center justify-center rounded-sm text-textColor/70 hover:text-textColor hover:bg-studioBorder/30 disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <SplitClipIcon size={16} />
      </button>
      <button
        type="button"
        onClick={duplicate}
        disabled={!selected || !!selectedTrack?.locked}
        title={t('designer_duplicate_clip_hint', 'Duplicate the selected clip')}
        aria-label={t('designer_duplicate_clip', 'Duplicate clip')}
        className="w-7 h-7 flex items-center justify-center rounded-sm text-textColor/70 hover:text-textColor hover:bg-studioBorder/30 disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <DuplicateClipIcon size={16} />
      </button>
      <button
        type="button"
        onClick={remove}
        disabled={!selected}
        title={t('designer_delete_clip_hint', 'Delete the selected clip or clips')}
        aria-label={t('designer_delete_clip', 'Delete clip')}
        className="w-7 h-7 flex items-center justify-center rounded-sm text-textColor/70 hover:text-dangerText hover:bg-studioBorder/30 disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <DeleteLayerIcon size={16} />
      </button>
      <Stepper
        compact
        label={t('designer_duration_seconds', 'Duration (seconds)')}
        min={1}
        max={MAX_VIDEO_DURATION_MS / 1000}
        value={Math.round((output?.durationMs ?? 1000) / 1000)}
        onChange={(seconds) => store.getState().setVideoDuration(outputIndex, seconds * 1000)}
      />
    </div>
  );
};
