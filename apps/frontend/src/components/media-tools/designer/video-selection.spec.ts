import { describe, expect, it } from 'vitest';
import type { VideoOutput } from './designer.store';
import {
  clipsInMarquee,
  expandClipRefs,
  groupRefsForClip,
  toggleClipRefs,
} from './video-selection';

const output = (): VideoOutput => ({
  id: 'out',
  formatId: 'square',
  name: 'Square',
  width: 400,
  height: 300,
  fps: 30,
  durationMs: 4000,
  tracks: [
    {
      id: 'a',
      type: 'shape',
      clips: [
        { id: 'a1', groupId: 'pair', startMs: 0, endMs: 4000 },
        { id: 'a2', startMs: 0, endMs: 4000 },
      ],
    },
    {
      id: 'b',
      type: 'text',
      clips: [{ id: 'b1', groupId: 'pair', startMs: 0, endMs: 4000 }],
    },
    {
      id: 'locked',
      type: 'shape',
      locked: true,
      clips: [{ id: 'locked-1', startMs: 0, endMs: 4000 }],
    },
  ],
});

describe('video clip selection groups', () => {
  it('expands a member across tracks without changing origin semantics', () => {
    expect(groupRefsForClip(output(), 'a', 'a1')).toEqual([
      { trackId: 'a', clipId: 'a1' },
      { trackId: 'b', clipId: 'b1' },
    ]);
    expect(groupRefsForClip(output(), 'a', 'a2')).toEqual([
      { trackId: 'a', clipId: 'a2' },
    ]);
  });

  it('deduplicates marquee hits that share a group', () => {
    expect(expandClipRefs(output(), [
      { trackId: 'a', clipId: 'a1' },
      { trackId: 'b', clipId: 'b1' },
    ])).toEqual([
      { trackId: 'a', clipId: 'a1' },
      { trackId: 'b', clipId: 'b1' },
    ]);
  });

  it('adds or removes the whole group on an additive toggle', () => {
    const one = [{ trackId: 'a', clipId: 'a2' }];
    const withPair = toggleClipRefs(one, groupRefsForClip(output(), 'a', 'a1'));
    expect(withPair).toEqual([
      { trackId: 'a', clipId: 'a2' },
      { trackId: 'a', clipId: 'a1' },
      { trackId: 'b', clipId: 'b1' },
    ]);
    expect(toggleClipRefs(withPair, groupRefsForClip(output(), 'b', 'b1'))).toEqual(one);
  });
});

describe('canvas clip marquee', () => {
  const clips = [
    { trackId: 'a', clip: { id: 'inside' }, props: { x: 20, y: 20, width: 60, height: 40 } },
    { trackId: 'a', clip: { id: 'edge' }, props: { x: 90, y: 20, width: 60, height: 40 } },
    { trackId: 'a', clip: { id: 'outside' }, props: { x: 200, y: 200, width: 60, height: 40 } },
    { trackId: 'locked', clip: { id: 'locked-1' }, props: { x: 20, y: 20, width: 60, height: 40 } },
  ];

  it('selects intersecting visible clips and excludes locked tracks', () => {
    expect(clipsInMarquee(clips, { x: 0, y: 0, w: 100, h: 100 }, new Set(['locked']))).toEqual([
      { trackId: 'a', clipId: 'inside' },
      { trackId: 'a', clipId: 'edge' },
    ]);
  });

  it('does not select clips fully outside the rectangle', () => {
    expect(clipsInMarquee(clips, { x: 0, y: 100, w: 100, h: 50 }, new Set())).toEqual([]);
  });
});
