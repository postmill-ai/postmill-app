import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ClipInspector } from './clip-inspector';
import { createDesignerStore } from '../designer.store';
import { matchTextAnimationPresets } from '../text-animation-presets';
import { interpolateKeyframes } from '../video-preview';

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string, params?: Record<string, unknown>) =>
    params
      ? fallback.replace(/\{\{(\w+)\}\}/g, (_match, key) => String(params[key]))
      : fallback,
}));
vi.mock('@postmill-ai/react/toaster/toaster', () => ({
  useToaster: () => ({ show: vi.fn() }),
}));
vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({
  useFetch: () => vi.fn(),
}));
vi.mock('@postmill-ai/frontend/components/layout/use-media-tools-status', () => ({
  useMediaToolsStatus: () => ({ operationAvailable: () => false }),
}));
vi.mock('@postmill-ai/frontend/components/layout/new-modal', () => ({
  useModals: () => ({ openModal: vi.fn() }),
}));
vi.mock('../../use-media-picker', () => ({
  useMediaPicker: () => ({ open: vi.fn(), close: vi.fn(), element: null }),
}));
vi.mock('./font-family-picker', () => ({ FontFamilyPicker: () => null }));

const makeStore = (trackType: 'video' | 'audio' | 'text' = 'video') => {
  const store = createDesignerStore();
  store.setState({
    doc: {
      mode: 'video',
      outputs: [{
        id: 'out-1',
        width: 1080,
        height: 1080,
        durationMs: 10_000,
        fps: 30,
        tracks: [{
          id: 'track-1',
          type: trackType,
          clips: [{
            id: 'clip-1',
            startMs: 0,
            endMs: 5000,
            src: '/video.mp4',
            text: trackType === 'text' ? 'Animated text' : undefined,
            x: 100, y: 200, width: 200, height: 100, fontSize: 24,
            volume: 0.4,
            reverse: false,
          }, {
            id: 'clip-2',
            startMs: 5000,
            endMs: 8000,
            src: '/other.mp4',
            volume: 0.8,
            reverse: false,
          }],
        }],
      }],
    } as any,
  });
  return store;
};

