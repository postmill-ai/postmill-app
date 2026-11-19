import { describe, expect, it, vi } from 'vitest';
import { createDesignerStore, type VideoOutput } from './designer.store';
import {
  animationTargetRefs,
  copyAnimation,
  pasteAnimation,
  showAnimationCopyResult,
  showAnimationPasteResult,
} from './animation-clipboard-actions';

const storeWithClips = () => {
  const store = createDesignerStore();
  store.getState().setMode('video');
  const firstTrack = (store.getState().doc.outputs[0] as VideoOutput).tracks[0].id;
  store.getState().addTrack(0, 'shape');
  const secondTrack = (store.getState().doc.outputs[0] as VideoOutput).tracks[1].id;
  store.getState().addClip(0, firstTrack, {
    id: 'source', startMs: 0, endMs: 4000,
    keyframes: [{ tMs: 0, props: { opacity: 0.5, volume: 0.2 } }],
  } as never);
  store.getState().addClip(0, firstTrack, {
    id: 'first', startMs: 4000, endMs: 8000, groupId: 'group',
  } as never);
  store.getState().addClip(0, secondTrack, {
    id: 'second', startMs: 0, endMs: 4000, groupId: 'group',
  } as never);
  return { store, firstTrack, secondTrack };
};

const translate = (_key: string, fallback: string, params?: Record<string, string | number>) =>
  fallback.replace(/\{\{(\w+)\}\}/g, (_match, key) => String(params?.[key]));

describe('animation clipboard actions', () => {
  it('retains a clicked multi-selection and expands groups without changing primary selection', () => {
    const { store, firstTrack, secondTrack } = storeWithClips();
    store.getState().setSelectedClips([
      { trackId: firstTrack, clipId: 'first' },
      { trackId: secondTrack, clipId: 'second' },
    ], { trackId: secondTrack, clipId: 'second' });
    const primary = store.getState().selectedClip;

    expect(animationTargetRefs(store, { outputIndex: 0, trackId: firstTrack, clipId: 'first' }))
      .toEqual(expect.arrayContaining([
        { trackId: firstTrack, clipId: 'first' },
        { trackId: secondTrack, clipId: 'second' },
      ]));
    expect(animationTargetRefs(store, { outputIndex: 0, trackId: firstTrack, clipId: 'source' }))
      .toEqual([{ trackId: firstTrack, clipId: 'source' }]);
    expect(store.getState().selectedClip).toBe(primary);
  });

  it('uses the same action adapter for copying and multi-target paste', () => {
    const { store, firstTrack, secondTrack } = storeWithClips();
    expect(copyAnimation(store, {
      outputIndex: 0, trackId: firstTrack, clipId: 'source',
    }, 'org-a').status).toBe('copied');
    store.getState().setSelectedClips([
      { trackId: firstTrack, clipId: 'first' },
      { trackId: secondTrack, clipId: 'second' },
    ]);
    const depth = store.getState().history.length;
    const result = pasteAnimation(store, {
      outputIndex: 0, trackId: firstTrack, clipId: 'first',
    }, 'org-a');
    expect(result.targetCount).toBe(2);
    expect(store.getState().history.length).toBe(depth + 1);
  });

  it('summarizes source and target skips with translated feedback', () => {
    const toaster = { show: vi.fn() };
    showAnimationCopyResult({ status: 'copied', skipped: ['audio'] }, toaster, translate);
    expect(toaster.show).toHaveBeenLastCalledWith(
      'Animation copied. Not copied: audio animation',
      'warning'
    );

    showAnimationPasteResult({
      status: 'pasted',
      targetCount: 2,
      skipped: [
        { clipId: 'locked', reasons: ['locked'] },
        { clipId: 'image', reasons: ['text-reveal', 'no-compatible-animation'] },
      ],
    }, toaster, translate);
    expect(toaster.show).toHaveBeenLastCalledWith(
      'Animation pasted to 2 clip(s). Skipped: locked clips, text reveal on non-text clips',
      'warning'
    );
  });
});
