import type { MotionPath, MotionPathPoint, VideoClip } from './designer-doc.schema';
import { MAX_DIMENSION, MAX_VIDEO_DURATION_MS, MAX_MOTION_PATH_POINTS } from './designer-doc.limits';
import { applyEasePreset, interpolateClipKeyframes, type InterpolatedProps } from './keyframes';

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

// Injected functions must not read an imported binding: transpilers rewrite it
// to a module reference that does not exist in the frame page.
const POINT_CAP = MAX_MOTION_PATH_POINTS;

const usablePoints = (path?: MotionPath): MotionPathPoint[] =>
  (path?.points ?? [])
    .filter((point) =>
      Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.tMs)
    )
    .slice(0, POINT_CAP)
    .map((point, index) => ({ ...point, order: index }))
    .sort((a, b) => a.tMs - b.tMs || a.order - b.order)
    .map(({ order: _order, ...point }) => point);

const segmentAngle = (from: MotionPathPoint, to: MotionPathPoint): number => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return dx === 0 && dy === 0 ? 0 : Math.atan2(dy, dx) * 180 / Math.PI;
};

const firstAngle = (points: MotionPathPoint[]): number => {
  for (let index = 0; index < points.length - 1; index++) {
    const angle = segmentAngle(points[index], points[index + 1]);
    if (angle !== 0 || points[index].x !== points[index + 1].x || points[index].y !== points[index + 1].y) {
      return angle;
    }
  }
  return 0;
};

const normalizeAngleDelta = (angle: number): number =>
  ((angle + 180) % 360 + 360) % 360 - 180;

export const motionPathPointAt = (
  path: MotionPath | undefined,
  relativeMs: number,
  durationMs: number
): MotionPathPoint & { angle: number } => {
  const points = usablePoints(path);
  if (!points.length) return { x: 0, y: 0, tMs: 0, angle: 0 };
  const duration = Math.max(0, path?.timeDurationMs ?? durationMs);
  const offset = Math.max(0, path?.timeOffsetMs ?? 0);
  const rawTime = clamp(relativeMs + offset, 0, duration);
  const time = duration > 0
    ? applyEasePreset(rawTime / duration, path?.ease) * duration
    : 0;
  if (points.length === 1) return { ...points[0], angle: 0 };
  if (time <= points[0].tMs) return { ...points[0], angle: firstAngle(points) };
  const last = points[points.length - 1];
  if (time >= last.tMs) {
    return { ...last, angle: segmentAngle(points[points.length - 2], last) };
  }
  for (let index = 0; index < points.length - 1; index++) {
    const from = points[index];
    const to = points[index + 1];
    if (time < from.tMs || time > to.tMs) continue;
    const range = to.tMs - from.tMs;
    const progress = range > 0 ? (time - from.tMs) / range : 0;
    return {
      x: from.x + (to.x - from.x) * progress,
      y: from.y + (to.y - from.y) * progress,
      tMs: time,
      angle: segmentAngle(from, to),
    };
  }
  return { ...last, angle: segmentAngle(points[points.length - 2], last) };
};

export const motionPathDisplacement = (
  path: MotionPath | undefined,
  relativeMs: number,
  durationMs: number
): { x: number; y: number; rotation: number } => {
  const points = usablePoints(path);
  if (points.length < 2) return { x: 0, y: 0, rotation: 0 };
  const point = motionPathPointAt(path, relativeMs, durationMs);
  const angle = relativeMs <= 0 && path?.startAngle !== undefined
    ? path.startAngle
    : point.angle;
  return {
    x: (path?.startDx ?? 0) + point.x - points[0].x,
    y: (path?.startDy ?? 0) + point.y - points[0].y,
    rotation: path?.followRotation
      ? (path.startRotation ?? 0) + normalizeAngleDelta(angle - (path.startAngle ?? firstAngle(points)))
      : 0,
  };
};

export const interpolateClipWithMotionPath = (
  clip: VideoClip,
  relativeMs: number
): InterpolatedProps => {
  const base = interpolateClipKeyframes(clip, relativeMs);
  const displacement = motionPathDisplacement(
    clip.motionPath,
    relativeMs,
    Math.max(0, clip.endMs - clip.startMs)
  );
  return {
    ...base,
    x: base.x + displacement.x,
    y: base.y + displacement.y,
    rotation: base.rotation + displacement.rotation,
  };
};

export const translateMotionPath = (
  path: MotionPath | undefined,
  dx: number,
  dy: number
): MotionPath | undefined => path ? {
  ...path,
  points: path.points.map((point) => ({ ...point, x: point.x + dx, y: point.y + dy })),
} : undefined;

export const scaleMotionPath = (
  path: MotionPath | undefined,
  scaleX: number,
  scaleY: number
): MotionPath | undefined => path ? {
  ...path,
  startDx: path.startDx === undefined ? undefined : path.startDx * scaleX,
  startDy: path.startDy === undefined ? undefined : path.startDy * scaleY,
  points: path.points.map((point) => ({
    ...point,
    x: point.x * scaleX,
    y: point.y * scaleY,
  })),
} : undefined;

