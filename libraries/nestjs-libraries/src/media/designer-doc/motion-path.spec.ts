import { describe, expect, it } from 'vitest';
import type { MotionPath, VideoClip } from './designer-doc.schema';
import {
  appendMotionPathPoint,
  deleteMotionPathPoint,
  insertMotionPathPoint,
  interpolateClipWithMotionPath,
  motionPathDisplacement,
  motionPathPointAt,
  motionPathSource,
  moveMotionPathPoint,
  rescaleMotionPathTimes,
  scaleMotionPath,
  splitMotionPath,
  translateMotionPath,
} from './motion-path';
import { keyframesSource } from './keyframes';
import { stripExportsNamespace } from '../design-render/frame-renderer-script';
import { MAX_DIMENSION, MAX_MOTION_PATH_POINTS } from './designer-doc.limits';

const path: MotionPath = {
  points: [
    { x: 0, y: 0, tMs: 0 },
    { x: 100, y: 0, tMs: 500 },
    { x: 100, y: 100, tMs: 1000 },
  ],
};

describe('motion path evaluation', () => {
  it('samples timestamped multi-point paths deterministically at arbitrary times', () => {
    expect(motionPathPointAt(path, 250, 1000)).toMatchObject({ x: 50, y: 0, angle: 0 });
    expect(motionPathPointAt(path, 750, 1000)).toMatchObject({ x: 100, y: 50, angle: 90 });
    expect(motionPathPointAt(path, -100, 1000)).toMatchObject({ x: 0, y: 0 });
    expect(motionPathPointAt(path, 2000, 1000)).toMatchObject({ x: 100, y: 100 });
    expect(motionPathDisplacement(path, 750, 1000)).toEqual({ x: 100, y: 50, rotation: 0 });
  });

  it('applies the shared easing presets to overall path progress', () => {
    expect(motionPathPointAt({ ...path, ease: 'easeIn' }, 500, 1000)).toMatchObject({ x: 50, y: 0 });
    expect(motionPathPointAt({ ...path, ease: 'easeOut' }, 500, 1000)).toMatchObject({ x: 100, y: 50 });
    expect(motionPathPointAt({ ...path, ease: 'easeInOut' }, 500, 1000)).toMatchObject({ x: 100, y: 0 });
  });

  it('adds displacement to existing keyframes without an opening jump', () => {
    const clip: VideoClip = {
      id: 'clip', startMs: 100, endMs: 1100, x: 10, y: 20, rotation: 5,
      keyframes: [
        { tMs: 0, props: { x: 10, y: 20, rotation: 5 } },
        { tMs: 1000, props: { x: 30, y: 40, rotation: 15 } },
      ],
      motionPath: {
        points: [{ x: 50, y: 50, tMs: 0 }, { x: 70, y: 80, tMs: 1000 }],
      },
    };
    expect(interpolateClipWithMotionPath(clip, 0)).toMatchObject({ x: 10, y: 20, rotation: 5 });
    expect(interpolateClipWithMotionPath(clip, 500)).toMatchObject({ x: 30, y: 45, rotation: 10 });
    expect(interpolateClipWithMotionPath(clip, 1000)).toMatchObject({ x: 50, y: 70, rotation: 15 });
  });

  it('uses normalized tangent deltas only when follow rotation is enabled', () => {
    const turning: MotionPath = {
      followRotation: true,
      points: [{ x: 0, y: 0, tMs: 0 }, { x: 100, y: 0, tMs: 500 }, { x: 100, y: 100, tMs: 1000 }],
    };
    expect(motionPathDisplacement(turning, 0, 1000).rotation).toBe(0);
    expect(motionPathDisplacement(turning, 1000, 1000).rotation).toBe(90);
    expect(motionPathDisplacement({ ...turning, followRotation: false }, 1000, 1000).rotation).toBe(0);
  });

  it('keeps malformed, unsorted, and short paths safe and deterministic', () => {
    expect(motionPathDisplacement(undefined, 100, 1000)).toEqual({ x: 0, y: 0, rotation: 0 });
    expect(motionPathDisplacement({ points: [{ x: 5, y: 5, tMs: 0 }] }, 100, 1000)).toEqual({ x: 0, y: 0, rotation: 0 });
    const unsorted: MotionPath = {
      points: [{ x: 100, y: 100, tMs: 1000 }, { x: 0, y: 0, tMs: 0 }],
    };
    expect(motionPathPointAt(unsorted, 500, 1000)).toMatchObject({ x: 50, y: 50 });
    const invalid = {
      points: [{ x: 0, y: 0, tMs: 0 }, { x: Number.NaN, y: 20, tMs: 1000 }],
    } as MotionPath;
    expect(motionPathDisplacement(invalid, 1000, 1000)).toEqual({ x: 0, y: 0, rotation: 0 });
  });

  it('executes the injected evaluator identically to the direct implementation', () => {
    const evaluate = new Function(
      'clip',
      'relativeMs',
      `${stripExportsNamespace(keyframesSource())}\n${stripExportsNamespace(motionPathSource())}\nreturn interpolateClipWithMotionPath(clip, relativeMs);`
    ) as (clip: VideoClip, relativeMs: number) => unknown;
    const clip = { startMs: 0, endMs: 1000, motionPath: path } as VideoClip;
    for (const time of [0, 125, 500, 875, 1000]) {
      expect(evaluate(clip, time)).toEqual(interpolateClipWithMotionPath(clip, time));
    }
  });
});

