import type {
  MotionPath,
  TextReveal,
  VideoClip,
  VideoTrack,
} from './designer-doc.schema';
import type { KeyframeEase } from './keyframes';
import { MAX_DIMENSION, MAX_MOTION_PATH_POINTS, MAX_VIDEO_DURATION_MS } from './designer-doc.limits';
import { rescaleMotionPathTimes, translateMotionPath } from './motion-path';

export const ANIMATION_VISUAL_PROPS = [
  'x',
  'y',
  'width',
  'height',
  'rotation',
  'opacity',
  'fontSize',
] as const;

export type AnimationVisualProp = (typeof ANIMATION_VISUAL_PROPS)[number];
export type AnimationSkipReason =
  | 'audio'
  | 'unsupported-properties'
  | 'invalid-keyframes'
  | 'keyframe-limit'
  | 'invalid-base'
  | 'invalid-path'
  | 'font-size'
  | 'text-reveal'
  | 'audio-clip'
  | 'locked'
  | 'unknown'
  | 'unchanged'
  | 'no-compatible-animation';

export type AnimationKeyframe = NonNullable<VideoClip['keyframes']>[number];

export interface AnimationSnapshot {
  sourceType: VideoTrack['type'];
  durationMs: number;
  base: Pick<VideoClip, 'x' | 'y' | 'width' | 'height' | 'rotation' | 'fontSize'>;
  keyframes: AnimationKeyframe[];
  motionPath?: MotionPath;
  textReveal?: TextReveal;
  skipped: AnimationSkipReason[];
}

export type AnimationPatch = Pick<VideoClip, 'keyframes' | 'motionPath' | 'textReveal'>;

export interface AnimationTargetPlan {
  clipId: string;
  patch?: AnimationPatch;
  skipped: AnimationSkipReason[];
}

const visualProps = new Set<string>(ANIMATION_VISUAL_PROPS);
const textTypes = new Set<VideoTrack['type']>(['text', 'caption']);
const visualTypes = new Set<VideoTrack['type']>([
  'text',
  'caption',
  'shape',
  'image',
  'sticker',
  'raster',
  'video',
]);

const addSkip = (skipped: AnimationSkipReason[], reason: AnimationSkipReason) => {
  if (!skipped.includes(reason)) skipped.push(reason);
};

const cloneEase = (ease: KeyframeEase | undefined): KeyframeEase | undefined => {
  if (!ease || typeof ease === 'string') return ease;
  return {
    ...(ease.in ? { in: [...ease.in] as [number, number] } : {}),
    ...(ease.out ? { out: [...ease.out] as [number, number] } : {}),
  };
};

const cloneKeyframes = (keyframes: readonly AnimationKeyframe[]): AnimationKeyframe[] =>
  keyframes.map((keyframe) => ({
    ...keyframe,
    props: { ...keyframe.props },
    ...(keyframe.ease !== undefined ? { ease: cloneEase(keyframe.ease) } : {}),
  }));

const clonePath = (path: MotionPath): MotionPath => ({
  ...path,
  points: path.points.map((point) => ({ ...point })),
});

const finiteOr = (value: number | undefined, fallback: number) =>
  value === undefined ? fallback : value;

const validPath = (path: MotionPath | undefined): path is MotionPath => {
  if (!path || path.points.length < 2 || path.points.length > MAX_MOTION_PATH_POINTS) return false;
  const numericFields = [
    path.timeOffsetMs,
    path.timeDurationMs,
    path.startDx,
    path.startDy,
    path.startRotation,
    path.startAngle,
  ];
  return numericFields.every((value) => value === undefined || Number.isFinite(value)) &&
    path.points.every((point) =>
      Number.isFinite(point.x) && Number.isFinite(point.y) &&
      Number.isFinite(point.tMs) && point.tMs >= 0 &&
      point.tMs <= MAX_VIDEO_DURATION_MS &&
      Math.abs(point.x) <= MAX_DIMENSION && Math.abs(point.y) <= MAX_DIMENSION
    );
};

const pathCenter = (clip: Pick<VideoClip, 'x' | 'y' | 'width' | 'height'>) => {
  const x = finiteOr(clip.x, 0);
  const y = finiteOr(clip.y, 0);
  const width = finiteOr(clip.width, 1);
  const height = finiteOr(clip.height, 1);
  if (![x, y, width, height].every(Number.isFinite)) return undefined;
  return { x: x + width / 2, y: y + height / 2 };
};

const remapTime = (tMs: number, sourceDurationMs: number, targetDurationMs: number) =>
  Math.max(0, Math.min(targetDurationMs, Math.round(tMs * targetDurationMs / sourceDurationMs)));