export const rescaleMotionPathTimes = (
  path: MotionPath | undefined,
  previousDurationMs: number,
  nextDurationMs: number
): MotionPath | undefined => {
  if (!path || previousDurationMs === nextDurationMs) return path;
  if (previousDurationMs <= 0) {
    return { ...path, points: path.points.map((point) => ({ ...point, tMs: 0 })) };
  }
  const ratio = Math.max(0, nextDurationMs) / previousDurationMs;
  return {
    ...path,
    ...(path.timeOffsetMs !== undefined
      ? { timeOffsetMs: clamp(Math.round(path.timeOffsetMs * ratio), 0, MAX_VIDEO_DURATION_MS) }
      : {}),
    ...(path.timeDurationMs !== undefined
      ? { timeDurationMs: clamp(Math.round(path.timeDurationMs * ratio), 0, MAX_VIDEO_DURATION_MS) }
      : {}),
    points: path.points.map((point) => ({
      ...point,
      tMs: clamp(Math.round(point.tMs * ratio), 0, MAX_VIDEO_DURATION_MS),
    })),
  };
};

export const splitMotionPath = (
  path: MotionPath | undefined,
  cutMs: number,
  durationMs: number
): { first: MotionPath | undefined; second: MotionPath | undefined } => {
  if (!path) return { first: undefined, second: undefined };
  const cut = clamp(cutMs, 0, durationMs);
  const timeOffset = Math.max(0, path.timeOffsetMs ?? 0);
  const timeDuration = Math.max(0, path.timeDurationMs ?? durationMs);
  const rawCut = clamp(timeOffset + cut, 0, timeDuration);
  const boundary = motionPathPointAt(path, cut, durationMs);
  const boundaryDisplacement = motionPathDisplacement(path, cut, durationMs);
  const firstPoints = [
    ...path.points.filter((point) => point.tMs < boundary.tMs),
    { x: boundary.x, y: boundary.y, tMs: boundary.tMs },
  ];
  const secondPoints = [
    { x: boundary.x, y: boundary.y, tMs: boundary.tMs },
    ...path.points.filter((point) => point.tMs > boundary.tMs),
  ];
  return {
    first: { ...path, points: firstPoints, timeDurationMs: timeDuration },
    second: {
      ...path,
      points: secondPoints,
      timeOffsetMs: rawCut,
      timeDurationMs: timeDuration,
      startDx: boundaryDisplacement.x,
      startDy: boundaryDisplacement.y,
      startRotation: path.followRotation ? boundaryDisplacement.rotation : undefined,
      startAngle: path.followRotation ? boundary.angle : undefined,
    },
  };
};

export const insertMotionPathPoint = (
  path: MotionPath,
  segmentIndex: number
): MotionPath => {
  if (path.points.length >= POINT_CAP || segmentIndex < 0 || segmentIndex >= path.points.length - 1) {
    return path;
  }
  const from = path.points[segmentIndex];
  const to = path.points[segmentIndex + 1];
  const point = {
    x: (from.x + to.x) / 2,
    y: (from.y + to.y) / 2,
    tMs: (from.tMs + to.tMs) / 2,
  };
  const points = [...path.points];
  points.splice(segmentIndex + 1, 0, point);
  return { ...path, points };
};

export const moveMotionPathPoint = (
  path: MotionPath,
  pointIndex: number,
  position: { x: number; y: number }
): MotionPath => {
  if (pointIndex < 0 || pointIndex >= path.points.length) return path;
  return {
    ...path,
    points: path.points.map((point, index) => index === pointIndex ? {
      ...point,
      x: clamp(position.x, -MAX_DIMENSION, MAX_DIMENSION),
      y: clamp(position.y, -MAX_DIMENSION, MAX_DIMENSION),
    } : point),
  };
};

export const deleteMotionPathPoint = (
  path: MotionPath,
  pointIndex: number
): MotionPath => {
  if (path.points.length <= 2 || pointIndex < 0 || pointIndex >= path.points.length) return path;
  return { ...path, points: path.points.filter((_, index) => index !== pointIndex) };
};

export const appendMotionPathPoint = (
  path: MotionPath,
  point: MotionPathPoint,
  durationMs: number
): MotionPath => {
  if (path.points.length >= POINT_CAP) return path;
  const next: MotionPathPoint = {
    x: clamp(point.x, -MAX_DIMENSION, MAX_DIMENSION),
    y: clamp(point.y, -MAX_DIMENSION, MAX_DIMENSION),
    tMs: clamp(point.tMs, 0, Math.min(durationMs, MAX_VIDEO_DURATION_MS)),
  };
  const last = path.points[path.points.length - 1];
  if (last && next.tMs === last.tMs) {
    return { ...path, points: [...path.points.slice(0, -1), next] };
  }
  if (last && next.tMs < last.tMs) return path;
  return { ...path, points: [...path.points, next] };
};

export const motionPathSource = (): string => {
  const decl = (name: string, value: unknown) => `const ${name} = ${String(value)};`;
  return [
    `const POINT_CAP = ${MAX_MOTION_PATH_POINTS};`,
    decl('clamp', clamp),
    decl('usablePoints', usablePoints),
    decl('segmentAngle', segmentAngle),
    decl('firstAngle', firstAngle),
    decl('normalizeAngleDelta', normalizeAngleDelta),
    decl('motionPathPointAt', motionPathPointAt),
    decl('motionPathDisplacement', motionPathDisplacement),
    decl('interpolateClipWithMotionPath', interpolateClipWithMotionPath),
  ].join('\n');
};
