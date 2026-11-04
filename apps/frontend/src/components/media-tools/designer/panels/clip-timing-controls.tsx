'use client';

import React, { FC } from 'react';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import type { VideoClip, VideoTrack } from '../designer.store';
import { Stepper } from '../controls';
import { clipTimingTrackOptions, clipTimingUpdate, type ClipTimingField } from '../clip-timing';
import { getSourceDurationMs } from '../clip-source-duration';

interface ClipTimingControlsProps {
  clip: VideoClip;
  trackType: VideoTrack['type'];
  outputDurationMs: number;
  onChange: (update: { startMs: number; endMs: number; trimInMs?: number }) => void;
  onCommit: () => void;
  disabled?: boolean;
}

export const ClipTimingControls: FC<ClipTimingControlsProps> = ({
  clip,
  trackType,
  outputDurationMs,
  onChange,
  onCommit,
  disabled = false,
}) => {
  const t = useT();
  const hasSourceWindow = trackType === 'video' || trackType === 'audio';
  const sourceDurationMs = hasSourceWindow && clip.src
    ? getSourceDurationMs(clip.src, trackType)
    : undefined;
  const update = (field: ClipTimingField, seconds: number) => {
    onChange(clipTimingUpdate(
      clip,
      field,
      Math.round(seconds * 1000),
      clipTimingTrackOptions(trackType, sourceDurationMs, outputDurationMs)
    ));
  };
  const durationMs = clip.endMs - clip.startMs;
  const seconds = (ms: number) => Number((ms / 1000).toFixed(2));

  return (
    <div className="space-y-2" aria-label={t('designer_clip_timing', 'Clip timing')}>
      <div className="text-[12px] font-medium text-textColor/70">
        {t('designer_clip_timing', 'Clip timing')}
      </div>
      <fieldset disabled={disabled} className="grid grid-cols-3 gap-2 disabled:opacity-50">
        <Stepper
          label={t('designer_clip_start_seconds', 'Start (s)')}
          min={0}
          max={seconds(outputDurationMs - durationMs)}
          step={0.1}
          value={seconds(clip.startMs)}
          onChange={(value) => update('start', value)}
          onCommit={onCommit}
        />
        <Stepper
          label={t('designer_clip_end_seconds', 'End (s)')}
          min={0.1}
          max={seconds(outputDurationMs)}
          step={0.1}
          value={seconds(clip.endMs)}
          onChange={(value) => update('end', value)}
          onCommit={onCommit}
        />
        <Stepper
          label={t('designer_clip_duration_seconds', 'Duration (s)')}
          min={0.1}
          max={seconds(outputDurationMs)}
          step={0.1}
          value={seconds(durationMs)}
          onChange={(value) => update('duration', value)}
          onCommit={onCommit}
        />
      </fieldset>
    </div>
  );
};