const remapProp = (
  prop: AnimationVisualProp,
  value: number,
  source: AnimationSnapshot,
  target: VideoClip
): number | undefined => {
  if (!Number.isFinite(value)) return undefined;
  if (prop === 'opacity') return value;
  const defaults: Record<Exclude<AnimationVisualProp, 'opacity'>, number> = {
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    rotation: 0,
    fontSize: 16,
  };
  const sourceBase = finiteOr(source.base[prop], defaults[prop]);
  const targetBase = finiteOr(target[prop], defaults[prop]);
  if (!Number.isFinite(sourceBase) || !Number.isFinite(targetBase)) return undefined;
  if (prop === 'x' || prop === 'y' || prop === 'rotation') {
    const remapped = targetBase + value - sourceBase;
    return Number.isFinite(remapped) ? remapped : undefined;
  }
  if (sourceBase === 0) return undefined;
  const remapped = targetBase * value / sourceBase;
  return Number.isFinite(remapped) ? remapped : undefined;
};

const remappedKeyframes = (
  snapshot: AnimationSnapshot,
  target: VideoClip,
  targetType: VideoTrack['type'],
  targetDurationMs: number,
  skipped: AnimationSkipReason[]
): AnimationKeyframe[] => {
  const output = snapshot.keyframes.map((keyframe) => {
    const props: Record<string, number> = {};
    for (const [prop, value] of Object.entries(keyframe.props) as [AnimationVisualProp, number][]) {
      if (prop === 'fontSize' && !textTypes.has(targetType)) {
        addSkip(skipped, 'font-size');
        continue;
      }
      const remapped = remapProp(prop, value, snapshot, target);
      if (remapped === undefined) addSkip(skipped, 'invalid-base');
      else props[prop] = remapped;
    }
    return {
      tMs: remapTime(keyframe.tMs, snapshot.durationMs, targetDurationMs),
      props,
      ...(keyframe.ease !== undefined ? { ease: cloneEase(keyframe.ease) } : {}),
    };
  }).filter((keyframe) => Object.keys(keyframe.props).length > 0);
  return output;
};

const remappedPath = (
  snapshot: AnimationSnapshot,
  target: VideoClip,
  targetDurationMs: number,
  skipped: AnimationSkipReason[]
): MotionPath | undefined => {
  if (!snapshot.motionPath) return undefined;
  const sourceCenter = pathCenter(snapshot.base);
  const targetCenter = pathCenter(target);
  if (!sourceCenter || !targetCenter) {
    addSkip(skipped, 'invalid-base');
    return undefined;
  }
  return rescaleMotionPathTimes(
    translateMotionPath(
      clonePath(snapshot.motionPath),
      targetCenter.x - sourceCenter.x,
      targetCenter.y - sourceCenter.y
    ),
    snapshot.durationMs,
    targetDurationMs
  );
};

const remappedReveal = (
  snapshot: AnimationSnapshot,
  targetType: VideoTrack['type'],
  targetDurationMs: number,
  skipped: AnimationSkipReason[]
): TextReveal | undefined => {
  if (!snapshot.textReveal) return undefined;
  if (targetType !== 'text') {
    addSkip(skipped, 'text-reveal');
    return undefined;
  }
  return {
    ...snapshot.textReveal,
    ...(snapshot.textReveal.durationMs !== undefined
      ? {
          durationMs: snapshot.textReveal.durationMs > 0
            ? remapTime(snapshot.textReveal.durationMs, snapshot.durationMs, targetDurationMs)
            : 0,
        }
      : {}),
  };
};

const preserveVolumeKeyframes = (
  target: VideoClip,
  incoming: AnimationKeyframe[]
): AnimationKeyframe[] | undefined => {
  const volume = (target.keyframes ?? [])
    .filter((keyframe) => keyframe.props.volume !== undefined)
    .map((keyframe) => ({
      tMs: keyframe.tMs,
      props: { volume: keyframe.props.volume },
      ...(keyframe.ease !== undefined ? { ease: cloneEase(keyframe.ease) } : {}),
    }));
  const merged = cloneKeyframes(incoming);
  for (const keyframe of volume) {
    const existing = merged.find((candidate) => candidate.tMs === keyframe.tMs);
    if (existing) {
      existing.props = { ...existing.props, ...keyframe.props };
      if (keyframe.ease !== undefined) existing.ease = keyframe.ease;
    } else {
      merged.push(keyframe);
    }
  }
  const output = merged.sort((a, b) => a.tMs - b.tMs);
  return output.length ? output : undefined;
};

