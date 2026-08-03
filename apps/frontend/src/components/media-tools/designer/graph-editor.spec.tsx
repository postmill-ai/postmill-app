import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import {
  animatedProps,
  clearEaseHandles,
  graphRange,
  graphSamples,
  handlePosition,
  setEaseHandle,
  GraphEditor,
} from './graph-editor';
import type { VideoClip } from './designer.store';
import type { Keyframe } from '@postmill-ai/nestjs-libraries/media/designer-doc/keyframes';

/**
 * The graph editor's geometry.
 *
 * Handles are stored in normalised SEGMENT space so they survive a keyframe
 * being dragged along the timeline — that conversion is the part that silently
 * reshapes a curve when it is wrong.
 */

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT:
    () =>
    (_k: string, d: string, vars?: Record<string, unknown>) =>
      vars ? d.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(vars[k])) : d,
}));

afterEach(cleanup);

const keyframes: Keyframe[] = [
  { tMs: 0, props: { x: 0, opacity: 0 } },
  { tMs: 1000, props: { x: 100, opacity: 1 } },
];

const clip = {
  id: 'c',
  startMs: 0,
  endMs: 1000,
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  keyframes,
} as unknown as VideoClip;

describe('animatedProps', () => {
  it('lists only what is actually keyframed', () => {
    expect(animatedProps(keyframes)).toEqual(['x', 'opacity']);
  });

  it('is empty with no keyframes', () => {
    expect(animatedProps(undefined)).toEqual([]);
  });

  it('counts a property keyframed on only one of the frames', () => {
    expect(
      animatedProps([{ tMs: 0, props: { rotation: 4 } }, { tMs: 1, props: {} }])
    ).toEqual(['rotation']);
  });
});

describe('graphRange', () => {
  it('spans the keyframed values with a margin', () => {
    const r = graphRange(clip, 'x');
    expect(r.min).toBeLessThan(0);
    expect(r.max).toBeGreaterThan(100);
  });

  it('pads a flat property so its line is not on the floor', () => {
    const flat = { ...clip, keyframes: [
      { tMs: 0, props: { x: 50 } },
      { tMs: 1000, props: { x: 50 } },
    ] } as unknown as VideoClip;
    const r = graphRange(flat, 'x');
    expect(r.max - r.min).toBeGreaterThan(0);
    expect(r.min).toBeLessThan(50);
    expect(r.max).toBeGreaterThan(50);
  });

  it('gives a usable range for a property with no keyframes', () => {
    expect(graphRange(clip, 'rotation')).toEqual({ min: 0, max: 1 });
  });
});

describe('graphSamples', () => {
  it('plots the real interpolation, not an approximation of it', () => {
    const samples = graphSamples(clip, 'x', 1000, 10);
    expect(samples[0]).toBeCloseTo(0);
    expect(samples[10]).toBeCloseTo(100);
    expect(samples[5]).toBeCloseTo(50);
  });

  it('follows an eased segment', () => {
    const eased = {
      ...clip,
      keyframes: [
        { tMs: 0, props: { x: 0 }, ease: { out: [0.9, 0] as [number, number] } },
        { tMs: 1000, props: { x: 100 }, ease: { in: [1, 1] as [number, number] } },
      ],
    } as unknown as VideoClip;
    const samples = graphSamples(eased, 'x', 1000, 10);
    expect(samples[5]).toBeLessThan(50);
  });
});

describe('setEaseHandle', () => {
  it('writes one side and leaves the other', () => {
    const first = setEaseHandle(keyframes, 0, 'out', [0.8, 0.1]);
    const both = setEaseHandle(first, 0, 'in', [0.2, 0.9]);
    expect(both[0].ease).toEqual({ out: [0.8, 0.1], in: [0.2, 0.9] });
  });

  it('replaces a preset name rather than sitting alongside it', () => {
    // A keyframe carrying both would leave the stored ease ambiguous.
    const withPreset: Keyframe[] = [{ ...keyframes[0], ease: 'easeIn' }, keyframes[1]];
    expect(setEaseHandle(withPreset, 0, 'out', [0.5, 0.5])[0].ease).toEqual({
      out: [0.5, 0.5],
    });
  });

  it('touches only the keyframe it was given', () => {
    expect(setEaseHandle(keyframes, 1, 'in', [0.4, 0.4])[0].ease).toBeUndefined();
  });
});

