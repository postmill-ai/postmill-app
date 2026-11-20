import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import Konva from 'konva';
import { Stage, Layer, Transformer } from 'react-konva';
import { hasPaintableFrame, VideoCanvasOverlay } from './video-canvas-overlay';
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


const FILL_SHAPES = ['rect', 'ellipse', 'star', 'triangle', 'polygon'] as const;

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
      fill: '#ff0000',
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
      fillGradient: {
        type: 'linear',
        angle: 0,
        stops: [
          { offset: 0, color: '#000000' },
          { offset: 0.4, color: '#ff0000' },
          { offset: 1, color: '#ffffff' },
        ],
      },
      textStroke: { color: '#123456', width: 3 },
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
    expect(shape.getAttr('fill')).toBeUndefined();
    expect(text.align()).toBe('justify');
    expect(text.fontStyle()).toBe('italic 700');
    expect(text.fontSize()).toBe(48);
    expect(text.lineHeight()).toBe(1);
    expect(text.fillLinearGradientColorStops()).toEqual([
      0, '#000000', 0.4, '#ff0000', 1, '#ffffff',
    ]);
    expect(text.getAttr('fill')).toBeUndefined();
    expect(text.stroke()).toBe('#123456');
    expect(text.strokeWidth()).toBe(3);
    expect(text.fillAfterStrokeEnabled()).toBe(true);
  });

  it('does not invent an outline for a shape with strokeWidth zero', async () => {
    const store = createDesignerStore(500, 500);
    store.getState().setMode('video');
    store.getState().addTrack(0, 'shape');
    const output = store.getState().doc.outputs[0] as VideoOutput;
    const track = output.tracks.find((item) => item.type === 'shape')!;
    store.getState().addClip(0, track.id, {
      id: 'zero-stroke',
      startMs: 0,
      endMs: 1000,
      shape: 'rect',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      fill: '#ffffff',
      stroke: '#000000',
      strokeWidth: 0,
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
    const shape = stage.findOne('#zero-stroke')!.findOne('Rect') as Konva.Rect;
    expect(shape.strokeWidth()).toBe(0);
  });

  it.each(['linear', 'radial'] as const)(
    'omits solid fill and maps %s gradients for every fill-bearing shape',
    async (type) => {
      const store = createDesignerStore(500, 500);
      store.getState().setMode('video');
      store.getState().addTrack(0, 'shape');
      const output = store.getState().doc.outputs[0] as VideoOutput;
      const track = output.tracks.find((item) => item.type === 'shape')!;
      const stops = [
        { offset: 0, color: '#ff0000' },
        { offset: 0.5, color: '#00ff0080' },
        { offset: 1, color: '#0000ff' },
      ];
      for (const shape of FILL_SHAPES) {
        store.getState().addClip(0, track.id, {
          id: `gradient-${shape}`,
          startMs: 0,
          endMs: 1000,
          shape,
          x: 0,
          y: 0,
          width: 120,
          height: 80,
          rotation: shape === 'rect' ? 25 : 0,
          fill: '#112233',
          fillGradient: type === 'linear'
            ? { type, angle: 90, stops }
            : { type, focalX: 0.25, focalY: 0.75, stops },
        } as never);
      }
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
      for (const shapeName of FILL_SHAPES) {
        const group = stage.findOne(`#gradient-${shapeName}`)!;
        const node = group.findOne(
          shapeName === 'rect' ? 'Rect' : shapeName === 'ellipse' ? 'Ellipse' : 'Line'
        ) as Konva.Shape;
        const origin = shapeName === 'ellipse' ? { x: 60, y: 40 } : { x: 0, y: 0 };
        expect(node.getAttr('fill')).toBeUndefined();
        if (type === 'linear') {
          expect(node.fillLinearGradientColorStops()).toEqual([
            0, '#ff0000',
            0.5, 'rgba(0, 255, 0, 0.5019607843137255)',
            1, '#0000ff',
          ]);
          expect(node.fillLinearGradientStartPoint().x).toBeCloseTo(origin.x + 60);
          expect(node.fillLinearGradientStartPoint().y).toBeCloseTo(origin.y);
          expect(node.fillLinearGradientEndPoint().x).toBeCloseTo(origin.x + 60);
          expect(node.fillLinearGradientEndPoint().y).toBeCloseTo(origin.y + 80);
        } else {
          expect(node.fillRadialGradientStartPoint()).toEqual({ x: origin.x + 30, y: origin.y + 60 });
          expect(node.fillRadialGradientEndPoint()).toEqual({ x: origin.x + 60, y: origin.y + 40 });
          expect(node.fillRadialGradientStartRadius()).toBe(0);
          expect(node.fillRadialGradientEndRadius()).toBe(60);
          expect(node.fillRadialGradientColorStops()).toEqual([
            0, '#ff0000',
            0.5, 'rgba(0, 255, 0, 0.5019607843137255)',
            1, '#0000ff',
          ]);
        }
      }

      if (type === 'linear') {
        const rect = stage.findOne('#gradient-rect')!;
        expect(rect.rotation()).toBe(25);
        await act(async () => {
          store.getState().updateClipSilent(0, track.id, 'gradient-rect', {
            width: 240,
            height: 160,
          });
        });
        const node = rect.findOne('Rect') as Konva.Rect;
        expect(node.fillLinearGradientStartPoint().x).toBeCloseTo(120);
        expect(node.fillLinearGradientStartPoint().y).toBeCloseTo(0);
        expect(node.fillLinearGradientEndPoint().x).toBeCloseTo(120);
        expect(node.fillLinearGradientEndPoint().y).toBeCloseTo(160);
        expect(node.getAttr('fill')).toBeUndefined();
      }
    }
  );

  it('passes shape stroke color and explicit widths to Konva without changing line fallbacks', async () => {
    const store = createDesignerStore(500, 500);
    store.getState().setMode('video');
    store.getState().addTrack(0, 'shape');
    const output = store.getState().doc.outputs[0] as VideoOutput;
    const track = output.tracks.find((item) => item.type === 'shape')!;
    const widths = [4, 0, 6, 2, 10];
    FILL_SHAPES.forEach((shape, index) => {
      store.getState().addClip(0, track.id, {
        id: `stroke-${shape}`,
        startMs: 0,
        endMs: 1000,
        shape,
        x: 0,
        y: 0,
        width: 120,
        height: 80,
        fill: '#112233',
        stroke: '#123456',
        strokeWidth: widths[index],
      } as never);
    });
    store.getState().addClip(0, track.id, {
      id: 'stroke-legacy', startMs: 0, endMs: 1000, shape: 'rect',
      width: 120, height: 80, stroke: '#123456',
    } as never);
    store.getState().addClip(0, track.id, {
      id: 'stroke-no-color', startMs: 0, endMs: 1000, shape: 'rect',
      width: 120, height: 80, strokeWidth: 5,
    } as never);
    store.getState().addClip(0, track.id, {
      id: 'stroke-line', startMs: 0, endMs: 1000, shape: 'line',
      width: 120, height: 80, stroke: '#123456', strokeWidth: 0,
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
    FILL_SHAPES.forEach((shapeName, index) => {
      const group = stage.findOne(`#stroke-${shapeName}`)!;
      const node = group.findOne(
        shapeName === 'rect' ? 'Rect' : shapeName === 'ellipse' ? 'Ellipse' : 'Line'
      ) as Konva.Shape;
      expect(node.stroke()).toBe('#123456');
      expect(node.strokeWidth()).toBe(widths[index]);
    });
    expect((stage.findOne('#stroke-legacy')!.findOne('Rect') as Konva.Rect).strokeWidth()).toBe(1);
    const noColor = stage.findOne('#stroke-no-color')!.findOne('Rect') as Konva.Rect;
    expect(noColor.stroke()).toBeUndefined();
    expect(noColor.strokeWidth()).toBe(5);
    expect((stage.findOne('#stroke-line')!.findOne('Line') as Konva.Line).strokeWidth()).toBe(2);
  });

  it('restores the solid fill when a shape gradient is removed', async () => {
    const store = createDesignerStore(500, 500);
    store.getState().setMode('video');
    store.getState().addTrack(0, 'shape');
    const output = store.getState().doc.outputs[0] as VideoOutput;
    const track = output.tracks.find((item) => item.type === 'shape')!;
    store.getState().addClip(0, track.id, {
      id: 'solid-toggle',
      startMs: 0,
      endMs: 1000,
      shape: 'rect',
      width: 120,
      height: 80,
      fill: '#112233',
      fillGradient: {
        type: 'linear',
        stops: [{ offset: 0, color: '#ff0000' }, { offset: 1, color: '#0000ff' }],
      },
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

    await act(async () => {
      store.getState().updateClipSilent(0, track.id, 'solid-toggle', {
        fillGradient: undefined,
      });
    });
    const stage = Konva.stages[Konva.stages.length - 1];
    const node = stage.findOne('#solid-toggle')!.findOne('Rect') as Konva.Rect;
    expect(node.getAttr('fill')).toBe('#112233');
  });

  it('keeps the stored or default solid fill without usable gradient stops', async () => {
    const store = createDesignerStore(500, 500);
    store.getState().setMode('video');
    store.getState().addTrack(0, 'shape');
    const output = store.getState().doc.outputs[0] as VideoOutput;
    const track = output.tracks.find((item) => item.type === 'shape')!;
    store.getState().addClip(0, track.id, {
      id: 'empty-gradient',
      startMs: 0,
      endMs: 1000,
      shape: 'rect',
      width: 120,
      height: 80,
      fill: '#112233',
      fillGradient: { type: 'linear', stops: [] },
    } as never);
    store.getState().addClip(0, track.id, {
      id: 'default-solid',
      startMs: 0,
      endMs: 1000,
      shape: 'rect',
      width: 120,
      height: 80,
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
    const stored = stage.findOne('#empty-gradient')!.findOne('Rect') as Konva.Rect;
    const defaulted = stage.findOne('#default-solid')!.findOne('Rect') as Konva.Rect;
    expect(stored.getAttr('fill')).toBe('#112233');
    expect(defaulted.getAttr('fill')).toBe('#2B5CD3');
  });

  it('renders text extrusion behind the original text clip', async () => {
    const store = createDesignerStore(500, 500);
    store.getState().setMode('video');
    store.getState().addTrack(0, 'text');
    const output = store.getState().doc.outputs[0] as VideoOutput;
    const track = output.tracks.find((item) => item.type === 'text')!;
    store.getState().addClip(0, track.id, {
      id: '3d-text',
      startMs: 0,
      endMs: 1000,
      text: '3D',
      width: 200,
      height: 60,
      fill: '#ffffff',
      textExtrusion: { depth: 2, angle: 0, color: '#123456', opacity: 1 },
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
    const group = stage.findOne('#3d-text')!;
    const texts = group.find('Text') as Konva.Text[];
    expect(texts).toHaveLength(3);
    expect(texts.slice(0, 2).map((text) => text.fill())).toEqual(['#123456', '#123456']);
    expect(texts[0].x()).toBeLessThan(texts[1].x());
    expect(texts[2].fill()).toBe('#ffffff');
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

describe('video overlay selection and gesture commits', () => {
  const gestureStore = () => {
    const store = createDesignerStore(500, 400);
    store.getState().setMode('video');
    store.getState().addTrack(0, 'shape');
    const output = store.getState().doc.outputs[0] as VideoOutput;
    const track = output.tracks.find((item) => item.type === 'shape')!;
    store.getState().addClip(0, track.id, {
      id: 'first', startMs: 0, endMs: 4000, shape: 'rect',
      x: 20, y: 30, width: 80, height: 60, fill: '#ff0000',
    } as never);
    store.getState().addClip(0, track.id, {
      id: 'second', startMs: 0, endMs: 4000, shape: 'rect',
      x: 180, y: 90, width: 100, height: 50, fill: '#00ff00',
    } as never);
    return { store, trackId: track.id };
  };

  const renderGestureStore = async (store: ReturnType<typeof createDesignerStore>) => {
    vi.spyOn(Konva.Container.prototype, 'draw').mockImplementation(function (this: Konva.Container) {
      return this;
    });
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(
        <Stage width={500} height={400}>
          <Layer>
            <VideoCanvasOverlay store={store} width={500} height={400} interactive />
            <Transformer />
          </Layer>
        </Stage>
      );
    });
    return Konva.stages[Konva.stages.length - 1];
  };

  it('keeps additive selection on drag start and toggles persistent groups together', async () => {
    const { store, trackId } = gestureStore();
    const stage = await renderGestureStore(store);
    const first = stage.findOne('#first')!;
    const second = stage.findOne('#second')!;
    await act(async () => {
      first.fire('click', { evt: new MouseEvent('click') });
      second.fire('click', { evt: new MouseEvent('click', { ctrlKey: true }) });
    });
    expect(store.getState().selectedClips.map((ref) => ref.clipId)).toEqual(['first', 'second']);
    await act(async () => second.fire('dragstart'));
    expect(store.getState().selectedClips).toHaveLength(2);

    await act(async () => {
      store.getState().groupSelection();
      store.getState().setSelectedClips([]);
      first.fire('click', { evt: new MouseEvent('click') });
    });
    expect(store.getState().selectedClips).toEqual([
      { trackId, clipId: 'first' },
      { trackId, clipId: 'second' },
    ]);
    await act(async () => second.fire('click', { evt: new MouseEvent('click', { shiftKey: true }) }));
    expect(store.getState().selectedClips).toEqual([]);
  });

  it('commits every attached drag member once with one history entry and one-step undo', async () => {
    const { store, trackId } = gestureStore();
    store.getState().setSelectedClips([
      { trackId, clipId: 'first' },
      { trackId, clipId: 'second' },
    ]);
    const stage = await renderGestureStore(store);
    const first = stage.findOne('#first')!;
    const second = stage.findOne('#second')!;
    const transformer = stage.findOne('Transformer') as Konva.Transformer;
    await act(async () => transformer.nodes([first, second]));
    first.position({ x: 45, y: 55 });
    second.position({ x: 205, y: 115 });
    const depth = store.getState().history.length;
    await act(async () => first.fire('dragstart'));
    expect(store.getState().gestureDepth).toBe(1);
    await act(async () => {
      first.fire('dragend');
      second.fire('dragend');
    });

    const clips = (store.getState().doc.outputs[0] as VideoOutput).tracks.find((track) => track.id === trackId)!.clips;
    expect(clips.map((clip) => [clip.x, clip.y])).toEqual([[45, 55], [205, 115]]);
    expect(store.getState().history.length).toBe(depth + 1);
    expect(store.getState().gestureDepth).toBe(0);
    await act(async () => store.getState().undo());
    const restored = (store.getState().doc.outputs[0] as VideoOutput).tracks.find((track) => track.id === trackId)!.clips;
    expect(restored.map((clip) => [clip.x, clip.y])).toEqual([[20, 30], [180, 90]]);
  });

  it('batch-transforms each member and refuses geometry on locked tracks', async () => {
    const { store, trackId } = gestureStore();
    store.getState().setSelectedClips([
      { trackId, clipId: 'first' },
      { trackId, clipId: 'second' },
    ]);
    const stage = await renderGestureStore(store);
    const first = stage.findOne('#first')!;
    const second = stage.findOne('#second')!;
    const transformer = stage.findOne('Transformer') as Konva.Transformer;
    await act(async () => transformer.nodes([first, second]));
    first.scale({ x: 2, y: 1.5 });
    second.scale({ x: 0.5, y: 2 });
    const depth = store.getState().history.length;
    await act(async () => {
      first.fire('transformstart');
      second.fire('transformstart');
    });
    expect(store.getState().gestureDepth).toBe(1);
    await act(async () => {
      first.fire('transformend');
      second.fire('transformend');
    });
    let clips = (store.getState().doc.outputs[0] as VideoOutput).tracks.find((track) => track.id === trackId)!.clips;
    expect(clips.map((clip) => [clip.width, clip.height])).toEqual([[160, 90], [50, 100]]);
    expect(store.getState().history.length).toBe(depth + 1);
    expect(store.getState().gestureDepth).toBe(0);

    await act(async () => store.getState().setTrackLocked(0, trackId, true));
    const lockedDepth = store.getState().history.length;
    first.position({ x: 300, y: 200 });
    await act(async () => first.fire('dragend'));
    clips = (store.getState().doc.outputs[0] as VideoOutput).tracks.find((track) => track.id === trackId)!.clips;
    expect(clips[0].x).toBe(20);
    expect(clips[0].y).toBe(30);
    expect(store.getState().history.length).toBe(lockedDepth);
    expect(first.draggable()).toBe(false);
  });

  it('tracks a second drag that starts before the first commit finishes', async () => {
    const { store, trackId } = gestureStore();
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return 0;
    });
    const stage = await renderGestureStore(store);
    const first = stage.findOne('#first')!;
    const second = stage.findOne('#second')!;
    const depth = store.getState().history.length;

    await act(async () => {
      first.fire('dragstart');
      first.position({ x: 45, y: 55 });
      first.fire('dragend');
      second.fire('dragstart');
      second.position({ x: 205, y: 115 });
      frames.splice(0).forEach((callback) => callback(0));
      second.fire('dragend');
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const clips = (store.getState().doc.outputs[0] as VideoOutput).tracks
      .find((track) => track.id === trackId)!.clips;
    expect(clips.map((clip) => [clip.x, clip.y])).toEqual([[45, 55], [205, 115]]);
    expect(store.getState().history).toHaveLength(depth + 2);
    expect(store.getState().gestureDepth).toBe(0);
  });

  it.each(['delete', 'playhead'] as const)('releases a held transform when the clip leaves the stage (%s)', async (reason) => {
    const { store, trackId } = gestureStore();
    const stage = await renderGestureStore(store);
    const first = stage.findOne('#first')!;
    await act(async () => first.fire('transformstart'));
    expect(store.getState().gestureDepth).toBe(1);

    await act(async () => {
      if (reason === 'delete') store.getState().removeClip(0, trackId, 'first');
      else store.getState().setPlayhead(5000);
    });
    expect(store.getState().gestureDepth).toBe(0);
  });

  it('releases a held drag when the overlay unmounts', async () => {
    const { store } = gestureStore();
    const stage = await renderGestureStore(store);
    await act(async () => stage.findOne('#first')!.fire('dragstart'));
    expect(store.getState().gestureDepth).toBe(1);

    await act(async () => root?.unmount());
    root = null;
    expect(store.getState().gestureDepth).toBe(0);
  });
});

describe('paintable media frames', () => {
  it('rejects unloaded and broken images, videos, and masks', () => {
    expect(hasPaintableFrame(null)).toBe(false);
    expect(hasPaintableFrame({ naturalWidth: 0 })).toBe(false);
    expect(hasPaintableFrame({ videoWidth: 0, width: 300 })).toBe(false);
    expect(hasPaintableFrame({ naturalWidth: 640 })).toBe(true);
    expect(hasPaintableFrame({ videoWidth: 640 })).toBe(true);
    expect(hasPaintableFrame({ width: 640 })).toBe(true);
  });
});


describe('motion path recording and editing', () => {
  it('records a multi-point path and edits it with atomic history entries', async () => {
    const store = videoStore();
    let now = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    vi.spyOn(Konva.Container.prototype, 'draw').mockImplementation(function (this: Konva.Container) {
      return this;
    });
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(
        <Stage width={1080} height={1080}>
          <Layer>
            <VideoCanvasOverlay store={store} width={1080} height={1080} interactive />
          </Layer>
        </Stage>
      );
    });
    const stage = Konva.stages[Konva.stages.length - 1];
    const trackId = store.getState().doc.outputs[0].tracks[0].id;
    expect(store.getState().startMotionPathRecording(0, trackId, 'c1')).toBe(true);
    const historyBefore = store.getState().history.length;
    const node = stage.findOne('#c1')!;

    await act(async () => node.fire('dragstart'));
    await act(async () => {
      now += 500;
      node.position({ x: 100, y: 100 });
      node.fire('dragmove');
    });
    await act(async () => {
      now += 500;
      node.position({ x: 200, y: 50 });
      node.fire('dragmove');
    });
    await act(async () => node.fire('dragend'));

    let clip = store.getState().doc.outputs[0].tracks[0].clips[0];
    expect(clip.motionPath?.points).toEqual([
      { x: 0, y: 0, tMs: 0 },
      { x: 100, y: 100, tMs: 500 },
      { x: 200, y: 50, tMs: 1000 },
    ]);
    expect(clip).toMatchObject({ x: 0, y: 0, width: 400, height: 300 });
    expect(store.getState().doc.version).toBe(15);
    expect(store.getState().history).toHaveLength(historyBefore + 1);
    expect(store.getState().motionPathRecording).toBeNull();
    expect(store.getState().gestureDepth).toBe(0);
    expect(stage.find('Ellipse').length).toBe(3);

    const point = stage.find('Ellipse')[1];
    await act(async () => point.fire('dragstart'));
    await act(async () => {
      point.position({ x: 120, y: 140 });
      point.fire('dragmove');
    });
    await act(async () => point.fire('dragend'));
    clip = store.getState().doc.outputs[0].tracks[0].clips[0];
    expect(clip.motionPath?.points[1]).toMatchObject({ x: 120, y: 140 });
    expect(store.getState().history).toHaveLength(historyBefore + 2);

    const segment = stage.find('Line').find((node) => node.name() === 'motion-path-segment')!;
    await act(async () => segment.fire('click', { evt: new MouseEvent('click') }));
    clip = store.getState().doc.outputs[0].tracks[0].clips[0];
    expect(clip.motionPath?.points).toHaveLength(4);
    expect(store.getState().history).toHaveLength(historyBefore + 3);

    const points = stage.find('Ellipse');
    await act(async () => points[0].fire('contextmenu', { evt: new MouseEvent('contextmenu') }));
    clip = store.getState().doc.outputs[0].tracks[0].clips[0];
    expect(clip.motionPath?.points).toHaveLength(3);
    expect(store.getState().history).toHaveLength(historyBefore + 4);

    await act(async () => store.getState().undo());
    expect(store.getState().doc.outputs[0].tracks[0].clips[0].motionPath?.points).toHaveLength(4);
  });

  it('selects a path point on tap for Inspector editing', async () => {
    const store = videoStore({
      motionPath: {
        points: [
          { x: 0, y: 0, tMs: 0 },
          { x: 100, y: 100, tMs: 1000 },
          { x: 200, y: 50, tMs: 2000 },
        ],
      },
    });
    const trackId = store.getState().doc.outputs[0].tracks[0].id;
    store.getState().setSelectedClip({ outputIndex: 0, trackId, clipId: 'c1' });
    vi.spyOn(Konva.Container.prototype, 'draw').mockImplementation(function (this: Konva.Container) {
      return this;
    });
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(
        <Stage width={1080} height={1080}>
          <Layer>
            <VideoCanvasOverlay store={store} width={1080} height={1080} interactive />
          </Layer>
        </Stage>
      );
    });
    const stage = Konva.stages[Konva.stages.length - 1];
    const point = stage.find('Ellipse').find((node) => node.name() === 'motion-path-point')!;

    expect(store.getState().motionPathPointIndex).toBeNull();
    await act(async () => point.fire('tap'));
    expect(store.getState().motionPathPointIndex).toBe(0);
  });
});


describe('motion path recording clock', () => {
  it('starts elapsed time at dragstart rather than the Inspector click', async () => {
    const store = videoStore();
    let now = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    vi.spyOn(Konva.Container.prototype, 'draw').mockImplementation(function (this: Konva.Container) {
      return this;
    });
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(
        <Stage width={1080} height={1080}>
          <Layer>
            <VideoCanvasOverlay store={store} width={1080} height={1080} interactive />
          </Layer>
        </Stage>
      );
    });
    const stage = Konva.stages[Konva.stages.length - 1];
    const trackId = store.getState().doc.outputs[0].tracks[0].id;
    expect(store.getState().startMotionPathRecording(0, trackId, 'c1')).toBe(true);
    now += 1500;
    const node = stage.findOne('#c1')!;
    await act(async () => node.fire('dragstart'));
    await act(async () => {
      now += 500;
      node.position({ x: 100, y: 100 });
      node.fire('dragmove');
    });
    await act(async () => node.fire('dragend'));

    expect(store.getState().doc.outputs[0].tracks[0].clips[0].motionPath?.points)
      .toEqual([{ x: 0, y: 0, tMs: 0 }, { x: 100, y: 100, tMs: 500 }]);
    expect(store.getState().motionPathRecording).toBeNull();
  });
});
