import { describe, expect, it, vi } from 'vitest';
import {
  planClipArrangement,
  type ClipArrangementDirection,
  type ClipArrangementRef,
  type ClipArrangementResult,
} from './clip-arrangement';
import type {
  VideoClip,
  VideoOutput,
  VideoTrack,
} from './designer-doc.schema';
import {
  MAX_CLIPS_PER_TRACK,
  MAX_TRACKS,
} from './designer-doc.limits';

const clip = (
  id: string,
  startMs = 0,
  endMs = 1000,
  over: Partial<VideoClip> = {}
): VideoClip => ({ id, startMs, endMs, ...over });

const track = (
  id: string,
  type: VideoTrack['type'],
  clips: VideoClip[],
  over: Partial<VideoTrack> = {}
): VideoTrack => ({ id, type, clips, ...over });

const output = (
  tracks: VideoTrack[],
  over: Partial<VideoOutput> = {}
): VideoOutput => ({
  id: 'output',
  formatId: 'square',
  name: 'Square',
  width: 500,
  height: 500,
  fps: 30,
  durationMs: 10000,
  tracks,
  ...over,
});

const successful = (
  out: VideoOutput,
  refs: ClipArrangementRef[],
  direction: ClipArrangementDirection
) => {
  let nextId = 0;
  const result = planClipArrangement(out, refs, direction, () => `new-${++nextId}`);
  expect(result.status).toBe('ok');
  if (result.status !== 'ok') throw new Error(result.status);
  return result;
};

const ids = (result: Extract<ClipArrangementResult, { status: 'ok' }>) =>
  result.tracks.map((item) => item.id);