export const hasSupportedAnimation = (
  track: Pick<VideoTrack, 'type'>,
  clip: VideoClip
): boolean => {
  if (!visualTypes.has(track.type)) return false;
  if (track.type === 'text' && clip.textReveal) return true;
  if (validPath(clip.motionPath)) return true;
  return (clip.keyframes ?? []).some((keyframe) =>
    Number.isFinite(keyframe.tMs) && Object.entries(keyframe.props).some(([prop, value]) =>
      visualProps.has(prop) && Number.isFinite(value)
    )
  );
};

export const snapshotAnimation = (
  track: Pick<VideoTrack, 'type'>,
  clip: VideoClip
): { snapshot: AnimationSnapshot | null; skipped: AnimationSkipReason[] } => {
  const skipped: AnimationSkipReason[] = [];
  if (!visualTypes.has(track.type)) {
    return { snapshot: null, skipped: ['audio-clip'] };
  }
  const durationMs = clip.endMs - clip.startMs;
  if (!(durationMs > 0) || !Number.isFinite(durationMs)) {
    return { snapshot: null, skipped: ['invalid-keyframes'] };
  }

  const keyframes: AnimationKeyframe[] = [];
  for (const keyframe of clip.keyframes ?? []) {
    const props: Record<string, number> = {};
    let invalid = !Number.isFinite(keyframe.tMs);
    for (const [prop, value] of Object.entries(keyframe.props)) {
      if (prop === 'volume') {
        addSkip(skipped, 'audio');
        continue;
      }
      if (!visualProps.has(prop)) {
        addSkip(skipped, 'unsupported-properties');
        continue;
      }
      if (!Number.isFinite(value)) invalid = true;
      else props[prop as AnimationVisualProp] = value;
    }
    if (invalid) addSkip(skipped, 'invalid-keyframes');
    if (!invalid && Object.keys(props).length) {
      keyframes.push({
        tMs: keyframe.tMs,
        props,
        ...(keyframe.ease !== undefined ? { ease: cloneEase(keyframe.ease) } : {}),
      });
    }
  }

  let motionPath: MotionPath | undefined;
  if (clip.motionPath) {
    if (validPath(clip.motionPath)) motionPath = clonePath(clip.motionPath);
    else addSkip(skipped, 'invalid-path');
  }
  const textReveal = track.type === 'text' && clip.textReveal
    ? { ...clip.textReveal }
    : undefined;

  if (!keyframes.length && !motionPath && !textReveal) {
    return { snapshot: null, skipped };
  }
  return {
    snapshot: {
      sourceType: track.type,
      durationMs,
      base: {
        x: clip.x,
        y: clip.y,
        width: clip.width,
        height: clip.height,
        rotation: clip.rotation,
        fontSize: clip.fontSize,
      },
      keyframes,
      motionPath,
      textReveal,
      skipped: [...skipped],
    },
    skipped,
  };
};

export const planAnimationPaste = (
  snapshot: AnimationSnapshot,
  targets: readonly { track: Pick<VideoTrack, 'type'>; clip: VideoClip }[]
): AnimationTargetPlan[] => targets.map(({ track, clip }) => {
  const skipped: AnimationSkipReason[] = [];
  if (!visualTypes.has(track.type)) {
    return { clipId: clip.id, skipped: ['audio-clip', 'no-compatible-animation'] };
  }
  const targetDurationMs = clip.endMs - clip.startMs;
  if (!(targetDurationMs > 0) || !Number.isFinite(targetDurationMs)) {
    return { clipId: clip.id, skipped: ['invalid-keyframes', 'no-compatible-animation'] };
  }

  const keyframes = remappedKeyframes(snapshot, clip, track.type, targetDurationMs, skipped);
  const motionPath = remappedPath(snapshot, clip, targetDurationMs, skipped);
  const textReveal = remappedReveal(snapshot, track.type, targetDurationMs, skipped);
  const hasCompatibleChannel = Boolean(
    snapshot.motionPath && motionPath ||
    snapshot.textReveal && textReveal ||
    keyframes.some((keyframe) => Object.keys(keyframe.props).some((prop) => prop !== 'volume'))
  );
  if (!hasCompatibleChannel) {
    addSkip(skipped, 'no-compatible-animation');
    return { clipId: clip.id, skipped };
  }
  const preservedKeyframes = preserveVolumeKeyframes(clip, keyframes);
  if ((preservedKeyframes?.length ?? 0) > 1000) {
    addSkip(skipped, 'keyframe-limit');
    addSkip(skipped, 'no-compatible-animation');
    return { clipId: clip.id, skipped };
  }
  return {
    clipId: clip.id,
    patch: {
      keyframes: preservedKeyframes,
      motionPath,
      textReveal,
    },
    skipped,
  };
});
