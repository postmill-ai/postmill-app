'use client';

import React from 'react';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import type { VideoClip } from '../designer.store';

interface MotionPathControlsProps {
  store: any;
  outputIndex: number;
  trackId: string;
  clipId: string;
  clip: VideoClip;
  disabled: boolean;
}

export const MotionPathControls: React.FC<MotionPathControlsProps> = ({
  store,
  outputIndex,
  trackId,
  clipId,
  clip,
  disabled,
}) => {
  const t = useT();
  const recording = store((state: any) => state.motionPathRecording);
  const currentClip = store((state: any) => state.doc.outputs[outputIndex]?.tracks
    ?.find((track: any) => track.id === trackId)?.clips
    .find((item: VideoClip) => item.id === clipId)) ?? clip;
  const active = recording?.clipId === clipId && recording.trackId === trackId && recording.outputIndex === outputIndex;
  const path = currentClip.motionPath;
  const update = (motionPath: VideoClip['motionPath']) =>
    store.getState().updateClip(outputIndex, trackId, clipId, { motionPath });

  return (
    <section className="space-y-2 border-t border-studioBorder pt-2" aria-label={t('designer_motion_path', 'Motion Path')}>
      <div className="text-[11px] font-medium text-textColor/60">
        {t('designer_motion_path', 'Motion Path')}
      </div>
      <button
        type="button"
        disabled={disabled || (!!recording && !active)}
        onClick={() => active
          ? store.getState().cancelMotionPathRecording()
          : store.getState().startMotionPathRecording(outputIndex, trackId, clipId)}
        className="w-full rounded-sm border border-designerAccent/30 px-3 py-2 text-[12px] text-btnPrimaryAccent hover:bg-designerAccent/10 disabled:opacity-50"
      >
        {active
          ? t('designer_cancel_motion_recording', 'Cancel recording')
          : t('designer_record_motion_path', 'Record motion path')}
      </button>
      <div className="text-[10px] leading-relaxed text-textColor/50">
        {active
          ? t('designer_motion_recording_hint', 'Drag the clip around the canvas. Stop dragging to finish.')
          : t('designer_motion_edit_hint', 'Drag the clip to record. Drag points to edit; click a segment to insert; right-click a point to delete.')}
      </div>
      <label className="flex items-center justify-between gap-2 text-[11px] text-textColor/70">
        <span>{t('designer_path_easing', 'Path easing')}</span>
        <select
          aria-label={t('designer_path_easing', 'Path easing')}
          value={path?.ease ?? 'linear'}
          disabled={disabled || !path}
          onChange={(event) => path && update({ ...path, ease: event.target.value as NonNullable<VideoClip['motionPath']>['ease'] })}
          className="h-7 rounded-sm border border-studioBorder bg-newBgColor px-2 text-[11px] text-textColor disabled:opacity-40"
        >
          <option value="linear">{t('designer_ease_linear', 'Linear')}</option>
          <option value="easeInOut">{t('designer_ease_in_out', 'Ease In-Out')}</option>
          <option value="easeIn">{t('designer_ease_in', 'Ease In')}</option>
          <option value="easeOut">{t('designer_ease_out', 'Ease Out')}</option>
        </select>
      </label>
      <div className="flex items-center justify-between gap-2 text-[11px] text-textColor/70">
        <span>{t('designer_rotate_with_path', 'Rotate with path')}</span>
        <button
          type="button"
          role="switch"
          aria-checked={path?.followRotation === true}
          aria-label={t('designer_rotate_with_path', 'Rotate with path')}
          disabled={disabled || !path}
          onClick={() => path && update({ ...path, followRotation: !path.followRotation })}
          className={`relative h-[22px] w-[40px] rounded-full transition-colors disabled:opacity-40 ${path?.followRotation ? 'bg-designerAccent' : 'bg-studioBorder'}`}
        >
          <span className={`absolute top-[2px] h-[18px] w-[18px] rounded-full bg-white transition-transform ${path?.followRotation ? 'translate-x-[20px]' : 'translate-x-[2px]'}`} />
        </button>
      </div>
      {path && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => update(undefined)}
          className="w-full rounded-sm border border-studioBorder px-3 py-1.5 text-[11px] text-dangerText hover:bg-red-500/10 disabled:opacity-40"
        >
          {t('designer_delete_motion_path', 'Delete motion path')}
        </button>
      )}
    </section>
  );
};
