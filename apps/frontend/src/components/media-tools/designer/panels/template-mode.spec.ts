import { describe, it, expect } from 'vitest';
import {
  isDocEmpty,
  needsModeConfirm,
  templateModeOf,
} from './template-mode';

const imageDoc = (childrenPerOutput: unknown[][] = [[]]) => ({
  mode: 'image',
  outputs: childrenPerOutput.map((children) => ({ children })),
});

const videoDoc = (clipsPerTrack: unknown[][][] = [[[]]]) => ({
  mode: 'video',
  outputs: clipsPerTrack.map((tracks) => ({
    tracks: tracks.map((clips) => ({ clips })),
  })),
});

describe('templateModeOf (badge derivation)', () => {
  it('is video only when the stored doc says so', () => {
    expect(templateModeOf({ doc: { mode: 'video' } })).toBe('video');
  });

  it('treats image, missing, and malformed docs as image (the pre-video default)', () => {
    expect(templateModeOf({ doc: { mode: 'image' } })).toBe('image');
    expect(templateModeOf({ doc: null })).toBe('image');
    expect(templateModeOf({})).toBe('image');
    expect(templateModeOf({ doc: { mode: undefined } })).toBe('image');
  });
});

describe('isDocEmpty', () => {
  it('treats a doc with no outputs as empty', () => {
    expect(isDocEmpty(undefined)).toBe(true);
    expect(isDocEmpty(null)).toBe(true);
    expect(isDocEmpty({ mode: 'image', outputs: [] })).toBe(true);
  });

  it('image docs are empty only when every output has no elements', () => {
    expect(isDocEmpty(imageDoc([[], []]))).toBe(true);
    expect(isDocEmpty(imageDoc([[{ id: 'el-1' }]]))).toBe(false);
    expect(isDocEmpty(imageDoc([[], [{ id: 'el-1' }]]))).toBe(false);
  });

  it('video docs are empty only when every track on every output has no clips', () => {
    expect(isDocEmpty(videoDoc([[[]], [[]]]))).toBe(true);
    expect(isDocEmpty(videoDoc([[[]], [[{ id: 'clip-1' }]]]))).toBe(false);
  });

  it('tolerates missing children/tracks/clips arrays', () => {
    expect(isDocEmpty({ mode: 'image', outputs: [{}] })).toBe(true);
    expect(isDocEmpty({ mode: 'video', outputs: [{ tracks: [{}] }] })).toBe(true);
  });
});

describe('needsModeConfirm (mode guard on apply)', () => {
  it('never asks when the modes match', () => {
    expect(
      needsModeConfirm({ doc: { mode: 'image' } }, imageDoc([[{ id: 'el' }]]))
    ).toBe(false);
    expect(
      needsModeConfirm({ doc: { mode: 'video' } }, videoDoc([[[{ id: 'c' }]]]))
    ).toBe(false);
  });

  it('asks when a video template would replace a non-empty image design', () => {
    expect(
      needsModeConfirm({ doc: { mode: 'video' } }, imageDoc([[{ id: 'el' }]]))
    ).toBe(true);
  });

  it('asks when an image template would replace a non-empty video design', () => {
    expect(
      needsModeConfirm({ doc: { mode: 'image' } }, videoDoc([[[{ id: 'c' }]]]))
    ).toBe(true);
  });

  it('applies cross-mode without asking when the current design is empty', () => {
    expect(needsModeConfirm({ doc: { mode: 'video' } }, imageDoc())).toBe(false);
    expect(needsModeConfirm({ doc: { mode: 'image' } }, videoDoc())).toBe(false);
    expect(needsModeConfirm({ doc: { mode: 'video' } }, undefined)).toBe(false);
  });
});
