import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import Konva from 'konva';
import { Stage, Layer } from 'react-konva';
import { VideoCanvasOverlay } from './video-canvas-overlay';
import { createDesignerStore, type VideoOutput } from './designer.store';

/**
 * Regression (D2): the Konva artboard stayed blank during playback until the
 * clip was clicked, and at t=0 / clip end. Konva is retained-mode — a React
 * re-render with identical props never repaints, and the hidden <video> only
 * has a new frame after loadeddata / a completed seek. The overlay now
 * repaints the layer on exactly those events; this watches batchDraw.
 *
 * The 60fps loop is stubbed out (no-op rAF) so the ONLY repaint trigger left
 * is the notification path under test.
 */

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

beforeAll(() => {
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

const videoStore = () => {
  const store = createDesignerStore(1080, 1080);
  store.getState().setMode('video');
  const out = store.getState().currentOutput;
  const vo = store.getState().doc.outputs[out] as VideoOutput;
  store.getState().addClip(out, vo.tracks[0].id, {
    id: 'c1',
    startMs: 0,
    endMs: 4000,
    src: 'https://example.com/a.mp4',
    x: 0,
    y: 0,
    width: 400,
    height: 300,
  });
  return store;
};

describe('video overlay paint invalidation', () => {
  it('preloads the hidden video and repaints the layer on loadeddata and seeked', async () => {
    const store = videoStore();
    // jsdom's canvas rejects a <video> as drawImage source; the pixels are not
    // what is under test, so actual drawing is stubbed and only the
    // invalidation calls are counted.
    vi.spyOn(Konva.Container.prototype, 'draw').mockImplementation(function (this: Konva.Container) {
      return this;
    });
    const spy = vi
      .spyOn(Konva.Layer.prototype, 'batchDraw')
      .mockImplementation(function (this: Konva.Layer) {
        return this;
      });

    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(
        <Stage width={1080} height={1080}>
          <Layer>
            <VideoCanvasOverlay store={store} width={1080} height={1080} />
          </Layer>
        </Stage>
      );
    });

    const video = document.querySelector('video');
    expect(video).toBeTruthy();
    // metadata-only preload would never reach a paintable readyState by itself.
    expect(video!.preload).toBe('auto');

    // First paint: frame data arrived without any seek (the t=0 case).
    const beforeLoad = spy.mock.calls.length;
    await act(async () => {
      video!.dispatchEvent(new Event('loadeddata'));
    });
    expect(spy.mock.calls.length).toBeGreaterThan(beforeLoad);

    // Post-seek paint: the frame is valid only once the seek COMPLETES.
    const beforeSeek = spy.mock.calls.length;
    await act(async () => {
      video!.dispatchEvent(new Event('seeked'));
    });
    expect(spy.mock.calls.length).toBeGreaterThan(beforeSeek);
  });
});