describe('planClipArrangement', () => {
  it('moves whole tracks one visual step or to the requested extreme', () => {
    const a = track('a', 'video', [clip('a-clip')]);
    const b = track('b', 'shape', [clip('b-clip')]);
    const c = track('c', 'text', [clip('c-clip')]);
    const out = output([a, b, c]);

    expect(ids(successful(out, [{ trackId: 'a', clipId: 'a-clip' }], 'forward')))
      .toEqual(['b', 'a', 'c']);
    expect(ids(successful(out, [{ trackId: 'c', clipId: 'c-clip' }], 'backward')))
      .toEqual(['a', 'c', 'b']);
    expect(ids(successful(out, [{ trackId: 'a', clipId: 'a-clip' }], 'front')))
      .toEqual(['b', 'c', 'a']);
    expect(ids(successful(out, [{ trackId: 'c', clipId: 'c-clip' }], 'back')))
      .toEqual(['c', 'a', 'b']);
    expect(out.tracks.map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });

  it('skips audio when finding the adjacent visual stack position', () => {
    const out = output([
      track('a', 'video', [clip('a-clip')]),
      track('audio', 'audio', [clip('audio-clip')]),
      track('b', 'shape', [clip('b-clip')]),
    ]);

    const result = successful(out, [{ trackId: 'a', clipId: 'a-clip' }], 'forward');
    expect(ids(result)).toEqual(['audio', 'b', 'a']);
    expect(result.tracks[0]).toBe(out.tracks[1]);
  });

  it('moves a noncontiguous multi-selection as one ordered block', () => {
    const out = output([
      track('a', 'video', [clip('a-clip')]),
      track('b', 'shape', [clip('b-clip')]),
      track('c', 'text', [clip('c-clip')]),
      track('d', 'image', [clip('d-clip')]),
    ]);

    const result = successful(out, [
      { trackId: 'c', clipId: 'c-clip' },
      { trackId: 'a', clipId: 'a-clip' },
    ], 'forward');

    expect(ids(result)).toEqual(['b', 'd', 'a', 'c']);
    expect(result.moves).toEqual([
      { trackId: 'a', clipId: 'a-clip', toTrackId: 'a' },
      { trackId: 'c', clipId: 'c-clip', toTrackId: 'c' },
    ]);
  });

  it('extracts a partial selection above or below its shared source track', () => {
    const source = track('source', 'video', [
      clip('selected', 0, 1000),
      clip('resident', 2000, 3000),
    ], { name: 'Keep this name', hidden: true });

    const forward = successful(output([source]), [
      { trackId: 'source', clipId: 'selected' },
    ], 'forward');
    expect(ids(forward)).toEqual(['source', 'new-1']);
    expect(forward.tracks[0].clips.map((item) => item.id)).toEqual(['resident']);
    expect(forward.tracks[1]).toMatchObject({
      type: 'video',
      name: 'Keep this name',
      hidden: true,
      clips: [{ id: 'selected', startMs: 0, endMs: 1000 }],
    });

    const backward = successful(output([source]), [
      { trackId: 'source', clipId: 'selected' },
    ], 'backward');
    expect(ids(backward)).toEqual(['new-1', 'source']);
  });

  it('merges into an adjacent compatible collision-free track', () => {
    const out = output([
      track('source', 'video', [clip('selected'), clip('resident', 4000, 5000)]),
      track('target', 'video', [clip('target-clip', 2000, 3000)]),
      track('top', 'text', [clip('top-clip')]),
    ]);

    const result = successful(out, [{ trackId: 'source', clipId: 'selected' }], 'forward');
    expect(ids(result)).toEqual(['source', 'target', 'top']);
    expect(result.tracks[0].clips.map((item) => item.id)).toEqual(['resident']);
    expect(result.tracks[1].clips.map((item) => item.id)).toEqual(['target-clip', 'selected']);
    expect(result.moves).toEqual([
      { trackId: 'source', clipId: 'selected', toTrackId: 'target' },
    ]);
  });

  it('creates a track at the requested position for incompatible media', () => {
    const out = output([
      track('source', 'video', [clip('selected'), clip('resident', 4000, 5000)]),
      track('shape', 'shape', [clip('shape-clip')]),
      track('text', 'text', [clip('text-clip')]),
    ]);

    const result = successful(out, [{ trackId: 'source', clipId: 'selected' }], 'forward');
    expect(ids(result)).toEqual(['source', 'shape', 'new-1', 'text']);
    expect(result.tracks[2].type).toBe('video');
    expect(result.tracks[2].clips[0]).toBe(out.tracks[0].clips[0]);
  });

  it.each([
    { resident: clip('resident-target', 500, 1500), name: 'an ordinary overlap' },
    {
      resident: clip('resident-target', 1500, 2500),
      selected: clip('selected', 0, 1000, { freezeAtMs: 1000 }),
      name: 'a freeze-tail overlap',
    },
  ])('creates a track instead of merging into $name', ({ resident, selected }) => {
    const moving = selected ?? clip('selected');
    const out = output([
      track('source', 'video', [moving, clip('source-resident', 4000, 5000)]),
      track('target', 'video', [resident]),
    ]);

    const result = successful(out, [{ trackId: 'source', clipId: 'selected' }], 'forward');
    expect(ids(result)).toEqual(['source', 'target', 'new-1']);
    expect(result.tracks[2].clips[0]).toMatchObject({
      startMs: moving.startMs,
      endMs: moving.endMs,
      ...(moving.freezeAtMs !== undefined ? { freezeAtMs: moving.freezeAtMs } : {}),
    });
    expect(result.tracks[1].clips).toEqual([resident]);
  });

  it('does not merge into a locked or clip-capped target', () => {
    const locked = successful(output([
      track('source', 'video', [clip('selected'), clip('resident', 4000, 5000)]),
      track('target', 'video', [], { locked: true }),
    ]), [{ trackId: 'source', clipId: 'selected' }], 'forward');
    expect(ids(locked)).toEqual(['source', 'target', 'new-1']);
    expect(locked.tracks[1].clips).toEqual([]);

    const residents = Array.from({ length: MAX_CLIPS_PER_TRACK }, (_, index) =>
      clip(`resident-${index}`, index, index + 1)
    );
    const capped = successful(output([
      track('source', 'video', [clip('selected', 5000, 6000), clip('resident', 7000, 8000)]),
      track('target', 'video', residents),
    ]), [{ trackId: 'source', clipId: 'selected' }], 'forward');
    expect(ids(capped)).toEqual(['source', 'target', 'new-1']);
    expect(capped.tracks[1].clips).toHaveLength(MAX_CLIPS_PER_TRACK);
  });

  it('keeps mixed-type partial selections ordered in separate tracks', () => {
    const out = output([
      track('video', 'video', [clip('video-selected'), clip('video-resident', 4000, 5000)]),
      track('shape', 'shape', [clip('shape-selected'), clip('shape-resident', 4000, 5000)]),
      track('text', 'text', [clip('text-resident')]),
    ]);

    const result = successful(out, [
      { trackId: 'shape', clipId: 'shape-selected' },
      { trackId: 'video', clipId: 'video-selected' },
    ], 'front');
    expect(ids(result)).toEqual(['video', 'shape', 'text', 'new-1', 'new-2']);
    expect(result.tracks[3].type).toBe('video');
    expect(result.tracks[4].type).toBe('shape');
  });

  it('preserves every clip field and linked identity by moving the original objects', () => {
    const selected = clip('selected', 125, 987, {
      originId: 'linked-origin',
      groupId: 'group',
      trimInMs: 22,
      trimOutMs: 33,
      transitionIn: { type: 'fade', durationMs: 100 },
      transitionOut: { type: 'dissolve', durationMs: 200 },
      keyframes: [{ tMs: 50, props: { x: 20 } }],
      src: '/video.mp4',
    });
    const out = output([
      track('source', 'video', [selected, clip('resident', 4000, 5000)]),
      track('shape', 'shape', [clip('shape')]),
    ]);
    const before = JSON.stringify(selected);

    const result = successful(out, [{ trackId: 'source', clipId: 'selected' }], 'forward');
    expect(result.tracks[2].clips[0]).toBe(selected);
    expect(JSON.stringify(result.tracks[2].clips[0])).toBe(before);
    expect(result.tracks[2].clips[0]).toMatchObject({
      startMs: 125,
      endMs: 987,
      originId: 'linked-origin',
      groupId: 'group',
    });
  });

  it.each([
    ['front', 'already-front'],
    ['forward', 'already-front'],
    ['back', 'already-back'],
    ['backward', 'already-back'],
  ] as const)('reports %s on a single whole visual track as %s', (direction, status) => {
    const createId = vi.fn();
    const out = output([track('only', 'video', [clip('selected')])]);
    expect(planClipArrangement(out, [
      { trackId: 'only', clipId: 'selected' },
    ], direction, createId)).toEqual({ status });
    expect(createId).not.toHaveBeenCalled();
  });

  it('rejects the track-limit case without changing timing or minting ids', () => {
    const createId = vi.fn(() => 'unexpected');
    const out = output([
      track('source', 'video', [clip('selected'), clip('resident', 2000, 3000)]),
      ...Array.from({ length: MAX_TRACKS - 1 }, (_, index) =>
        track(`audio-${index}`, 'audio', [clip(`audio-clip-${index}`)])
      ),
    ]);

    expect(planClipArrangement(out, [
      { trackId: 'source', clipId: 'selected' },
    ], 'forward', createId)).toEqual({ status: 'track-limit' });
    expect(createId).not.toHaveBeenCalled();
    expect(out.tracks[0].clips.map((item) => [item.startMs, item.endMs])).toEqual([
      [0, 1000], [2000, 3000],
    ]);
  });

  it('rejects invalid, audio, locked, and frozen requests atomically', () => {
    const createId = vi.fn();
    const base = output([track('source', 'video', [clip('selected')])]);
    expect(planClipArrangement(base, [], 'front', createId)).toEqual({ status: 'empty' });
    expect(planClipArrangement(base, [
      { trackId: 'source', clipId: 'missing' },
    ], 'front', createId)).toEqual({ status: 'unknown-clip' });
    expect(planClipArrangement(output([
      track('audio', 'audio', [clip('selected')]),
    ]), [{ trackId: 'audio', clipId: 'selected' }], 'front', createId))
      .toEqual({ status: 'audio' });
    expect(planClipArrangement(output([
      track('source', 'video', [clip('selected')], { locked: true }),
    ]), [{ trackId: 'source', clipId: 'selected' }], 'front', createId))
      .toEqual({ status: 'locked' });
    expect(planClipArrangement(output(base.tracks, { frozen: true }), [
      { trackId: 'source', clipId: 'selected' },
    ], 'front', createId)).toEqual({ status: 'frozen' });
    expect(createId).not.toHaveBeenCalled();
  });
});
