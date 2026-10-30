import { describe, expect, it } from 'vitest';
import type { VideoOutput } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.schema';
import { canSplitClipAt } from './timeline-split';

const output = (locked = false): VideoOutput => ({
  id: 'out',
  formatId: 'square',
  name: 'Square',
  width: 100,
  height: 100,
  fps: 30,
  durationMs: 2000,
  tracks: [{
    id: 'track',
    type: 'video',
    locked,
    clips: [{ id: 'clip', startMs: 200, endMs: 1200 }],
  }],
});

describe('canSplitClipAt', () => {
  it.each([200, 201, 299, 1101, 1199, 1200, 0, 1500])('rejects an invalid cut at %sms', (atMs) => {
    expect(canSplitClipAt(output(), 'track', 'clip', atMs)).toBe(false);
  });

  it.each([300, 500, 1100])('accepts an interior cut with two viable sides at %sms', (atMs) => {
    expect(canSplitClipAt(output(), 'track', 'clip', atMs)).toBe(true);
  });

  it('rejects a missing selection or a locked track', () => {
    expect(canSplitClipAt(output(), 'track', 'missing', 500)).toBe(false);
    expect(canSplitClipAt(output(true), 'track', 'clip', 500)).toBe(false);
    expect(canSplitClipAt(undefined, 'track', 'clip', 500)).toBe(false);
  });
});