describe('clearEaseHandles', () => {
  it('returns a keyframe to linear', () => {
    const shaped = setEaseHandle(keyframes, 0, 'out', [0.9, 0.1]);
    expect(clearEaseHandles(shaped, 0)[0].ease).toBe('linear');
  });
});

describe('handlePosition', () => {
  it('places the neutral outgoing handle a third of the way along', () => {
    const pos = handlePosition(keyframes, 0, 'out', 'x')!;
    expect(pos.tMs).toBeCloseTo(1000 / 3);
    expect(pos.value).toBeCloseTo(100 / 3);
  });

  it('places the neutral incoming handle two thirds along, read backwards', () => {
    const pos = handlePosition(keyframes, 1, 'in', 'x')!;
    // The handle is stored measured from the segment START, so [2/3, 2/3] sits
    // two thirds along the 0→1000 segment, near the keyframe it belongs to.
    expect(pos.tMs).toBeCloseTo((1000 * 2) / 3);
    expect(pos.value).toBeCloseTo((100 * 2) / 3);
  });

  it('has no handle where there is no neighbouring segment', () => {
    expect(handlePosition(keyframes, 0, 'in', 'x')).toBeNull();
    expect(handlePosition(keyframes, 1, 'out', 'x')).toBeNull();
  });

  it('has no handle for a property this keyframe does not set', () => {
    const partial: Keyframe[] = [
      { tMs: 0, props: { x: 0 } },
      { tMs: 1000, props: { opacity: 1 } },
    ];
    expect(handlePosition(partial, 0, 'out', 'x')).toBeNull();
  });

  it('moves with a dragged handle', () => {
    const shaped = setEaseHandle(keyframes, 0, 'out', [0.9, 0.1]);
    const pos = handlePosition(shaped, 0, 'out', 'x')!;
    expect(pos.tMs).toBeCloseTo(900);
    expect(pos.value).toBeCloseTo(10);
  });

  it('is unchanged in shape when the keyframe moves along the timeline', () => {
    // Normalised storage is the whole point: retiming must not re-ease.
    const shaped = setEaseHandle(keyframes, 0, 'out', [0.25, 0.75]);
    const retimed = shaped.map((kf, i) => (i === 1 ? { ...kf, tMs: 2000 } : kf));
    expect(handlePosition(retimed, 0, 'out', 'x')!.tMs).toBeCloseTo(500);
    expect(handlePosition(retimed, 0, 'out', 'x')!.value).toBeCloseTo(75);
  });
});

describe('GraphEditor', () => {
  it('offers a curve per animated property', () => {
    render(<GraphEditor clip={clip} totalMs={1000} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'x' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'opacity' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'rotation' })).toBeNull();
  });

  it('says what to do instead of drawing an empty grid', () => {
    const bare = { ...clip, keyframes: [] } as unknown as VideoClip;
    render(<GraphEditor clip={bare} totalMs={1000} onChange={() => {}} />);
    expect(screen.queryByRole('application')).toBeNull();
    expect(screen.getByText(/Add keyframes/)).toBeTruthy();
  });

  it('draws a handle either side of an interior keyframe', () => {
    const three = {
      ...clip,
      keyframes: [
        { tMs: 0, props: { x: 0 } },
        { tMs: 500, props: { x: 50 } },
        { tMs: 1000, props: { x: 100 } },
      ],
    } as unknown as VideoClip;
    render(<GraphEditor clip={three} totalMs={1000} onChange={() => {}} />);
    expect(screen.getByTestId('handle-in-1')).toBeTruthy();
    expect(screen.getByTestId('handle-out-1')).toBeTruthy();
    // The first keyframe has nothing before it.
    expect(screen.queryByTestId('handle-in-0')).toBeNull();
  });
});
