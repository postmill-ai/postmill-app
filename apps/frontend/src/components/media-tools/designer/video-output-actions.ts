import type { VideoClip, VideoOutput } from './designer.store';
import {
  sourceTimeForClipTime,
  splitSpeedCurveForClip,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/speed-curve';
import { genId } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.migrate';
import { withCaptionClips } from './captions';

type StoreApi = ReturnType<typeof import('./designer.store').createDesignerStore>;

export const freezeFrameAt = (
  store: StoreApi,
  outputIndex: number,
  trackId: string,
  clipId: string
): boolean => {
  const state = store.getState();
  const output = state.doc.outputs[outputIndex] as VideoOutput | undefined;
  if (!output) return false;
  const track = output.tracks.find((candidate) => candidate.id === trackId);
  const clipIndex = track?.clips.findIndex((clip) => clip.id === clipId);
  if (clipIndex == null || clipIndex < 0 || !track) return false;

  const original = track.clips[clipIndex];
  const freezeDuration = 2000;
  const splitPoint = Math.max(
    original.startMs + 100,
    Math.min(original.endMs - 100, state.playheadMs)
  );
  if (splitPoint <= original.startMs || splitPoint >= original.endMs) return false;

  (globalThis as any)._clipCounter = ((globalThis as any)._clipCounter || 0) + 1;
  const counter = (globalThis as any)._clipCounter;
  const curveSplit = splitSpeedCurveForClip(original, splitPoint - original.startMs);
  const frozenSourceMs = curveSplit
    ? sourceTimeForClipTime(original, splitPoint - original.startMs)
    : (original.trimInMs ?? 0) + (splitPoint - original.startMs);

  const first: VideoClip = {
    ...original,
    id: `el-${Date.now()}-${counter}`,
    endMs: splitPoint,
    ...(curveSplit
      ? { speedCurve: curveSplit.first.speedCurve, trimInMs: curveSplit.first.trimInMs }
      : {}),
  };
  const freeze: VideoClip = {
    id: `el-${Date.now()}-${counter + 1}`,
    startMs: splitPoint,
    endMs: splitPoint + freezeDuration,
    src: original.src,
    fileId: original.fileId,
    x: original.x,
    y: original.y,
    width: original.width,
    height: original.height,
    rotation: original.rotation,
    opacity: original.opacity,
    naturalWidth: original.naturalWidth,
    naturalHeight: original.naturalHeight,
    speed: 0,
    trimInMs: frozenSourceMs,
  };
  const second: VideoClip = {
    ...original,
    id: `el-${Date.now()}-${counter + 2}`,
    startMs: splitPoint + freezeDuration,
    ...(curveSplit
      ? { speedCurve: curveSplit.second.speedCurve, trimInMs: curveSplit.second.trimInMs }
      : { trimInMs: frozenSourceMs }),
  };

  const clips = [...track.clips];
  clips.splice(clipIndex, 1, first, freeze, second);
  return state.commitVideoOutput(outputIndex, {
    ...output,
    tracks: output.tracks.map((candidate) =>
      candidate.id === trackId ? { ...candidate, clips } : candidate
    ),
  }, 'Freeze frame');
};

export const commitCaptionClips = (
  store: StoreApi,
  outputIndex: number,
  clips: VideoClip[]
): boolean => {
  const state = store.getState();
  const output = state.doc.outputs[outputIndex] as VideoOutput;
  const updated = withCaptionClips(output, clips, genId);
  return state.commitVideoOutput(outputIndex, updated, 'Add captions');
};