describe('ClipInspector playback controls', () => {
  it('toggles reverse and restores the previous nonzero original-audio volume', () => {
    const store = makeStore();
    render(<ClipInspector store={store} outputIndex={0} trackId="track-1" clipId="clip-1" />);

    fireEvent.click(screen.getByRole('switch', { name: 'Reverse' }));
    expect(store.getState().doc.outputs[0].tracks[0].clips[0].reverse).toBe(true);

    fireEvent.click(screen.getByRole('switch', { name: 'Original audio' }));
    expect(store.getState().doc.outputs[0].tracks[0].clips[0].volume).toBe(0);
    fireEvent.click(screen.getByRole('switch', { name: 'Original audio' }));
    expect(store.getState().doc.outputs[0].tracks[0].clips[0].volume).toBe(0.4);
  });

  it('restores the selected clip volume rather than the previously edited clip volume', () => {
    const store = makeStore();
    const second = render(<ClipInspector store={store} outputIndex={0} trackId="track-1" clipId="clip-2" />);
    fireEvent.click(screen.getByRole('switch', { name: 'Original audio' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Original audio' }));
    expect(store.getState().doc.outputs[0].tracks[0].clips[1].volume).toBe(0.8);
    second.unmount();

    render(<ClipInspector store={store} outputIndex={0} trackId="track-1" clipId="clip-1" />);
    fireEvent.click(screen.getByRole('switch', { name: 'Original audio' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Original audio' }));
    expect(store.getState().doc.outputs[0].tracks[0].clips[0].volume).toBe(0.4);
  });

  it('removes volume keyframes when muting so playback cannot continue audibly', () => {
    const store = makeStore();
    store.getState().updateClipSilent(0, 'track-1', 'clip-1', {
      keyframes: [{ tMs: 0, props: { volume: 1 } }],
    });
    render(<ClipInspector store={store} outputIndex={0} trackId="track-1" clipId="clip-1" />);

    fireEvent.click(screen.getByRole('switch', { name: 'Original audio' }));

    const clip = store.getState().doc.outputs[0].tracks[0].clips[0];
    expect(clip.volume).toBe(0);
    expect(clip.keyframes).toEqual([]);
  });

  it('offers Reverse for audio clips without the video-only Original audio control', () => {
    const store = makeStore('audio');
    render(<ClipInspector store={store} outputIndex={0} trackId="track-1" clipId="clip-1" />);

    expect(screen.queryByRole('switch', { name: 'Original audio' })).toBeNull();
    fireEvent.click(screen.getByRole('switch', { name: 'Reverse' }));
    expect(store.getState().doc.outputs[0].tracks[0].clips[0].reverse).toBe(true);
  });

  it('keeps entrance, emphasis, and exit presets independently selected', () => {
    const store = makeStore('text');
    render(<ClipInspector store={store} outputIndex={0} trackId="track-1" clipId="clip-1" />);
    const initialHistory = store.getState().history.length;

    fireEvent.click(screen.getByRole('button', { name: 'Fade Up', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Pulse', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Fade Out', exact: true }));

    for (const name of ['Fade Up', 'Pulse', 'Fade Out']) {
      expect(screen.getByRole('button', { name, exact: true }).getAttribute('aria-pressed')).toBe('true');
    }
    const clip = store.getState().doc.outputs[0].tracks[0].clips[0];
    expect(matchTextAnimationPresets(clip, true)).toEqual({
      entrance: 'Fade Up',
      emphasis: 'Pulse',
      exit: 'Fade Out',
    });
    expect(store.getState().history.length).toBe(initialHistory + 3);

    fireEvent.click(screen.getByRole('button', { name: 'Pulse', exact: true }));
    expect(screen.getByRole('button', { name: 'Pulse', exact: true }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'Fade Up', exact: true }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Fade Out', exact: true }).getAttribute('aria-pressed')).toBe('true');
    const cleared = store.getState().doc.outputs[0].tracks[0].clips[0];
    expect(matchTextAnimationPresets(cleared, true)).toEqual({
      entrance: 'Fade Up',
      exit: 'Fade Out',
    });
    expect(store.getState().history.length).toBe(initialHistory + 4);
  });
});

describe('ClipInspector combined keyframe editing', () => {
  const renderCombined = () => {
    const store = makeStore('text');
    render(<ClipInspector store={store} outputIndex={0} trackId="track-1" clipId="clip-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Fade Up', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Pulse', exact: true }));
    return store;
  };
  const frames = (store: ReturnType<typeof makeStore>) =>
    store.getState().doc.outputs[0].tracks[0].clips[0].keyframes ?? [];

  it('adds a property without dropping the existing preset tag', () => {
    const store = renderCombined();
    fireEvent.keyDown(screen.getByRole('slider', { name: 'opacity keyframe timeline' }), { key: 'Enter' });

    const updated = frames(store);
    expect(updated.every((frame) => frame.animationPreset)).toBe(true);
    const clip = store.getState().doc.outputs[0].tracks[0].clips[0];
    expect(interpolateKeyframes(clip, 3000).opacity).toBe(1);
    expect(interpolateKeyframes(clip, 3000).y).toBe(200);
  });

  it('removes a property only from the targeted frame', () => {
    const store = renderCombined();
    const pulseBefore = frames(store).filter((frame) => frame.animationPreset?.category === 'emphasis');
    fireEvent.click(screen.getByRole('button', { name: 'opacity keyframe at 0ms' }));

    const entrance = frames(store).find((frame) => frame.animationPreset?.category === 'entrance' && frame.tMs === 0)!;
    expect(entrance.props).toEqual({ y: 220 });
    expect(entrance.animationPreset?.name).toBe('Fade Up');
    expect(frames(store).filter((frame) => frame.animationPreset?.category === 'emphasis')).toEqual(pulseBefore);
  });

  it('moves only the selected frame at a shared timestamp', () => {
    const store = renderCombined();
    const markers = screen.getAllByRole('button', { name: 'Keyframe at 0ms' });
    fireEvent.keyDown(markers[0], { key: 'ArrowRight' });

    expect(frames(store).some((frame) => frame.animationPreset?.category === 'entrance' && frame.tMs === 50)).toBe(true);
    expect(frames(store).some((frame) => frame.animationPreset?.category === 'emphasis' && frame.tMs === 0)).toBe(true);
    expect(frames(store).some((frame) => frame.animationPreset?.category === 'entrance' && frame.tMs === 0)).toBe(false);
  });

  it('keeps dragging the same tagged frame across silent updates', () => {
    const store = renderCombined();
    const timeline = screen.getByRole('slider', { name: 'Keyframe timeline' });
    vi.spyOn(timeline, 'getBoundingClientRect').mockReturnValue({ width: 1000 } as DOMRect);
    const marker = screen.getAllByRole('button', { name: 'Keyframe at 0ms' })[0];
    fireEvent.mouseDown(marker, { clientX: 0 });
    fireEvent.mouseMove(window, { clientX: 100 });
    fireEvent.mouseMove(window, { clientX: 200 });
    fireEvent.mouseUp(window);

    expect(frames(store).some((frame) => frame.animationPreset?.category === 'entrance' && frame.tMs === 1000)).toBe(true);
    expect(frames(store).some((frame) => frame.animationPreset?.category === 'emphasis' && frame.tMs === 0)).toBe(true);
  });

  it('re-eases only the selected frame at a shared timestamp', () => {
    const store = renderCombined();
    const row = document.getElementById('clip-kf-row-opacity')!;
    fireEvent.change(row.querySelector('select')!, { target: { value: 'easeIn' } });

    const entrance = frames(store).find((frame) => frame.animationPreset?.category === 'entrance' && frame.tMs === 0)!;
    const emphasis = frames(store).find((frame) => frame.animationPreset?.category === 'emphasis' && frame.tMs === 0)!;
    expect(entrance.ease).toBe('easeIn');
    expect(emphasis.ease).toBe('easeInOut');
  });
});
