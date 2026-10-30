import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import Konva from 'konva';
import { Stage, Layer } from 'react-konva';
import { VideoCanvasOverlay } from './video-canvas-overlay';
import { VideoPreviewEngine } from './video-preview';
import { resetVideoElementRegistry } from './video-element-registry';
import { videoSrcErrored, resetVideoSrcErrors } from './video-src';
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
  for (const method of ['pause', 'load']) {
    Object.defineProperty(HTMLMediaElement.prototype, method, {
      value: vi.fn(),
      configurable: true,
    });
  }
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  vi.restoreAllMocks();
  resetVideoElementRegistry();
  document.body.innerHTML = '';
  resetVideoSrcErrors();
});

const videoStore = (overrides: Partial<import('./designer.store').VideoClip> = {}) => {
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
    ...overrides,
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

  it('repaints and swaps to a failure placeholder when the video element errors', async () => {
    // A video that can't load (404, CORS, bad codec) never fires loadeddata —
    // without the error path it paints black forever.
    const store = videoStore();
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
    expect(videoSrcErrored({ id: 'c1', src: 'https://example.com/a.mp4' })).toBe(false);

    const beforeError = spy.mock.calls.length;
    await act(async () => {
      video!.dispatchEvent(new Event('error'));
    });

    // The error both repaints (so the placeholder appears) and records the
    // clip as errored...
    expect(spy.mock.calls.length).toBeGreaterThan(beforeError);
    expect(videoSrcErrored({ id: 'c1', src: 'https://example.com/a.mp4' })).toBe(true);

    // ...and the artboard shows the dead-clip placeholder instead of black.
    const texts = Konva.stages
      .flatMap((s) => s.find('Text'))
      .map((n) => (n as Konva.Text).text());
    expect(texts).toContain('Video failed to load');

    // A src swap (regenerate) clears the error for the same clip id.
    expect(videoSrcErrored({ id: 'c1', src: 'https://example.com/b.mp4?v=2' })).toBe(false);
  });

  it('shares the same video element with playback and survives engine teardown', async () => {
    Object.defineProperty(HTMLMediaElement.prototype, 'play', {
      value: vi.fn().mockResolvedValue(undefined),
      configurable: true,
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
      value: vi.fn(),
      configurable: true,
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'load', {
      value: vi.fn(),
      configurable: true,
    });
    vi.spyOn(Konva.Container.prototype, 'draw').mockImplementation(function (this: Konva.Container) {
      return this;
    });
    const store = videoStore();
    const engine = new VideoPreviewEngine(store);
    engine.seek(1000);
    const playbackElement = document.querySelector('video');
    expect(playbackElement).toBeTruthy();

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

    expect(document.querySelectorAll('video')).toHaveLength(1);
    expect(document.querySelector('video')).toBe(playbackElement);
    engine.destroy();
    expect(playbackElement!.isConnected).toBe(true);

    await act(async () => root!.unmount());
    root = null;
    expect(playbackElement!.isConnected).toBe(false);
  });
});


describe('video overlay styles and keyframed text', () => {
  it('passes gradient, alignment, italic weight, and interpolated font size to Konva', async () => {
    const store = createDesignerStore(500, 500);
    store.getState().setMode('video');
    store.getState().addTrack(0, 'shape');
    store.getState().addTrack(0, 'text');
    const vo = store.getState().doc.outputs[0] as VideoOutput;
    const shapeTrack = vo.tracks.find((track) => track.type === 'shape')!;
    const textTrack = vo.tracks.find((track) => track.type === 'text')!;
    store.getState().addClip(0, shapeTrack.id, {
      id: 'gradient-shape',
      startMs: 0,
      endMs: 1000,
      shape: 'rect',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      fillGradient: {
        type: 'linear',
        angle: 0,
        stops: [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }],
      },
    } as never);
    store.getState().addClip(0, textTrack.id, {
      id: 'aligned-text',
      startMs: 0,
      endMs: 1000,
      text: 'Aligned',
      x: 0,
      y: 0,
      width: 200,
      height: 60,
      align: 'justify',
      fontWeight: 700,
      fontStyle: 'italic',
      fontSize: 20,
      keyframes: [{ tMs: 0, props: { fontSize: 48 } }],
    } as never);
    vi.spyOn(Konva.Container.prototype, 'draw').mockImplementation(function (this: Konva.Container) {
      return this;
    });

    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(
        <Stage width={500} height={500}>
          <Layer>
            <VideoCanvasOverlay store={store} width={500} height={500} />
          </Layer>
        </Stage>
      );
    });

    const stage = Konva.stages[Konva.stages.length - 1];
    const shape = stage.findOne('#gradient-shape')!.findOne('Rect') as Konva.Rect;
    const text = stage.findOne('#aligned-text') as Konva.Text;
    expect(shape.fillLinearGradientColorStops()).toEqual([0, '#000000', 1, '#ffffff']);
    expect(text.align()).toBe('justify');
    expect(text.fontStyle()).toBe('italic 700');
    expect(text.fontSize()).toBe(48);
    expect(text.lineHeight()).toBe(1);
  });
});