describe('motion path editing geometry', () => {
  it('inserts, moves, and deletes points immutably with bounds', () => {
    const inserted = insertMotionPathPoint(path, 0);
    expect(inserted.points).toHaveLength(4);
    expect(inserted.points[1]).toEqual({ x: 50, y: 0, tMs: 250 });
    expect(path.points).toHaveLength(3);
    const moved = moveMotionPathPoint(inserted, 1, { x: MAX_DIMENSION + 100, y: -20 });
    expect(moved.points[1]).toMatchObject({ x: MAX_DIMENSION, y: -20, tMs: 250 });
    expect(deleteMotionPathPoint(moved, 1).points).toEqual(path.points);
    const twoPoints = { ...path, points: path.points.slice(0, 2) };
    expect(deleteMotionPathPoint(twoPoints, 1)).toBe(twoPoints);
    expect(insertMotionPathPoint(path, 5)).toBe(path);
  });

  it('caps recording and replaces a same-time trailing sample', () => {
    const replaced = appendMotionPathPoint(path, { x: 100, y: 120, tMs: 1000 }, 1000);
    expect(replaced.points.at(-1)).toEqual({ x: 100, y: 120, tMs: 1000 });
    const full = { points: path.points.slice(0, MAX_MOTION_PATH_POINTS) };
    while (full.points.length < MAX_MOTION_PATH_POINTS) {
      full.points.push({ x: 0, y: 0, tMs: full.points.length });
    }
    expect(appendMotionPathPoint(full, { x: 1, y: 1, tMs: 1000 }, 1000)).toBe(full);
  });

  it('translates, reflows, and duration-rescales every point without changing timing semantics elsewhere', () => {
    expect(translateMotionPath(path, 10, 20)?.points[0]).toEqual({ x: 10, y: 20, tMs: 0 });
    expect(scaleMotionPath(path, 2, 3)?.points[2]).toEqual({ x: 200, y: 300, tMs: 1000 });
    expect(rescaleMotionPathTimes(path, 1000, 2000)?.points.map((point) => point.tMs)).toEqual([0, 1000, 2000]);
    expect(rescaleMotionPathTimes(path, 1000, 1000)).toBe(path);
  });

  it('splits at an interpolated boundary and rebases the second path', () => {
    const split = splitMotionPath(path, 500, 1000);
    expect(split.first?.points).toEqual([
      { x: 0, y: 0, tMs: 0 },
      { x: 100, y: 0, tMs: 500 },
    ]);
    expect(split.second?.points).toEqual([
      { x: 100, y: 0, tMs: 0 },
      { x: 100, y: 100, tMs: 500 },
    ]);
    const midpoint = splitMotionPath(path, 250, 1000);
    expect(midpoint.first?.points.at(-1)).toEqual({ x: 50, y: 0, tMs: 250 });
    expect(midpoint.second?.points[0]).toEqual({ x: 50, y: 0, tMs: 0 });
    expect(midpoint.second?.points.at(-1)).toEqual({ x: 100, y: 100, tMs: 750 });
  });
});