describe('video overlay draw geometry', () => {
  const drawArguments = async (
    overrides: Partial<import('./designer.store').VideoClip>,
    filtered: boolean
  ): Promise<number[]> => {
    const store = videoStore({
      width: 200,
      height: 400,
      naturalWidth: 800,
      naturalHeight: 600,
      focalPoint: { x: 0.75, y: 0.25 },
      filters: filtered ? ['grayscale'] : undefined,
      ...overrides,
    });
    vi.spyOn(Konva.Container.prototype, 'draw').mockImplementation(function (this: Konva.Container) {
      return this;
    });
    const drawSpy = filtered
      ? vi.spyOn(
          Object.getPrototypeOf(document.createElement('canvas').getContext('2d')!),
          'drawImage'
        ).mockImplementation(() => undefined)
      : null;

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
    const video = document.querySelector('video')!;
    Object.defineProperty(video, 'videoWidth', { value: 800, configurable: true });
    Object.defineProperty(video, 'videoHeight', { value: 600, configurable: true });
    await act(async () => {
      video.dispatchEvent(new Event('loadeddata'));
    });

    if (drawSpy) {
      const call = drawSpy.mock.calls.at(-1);
      expect(call).toBeTruthy();
      return call!.slice(1).map(Number);
    }

    const stage = Konva.stages[Konva.stages.length - 1];
    const image = stage.findOne('#c1')!.findOne('Image') as Konva.Image;
    const crop = image.crop();
    return [
      crop.x, crop.y, crop.width, crop.height,
      image.x(), image.y(), image.width(), image.height(),
    ];
  };

  const cases = [
    {
      name: 'defaults absent fit to focal cover',
      clip: { fitMode: 'cover' as const },
      expected: [375, 0, 300, 600, 0, 0, 200, 400],
    },
    {
      name: 'contains without cropping',
      clip: { fitMode: 'contain' as const },
      expected: [0, 0, 800, 600, 0, 125, 200, 150],
    },
    {
      name: 'stretches only for explicit fill',
      clip: { fitMode: 'fill' as const },
      expected: [0, 0, 800, 600, 0, 0, 200, 400],
    },
    {
      name: 'honors explicit source crop without stretching a legacy mismatched box',
      clip: { crop: { x: 40, y: 60, width: 200, height: 100 } },
      expected: [40, 60, 200, 100, 0, 150, 200, 100],
    },
  ];

  it.each([false, true])('uses natural video metadata and cover when fit is absent (filtered=%s)', async (filtered) => {
    const { fitMode: _fitMode, ...withoutFit } = cases[0].clip;
    void _fitMode;
    expect(await drawArguments(withoutFit, filtered)).toEqual(cases[0].expected);
  });

  it.each([false, true])('matches frame-renderer arguments for every fit and crop (filtered=%s)', async (filtered) => {
    for (const testCase of cases) {
      expect(await drawArguments(testCase.clip, filtered)).toEqual(testCase.expected);
      await act(async () => root?.unmount());
      root = null;
    }
  });
});
