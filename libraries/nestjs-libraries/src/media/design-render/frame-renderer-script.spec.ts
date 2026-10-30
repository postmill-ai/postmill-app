import { describe, it, expect, vi } from 'vitest';
import { escapeForScriptTag, FRAME_RENDERER_SCRIPT, stripExportsNamespace } from './frame-renderer-script';
import { interpolateClipKeyframes } from '../designer-doc/keyframes';
import { sourceTimeForPlayhead } from '../designer-doc/speed-curve';
import { transitionAdjustment } from '../designer-doc/transitions';

describe('escapeForScriptTag (0.2 </script> breakout)', () => {
  it('neutralizes a </script> breakout in a user-controlled composition value', () => {
    const output = { name: '</script><script>window.__pwned=1</script>' };
    const escaped = escapeForScriptTag(output);

    // The literal closing tag must not survive — no way to end the inline <script>.
    expect(escaped).not.toContain('</script>');
    expect(escaped.toLowerCase()).not.toContain('</script');
    expect(escaped).toContain('\\u003c');

    // Still valid JSON that parses back to the original string (browser sees inert data).
    expect(JSON.parse(escaped)).toEqual(output);
  });

  it('escapes U+2028 / U+2029 line separators that break JS string literals', () => {
    const LS = String.fromCharCode(0x2028);
    const PS = String.fromCharCode(0x2029);
    const raw = `a${LS}b${PS}c`;
    const escaped = escapeForScriptTag(raw);
    expect(escaped).toContain('\\u2028');
    expect(escaped).toContain('\\u2029');
    expect(escaped).not.toContain(LS);
    expect(escaped).not.toContain(PS);
    expect(JSON.parse(escaped)).toBe(raw);
  });

  it('leaves ordinary values intact (round-trips through JSON)', () => {
    const value = { width: 1080, tracks: [{ clips: [{ src: 'https://x/y.png' }] }] };
    expect(JSON.parse(escapeForScriptTag(value))).toEqual(value);
  });
});

/**
 * The third renderer is a string. Nothing type-checks it and nothing imports
 * it, so a broken edit is invisible until a video render fails in production —
 * these run it in a stub page instead.
 */
describe('FRAME_RENDERER_SCRIPT', () => {
  const stubContext = () =>
    new Proxy(
      {},
      {
        get: (_t, prop) => {
          if (prop === 'canvas') return { width: 10, height: 10 };
          return () => undefined;
        },
        set: () => true,
      }
    );

  const run = (output: unknown, context = stubContext()) => {
    const canvas = { width: 0, height: 0, getContext: () => context };
    const win: Record<string, unknown> = {
      __DATA: { output, baseUrl: 'https://example.test' },
    };
    const doc = {
      getElementById: () => canvas,
      // The background-texture overlay builds its tile through this.
      createElement: () => ({ width: 0, height: 0, getContext: () => stubContext() }),
    };
    const fn = new Function('window', 'document', 'Image', FRAME_RENDERER_SCRIPT);
    fn(win, doc, class {});
    return win.__FRAME_API as {
      preload: () => Promise<void>;
      renderFrame: (ms: number) => Promise<void>;
    };
  };

  const output = {
    id: 'o',
    width: 100,
    height: 100,
    fps: 30,
    durationMs: 1000,
    background: '#000000',
    tracks: [
      {
        id: 'tr',
        type: 'shape',
        clips: [
          {
            id: 'c',
            startMs: 0,
            endMs: 1000,
            shape: 'rect',
            fill: '#ff0000',
            x: 0, y: 0, width: 50, height: 50,
            keyframes: [
              { tMs: 0, props: { x: 0 }, ease: { out: [0.42, 0] } },
              { tMs: 1000, props: { x: 80 }, ease: { in: [0.58, 1] } },
            ],
          },
        ],
      },
    ],
  };

  it('parses and exposes its API', () => {
    const api = run(output);
    expect(typeof api.renderFrame).toBe('function');
    expect(typeof api.preload).toBe('function');
  });

  it('contains no CJS `exports.` references — the browser page has no module namespace', () => {
    // The ...Source() injectors serialize functions with String(fn) over the
    // CJS-compiled build, where tsc rewrites references to exported bindings
    // as `exports.X`. Any leak throws ReferenceError in the render page the
    // first time that code path runs (keyframe easing defaults, shape
    // geometry, caption karaoke). Guard the assembled script.
    expect(FRAME_RENDERER_SCRIPT).not.toMatch(/\bexports\./);
    expect(FRAME_RENDERER_SCRIPT).not.toMatch(/\brequire\(/);
  });

  it('strips tsc CommonJS import aliases from injected function source', () => {
    const source = 'const build = (x) => (0, canvas_color_1.canvasColor)(x);';
    expect(stripExportsNamespace(source)).toBe('const build = (x) => (0, canvasColor)(x);');
  });

  it('eases keyframes that carry NO explicit ease (default-handle path)', async () => {
    // Regression: default ease handles are the compiled-CJS `exports.*` path.
    // A clip keyframed by a canvas drag has no ease handles at all.
    const bare = {
      ...output,
      tracks: [
        {
          id: 'tr',
          type: 'shape',
          clips: [
            {
              ...output.tracks[0].clips[0],
              keyframes: [
                { tMs: 0, props: { x: 0 } },
                { tMs: 1000, props: { x: 80 } },
              ],
            },
          ],
        },
      ],
    };
    const api = run(bare);
    await expect(api.renderFrame(500)).resolves.toBeUndefined();
  });

  it('renders a frame without throwing', async () => {
    const api = run(output);
    await expect(api.renderFrame(500)).resolves.toBeUndefined();
  });

  it('uses shared Konva-style wrapping, centered baselines and keyframed font size', async () => {
    const calls: { text: string; x: number; y: number }[] = [];
    const state: Record<string, unknown> = {
      canvas: { width: 100, height: 100 },
      measureText: (text: string) => ({ width: [...text].length * 10 }),
      fillText: (text: string, x: number, y: number) => calls.push({ text, x, y }),
    };
    const context = new Proxy(state, {
      get: (target, prop) => prop in target ? target[prop as string] : () => undefined,
      set: (target, prop, value) => { target[prop as string] = value; return true; },
    });
    const textOutput = {
      ...output,
      tracks: [{
        id: 'text-track',
        type: 'text',
        clips: [{
          id: 'text-clip',
          startMs: 0,
          endMs: 1000,
          text: 'ab cd',
          x: 0,
          y: 0,
          width: 45,
          height: 30,
          fontSize: 10,
          align: 'center',
          keyframes: [{ tMs: 0, props: { fontSize: 10 } }],
        }],
      }],
    };
    const api = run(textOutput, context as never);
    await api.renderFrame(0);

    expect(state.textBaseline).toBe('middle');
    expect(state.textAlign).toBe('left');
    expect(state.font).toBe('400 10px "Arial"');
    expect(calls).toEqual([
      { text: 'ab', x: 12.5, y: 5 },
      { text: 'cd', x: 12.5, y: 15 },
    ]);
  });

  it('builds shape fill gradients through the shared gradient painter', async () => {
    const stops: [number, string][] = [];
    const gradient = { addColorStop: (offset: number, color: string) => stops.push([offset, color]) };
    const state: Record<string, unknown> = {
      canvas: { width: 100, height: 100 },
      createLinearGradient: () => gradient,
    };
    const context = new Proxy(state, {
      get: (target, prop) => prop in target ? target[prop as string] : () => undefined,
      set: (target, prop, value) => { target[prop as string] = value; return true; },
    });
    const gradientOutput = {
      ...output,
      tracks: [{
        ...output.tracks[0],
        clips: [{
          ...output.tracks[0].clips[0],
          keyframes: undefined,
          fillGradient: {
            type: 'linear',
            angle: 0,
            stops: [{ offset: 0, color: '#000000' }, { offset: 1, color: '#FFFFFF80' }],
          },
        }],
      }],
    };
    const api = run(gradientOutput, context as never);
    await api.renderFrame(0);

    expect(state.fillStyle).toBe(gradient);
    expect(stops).toEqual([[0, '#000000'], [1, 'rgba(255, 255, 255, 0.5019607843137255)']]);
  });

  it('paints a background texture with the SHARED generator, not a copy', async () => {
    // The texture overlay must come from the injected background-texture
    // source — a hand-written grain here would drift from the page render.
    expect(FRAME_RENDERER_SCRIPT).toContain('drawTextureTile');
    expect(FRAME_RENDERER_SCRIPT).toContain('textureNoise');
    expect(FRAME_RENDERER_SCRIPT).toContain('drawTextureOverlay');

    const textured = {
      ...output,
      bg: { type: 'color', color: '#224488', texture: { type: 'grain', intensity: 0.5, seed: 4 } },
    };
    const api = run(textured);
    await expect(api.renderFrame(500)).resolves.toBeUndefined();
  });

  it('eases with the SHARED keyframe module, not a copy of it', async () => {
    // The injected source is the parity mechanism; if the script fell back to a
    // hand-written easing, an exported mp4 would move differently from the
    // preview it was authored in.
    expect(FRAME_RENDERER_SCRIPT).toContain('interpolateClipKeyframes');
    expect(FRAME_RENDERER_SCRIPT).toContain('cubicBezierEase');

    const fn = new Function(
      `${FRAME_RENDERER_SCRIPT.slice(
        FRAME_RENDERER_SCRIPT.indexOf('(function () {') + '(function () {'.length,
        FRAME_RENDERER_SCRIPT.indexOf('const output = window.__DATA.output')
      )}
      return interpolateClipKeyframes;`
    ) as () => typeof interpolateClipKeyframes;

    const injected = fn();
    const clip = output.tracks[0].clips[0] as never;
    for (const ms of [0, 250, 500, 750, 1000]) {
      expect(injected(clip, ms).x).toBeCloseTo(interpolateClipKeyframes(clip, ms).x, 6);
    }
  });

  it('seeks frames with the SHARED speed mapping, not a hand-mirrored copy', async () => {
    // The injected speed-curve source is the parity mechanism; the previous
    // hand-written copy here had already drifted (it never froze a speed:0
    // clip), so the script must not grow one again.
    expect(FRAME_RENDERER_SCRIPT).toContain('sourceTimeForClipTime');
    expect(FRAME_RENDERER_SCRIPT).toContain('curveIntegratedMs');
    expect(FRAME_RENDERER_SCRIPT).not.toContain('function sourceTimeForPlayhead');

    const fn = new Function(
      `${FRAME_RENDERER_SCRIPT.slice(
        FRAME_RENDERER_SCRIPT.indexOf('(function () {') + '(function () {'.length,
        FRAME_RENDERER_SCRIPT.indexOf('const output = window.__DATA.output')
      )}
      return sourceTimeForPlayhead;`
    ) as () => typeof sourceTimeForPlayhead;

    const injected = fn();
    const ramp = [
      { atMs: 0, speed: 1 },
      { atMs: 1000, speed: 3 },
    ];
    const cases = [
      { startMs: 0, endMs: 4000 },
      { startMs: 0, endMs: 4000, speed: 2, trimInMs: 100 },
      { startMs: 0, endMs: 4000, speed: 0, trimInMs: 250 },
      { startMs: 0, endMs: 4000, reverse: true, speed: 0.5 },
      { startMs: 0, endMs: 4000, freezeAtMs: 500, speed: 2 },
      { startMs: 0, endMs: 4000, speedCurve: ramp },
      { startMs: 0, endMs: 4000, speedCurve: ramp, reverse: true, trimInMs: 300 },
      { startMs: 0, endMs: 4000, speedCurve: ramp, freezeAtMs: 500 },
    ];
    for (const c of cases) {
      for (const ms of [-1, 0, 500, 1000, 2500, 4000, 4500, 5000]) {
        const a = sourceTimeForPlayhead(c, ms);
        const b = injected(c, ms);
        if (a === null || b === null) expect(b).toBe(a);
        else expect(b).toBeCloseTo(a, 9);
      }
    }
  });

  it('sets globalCompositeOperation from clip.blendMode for the clip draw', async () => {
    // A recording context (the Proxy stub swallows sets) pins the drawClip
    // contract: the clip's own draw composites under its blend mode, framed by
    // the frame-start 'source-over' reset.
    const gcoWrites: string[] = [];
    const recordingContext = () => {
      const ctx: Record<string, unknown> = { canvas: { width: 10, height: 10 } };
      return new Proxy(ctx, {
        get: (t, prop) => {
          if (prop in t) return t[prop as string];
          return () => undefined;
        },
        set: (t, prop, value) => {
          if (prop === 'globalCompositeOperation') gcoWrites.push(value as string);
          t[prop as string] = value;
          return true;
        },
      });
    };
    const canvas = { width: 0, height: 0, getContext: () => recordingContext() };
    const win: Record<string, unknown> = {
      __DATA: {
        output: {
          ...output,
          tracks: [
            {
              id: 'tr',
              type: 'shape',
              clips: [
                {
                  id: 'c',
                  startMs: 0,
                  endMs: 1000,
                  shape: 'rect',
                  fill: '#ff0000',
                  x: 0, y: 0, width: 50, height: 50,
                  blendMode: 'multiply',
                },
              ],
            },
          ],
        },
        baseUrl: 'https://example.test',
      },
    };
    const doc = {
      getElementById: () => canvas,
      createElement: () => ({ width: 0, height: 0, getContext: () => recordingContext() }),
    };
    const fn = new Function('window', 'document', 'Image', FRAME_RENDERER_SCRIPT);
    fn(win, doc, class {});
    const api = win.__FRAME_API as { renderFrame: (ms: number) => Promise<void> };
    await api.renderFrame(500);
    expect(gcoWrites[0]).toBe('source-over');
    expect(gcoWrites).toContain('multiply');
  });

  it('draws a textReveal clip as a growing prefix, via the SHARED module', async () => {
    // Parity pin, same family as keyframes/speed-curve/transitions: the reveal
    // slice must come from the injected designer-doc/text-reveal source.
    expect(FRAME_RENDERER_SCRIPT).toContain('applyTextReveal');
    expect(FRAME_RENDERER_SCRIPT).toContain('textRevealProgress');

    const fillCalls: string[] = [];
    const recordingContext = () => {
      const ctx: Record<string, unknown> = {
        canvas: { width: 10, height: 10 },
        measureText: (s: string) => ({ width: (s || '').length * 10 }),
        fillText: (s: string) => {
          fillCalls.push(s);
        },
      };
      return new Proxy(ctx, {
        get: (t, prop) => {
          if (prop in t) return t[prop as string];
          return () => undefined;
        },
        set: (t, prop, value) => {
          t[prop as string] = value;
          return true;
        },
      });
    };
    const canvas = { width: 0, height: 0, getContext: () => recordingContext() };
    const win: Record<string, unknown> = {
      __DATA: {
        output: {
          id: 'o',
          width: 100,
          height: 100,
          fps: 30,
          durationMs: 1000,
          background: '#000000',
          tracks: [
            {
              id: 'tt',
              type: 'text',
              clips: [
                {
                  id: 'c',
                  startMs: 0,
                  endMs: 1000,
                  text: '0123456789',
                  x: 0, y: 0, width: 100, height: 40,
                  // 10 chars over a 1000ms window → one char per 100ms.
                  textReveal: { mode: 'chars', durationMs: 1000 },
                },
              ],
            },
          ],
        },
        baseUrl: 'https://example.test',
      },
    };
    const doc = {
      getElementById: () => canvas,
      createElement: () => ({ width: 0, height: 0, getContext: () => recordingContext() }),
    };
    const fn = new Function('window', 'document', 'Image', FRAME_RENDERER_SCRIPT);
    fn(win, doc, class {});
    const api = win.__FRAME_API as { renderFrame: (ms: number) => Promise<void> };

    await api.renderFrame(350);
    // Mid-reveal: only the 4-char prefix is wrapped/drawn.
    expect(fillCalls).toEqual(['0123']);

    await api.renderFrame(1000);
    // Fully revealed by the window end.
    expect(fillCalls[fillCalls.length - 1]).toBe('0123456789');
  });
});

describe('FRAME_RENDERER_SCRIPT — transitions and hidden tracks', () => {
  // Same stub page as the main block above (scoped there, so re-declared).
  const stubContext = () =>
    new Proxy(
      {},
      {
        get: (_t, prop) => {
          if (prop === 'canvas') return { width: 10, height: 10 };
          return () => undefined;
        },
        set: () => true,
      }
    );

  it('composes transitions with the SHARED module, not a hand-mirrored copy', () => {
    // Same parity pin as keyframes/speed-curve: the injected source must BE
    // designer-doc/transitions, so the export cannot drift from the preview.
    expect(FRAME_RENDERER_SCRIPT).toContain('transitionAdjustment');
    expect(FRAME_RENDERER_SCRIPT).toContain('applyTransitionAdjustment');
    expect(FRAME_RENDERER_SCRIPT).toContain('TRANSITION_MAX_BLUR_PX');

    const fn = new Function(
      `${FRAME_RENDERER_SCRIPT.slice(
        FRAME_RENDERER_SCRIPT.indexOf('(function () {') + '(function () {'.length,
        FRAME_RENDERER_SCRIPT.indexOf('const output = window.__DATA.output')
      )}
      return transitionAdjustment;`
    ) as () => typeof transitionAdjustment;

    const injected = fn();
    const types = ['cut', 'fade', 'dissolve', 'slide', 'wipe', 'zoom', 'blur'] as const;
    for (const type of types) {
      for (const p of [0, 0.25, 0.5, 0.75, 1]) {
        for (const isIncoming of [true, false]) {
          expect(injected(type, 'left', p, isIncoming, 200, 100)).toEqual(
            transitionAdjustment(type, 'left', p, isIncoming, 200, 100)
          );
        }
      }
    }
  });

  it('renders a frame with wipe/zoom/blur transitions and a hidden track without throwing', async () => {
    const canvas = { width: 0, height: 0, getContext: () => stubContext() };
    const win: Record<string, unknown> = {
      __DATA: { output: null, baseUrl: 'https://example.test' },
    };
    const doc = {
      getElementById: () => canvas,
      createElement: () => ({ width: 0, height: 0, getContext: () => stubContext() }),
    };
    win.__DATA = {
      output: {
        id: 'o',
        width: 100,
        height: 100,
        fps: 30,
        durationMs: 2000,
        background: '#000000',
        tracks: [
          {
            id: 'tr1',
            type: 'shape',
            clips: [
              {
                id: 'a',
                startMs: 0,
                endMs: 1000,
                shape: 'rect',
                fill: '#ff0000',
                x: 0, y: 0, width: 50, height: 50,
                transitionOut: { type: 'wipe', durationMs: 400, direction: 'left' },
              },
              {
                id: 'b',
                startMs: 1000,
                endMs: 2000,
                shape: 'rect',
                fill: '#00ff00',
                x: 0, y: 0, width: 50, height: 50,
                transitionIn: { type: 'wipe', durationMs: 400, direction: 'left' },
              },
              {
                id: 'c',
                startMs: 600,
                endMs: 1400,
                shape: 'ellipse',
                fill: '#0000ff',
                x: 10, y: 10, width: 30, height: 30,
                transitionIn: { type: 'blur', durationMs: 300 },
              },
            ],
          },
          {
            id: 'tr2',
            type: 'shape',
            hidden: true,
            clips: [
              { id: 'h', startMs: 0, endMs: 2000, shape: 'rect', fill: '#ffffff', x: 0, y: 0, width: 20, height: 20 },
            ],
          },
        ],
      },
      baseUrl: 'https://example.test',
    };
    const fn = new Function('window', 'document', 'Image', FRAME_RENDERER_SCRIPT);
    fn(win, doc, class {});
    const api = win.__FRAME_API as { renderFrame: (ms: number) => Promise<void> };
    // Inside the wipe window (800-1000) and the blur window (600-900).
    await expect(api.renderFrame(850)).resolves.toBeUndefined();
  });
});

describe('FRAME_RENDERER_SCRIPT — video capture hardening', () => {
  const stubContext = () =>
    new Proxy(
      {},
      {
        get: (_t, prop) => {
          if (prop === 'canvas') return { width: 10, height: 10 };
          return () => undefined;
        },
        set: () => true,
      }
    );

  // A video element whose load succeeds (src assignment fires onloadeddata on a
  // microtask, like a fast cache hit). Seeking only fires 'seeked' when
  // `seekedOnSet` is on — off is the wedge that used to hang a capture stride
  // forever. `seekedOnLoad` models what a reload does to the wedge (null =
  // reload changes nothing).
  class FakeVideo {
    style: Record<string, string> = {};
    muted = false;
    playsInline = false;
    crossOrigin = '';
    preload = '';
    seekedOnSet = false;
    seekedOnLoad: boolean | null = null;
    loadCalls = 0;
    onloadeddata: (() => void) | null = null;
    onerror: (() => void) | null = null;
    listeners: Record<string, Array<() => void>> = {};
    private _src = '';
    private _currentTime = 0;
    get src() {
      return this._src;
    }
    set src(url: string) {
      this._src = url;
      this.fireLoaded();
    }
    load() {
      this.loadCalls++;
      // A real load() rewinds to the start and re-fires loadeddata.
      this._currentTime = 0;
      if (this.seekedOnLoad !== null) this.seekedOnSet = this.seekedOnLoad;
      this.fireLoaded();
    }
    private fireLoaded() {
      queueMicrotask(() => {
        this.onloadeddata?.();
        (this.listeners['loadeddata'] || []).forEach((fn) => fn());
      });
    }
    get currentTime() {
      return this._currentTime;
    }
    set currentTime(t: number) {
      this._currentTime = t;
      if (this.seekedOnSet) {
        queueMicrotask(() => (this.listeners['seeked'] || []).forEach((fn) => fn()));
      }
    }
    addEventListener(name: string, fn: () => void) {
      (this.listeners[name] ||= []).push(fn);
    }
    removeEventListener(name: string, fn: () => void) {
      this.listeners[name] = (this.listeners[name] || []).filter((f) => f !== fn);
    }
  }

  const runWithVideo = (seekedOnSet = false) => {
    const videos: FakeVideo[] = [];
    const canvas = { width: 0, height: 0, getContext: () => stubContext() };
    const win: Record<string, unknown> = {
      __DATA: {
        output: {
          id: 'o',
          width: 100,
          height: 100,
          fps: 30,
          durationMs: 1000,
          background: '#000000',
          tracks: [
            {
              id: 'tv',
              type: 'video',
              clips: [
                {
                  id: 'v',
                  type: 'video',
                  src: 'https://example.test/clip.mp4',
                  startMs: 0,
                  endMs: 1000,
                  x: 0, y: 0, width: 50, height: 50,
                },
              ],
            },
          ],
        },
        baseUrl: 'https://example.test',
      },
    };
    const doc = {
      getElementById: () => canvas,
      body: { appendChild: () => {} },
      createElement: (tag: string) => {
        if (tag === 'video') {
          const video = new FakeVideo();
          video.seekedOnSet = seekedOnSet;
          videos.push(video);
          return video;
        }
        return { width: 0, height: 0, getContext: () => stubContext() };
      },
    };
    const fn = new Function('window', 'document', 'Image', FRAME_RENDERER_SCRIPT);
    fn(win, doc, class {});
    return {
      api: win.__FRAME_API as {
        preload: () => Promise<void>;
        renderFrame: (ms: number) => Promise<void>;
      },
      videos,
    };
  };

  it('seekVideo resolves after a 5s timeout when seeked never fires', async () => {
    vi.useFakeTimers();
    try {
      const { api, videos } = runWithVideo();
      let settled = false;
      const p = api.renderFrame(500).then(() => {
        settled = true;
      });

      // Let the microtask-driven load land so the frame parks inside seekVideo.
      for (let i = 0; i < 10; i++) await Promise.resolve();
      expect(videos).toHaveLength(1);
      expect(videos[0].currentTime).toBe(0.5); // the seek was attempted
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(4999);
      expect(settled).toBe(false); // still parked just before the timeout
      await vi.advanceTimersByTimeAsync(1);
      await p; // resolves via the timeout, without a 'seeked' event
      expect(settled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('preload warms videos eagerly on every capture page', async () => {
    // Hidden headless pages cannot create media pipelines at all (the fetch
    // parks forever), so per-frame lazy video creation wedges at clip
    // switches; warmup must happen during setup, while the page is visible.
    const eager = runWithVideo();
    await eager.api.preload();
    expect(eager.videos).toHaveLength(1);
  });

  it('sets preload=auto so the browser keeps the clip buffered', async () => {
    // 'metadata' (the default) lets the browser discard the buffer under
    // memory pressure; every seek then re-fetches a CDN range — the wedge
    // pattern behind the 10s/frame render stall.
    const { api, videos } = runWithVideo(true);
    await api.preload();
    expect(videos).toHaveLength(1);
    expect(videos[0].preload).toBe('auto');
  });

  // Renders one frame, advancing fake time until it settles; returns the
  // rejection (null on success). A wedged frame settles after SEEK_TIMEOUT_MS,
  // a wedged reload+reseek after ~2x that.
  const frameOutcome = async (
    api: { renderFrame: (ms: number) => Promise<void> },
    ms: number,
  ): Promise<unknown> => {
    let error: unknown = null;
    let settled = false;
    const p = api.renderFrame(ms).then(
      () => {
        settled = true;
      },
      (e) => {
        settled = true;
        error = e;
      },
    );
    // Flush the microtask-driven load so the frame parks inside the seek.
    for (let i = 0; i < 20; i++) await Promise.resolve();
    for (let guard = 0; guard < 60 && !settled; guard++) {
      await vi.advanceTimersByTimeAsync(1000);
      for (let i = 0; i < 10; i++) await Promise.resolve();
    }
    await p;
    if (!settled) throw new Error('frame did not settle within 60s of fake time');
    return error;
  };

  it('reloads a wedged video element ONCE after 3 consecutive wedged seeks, then recovers', async () => {
    vi.useFakeTimers();
    try {
      const { api, videos } = runWithVideo();
      expect(await frameOutcome(api, 100)).toBeNull(); // wedge 1
      expect(await frameOutcome(api, 200)).toBeNull(); // wedge 2
      expect(videos[0].loadCalls).toBe(0); // streak below the threshold — no reload yet

      videos[0].seekedOnLoad = true; // the reload recovers the element
      expect(await frameOutcome(api, 300)).toBeNull(); // wedge 3 → reload + reseek succeeds
      expect(videos[0].loadCalls).toBe(1);

      // Recovered: further frames seek cleanly with no second reload.
      expect(await frameOutcome(api, 400)).toBeNull();
      expect(videos[0].loadCalls).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('throws when the element still wedges after its one reload — the frame fails fast', async () => {
    vi.useFakeTimers();
    try {
      const { api, videos } = runWithVideo(); // seekedOnSet stays false: reload does NOT fix it
      expect(await frameOutcome(api, 100)).toBeNull(); // wedge 1
      expect(await frameOutcome(api, 200)).toBeNull(); // wedge 2

      // Wedge 3 → reload + wedged reseek → the frame REJECTS instead of
      // drawing stale pixels (the render then aborts/retries fast instead of
      // burning 2x5s per remaining frame until the job timeout).
      const err = await frameOutcome(api, 300);
      expect(err).toBeInstanceOf(Error);
      expect(String(err)).toContain('still wedged');
      expect(videos[0].loadCalls).toBe(1);

      // The one reload is never repeated: a later wedge throws straight away.
      const err2 = await frameOutcome(api, 400);
      expect(String(err2)).toContain('still wedged');
      expect(videos[0].loadCalls).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a clean seek resets the consecutive-wedge counter', async () => {
    vi.useFakeTimers();
    try {
      const { api, videos } = runWithVideo();
      expect(await frameOutcome(api, 100)).toBeNull(); // wedge 1
      expect(await frameOutcome(api, 200)).toBeNull(); // wedge 2

      videos[0].seekedOnSet = true;
      expect(await frameOutcome(api, 300)).toBeNull(); // clean seek → streak reset

      videos[0].seekedOnSet = false;
      expect(await frameOutcome(api, 400)).toBeNull(); // wedge 1 again...
      expect(await frameOutcome(api, 500)).toBeNull(); // ...wedge 2 — still NO reload
      expect(videos[0].loadCalls).toBe(0);

      videos[0].seekedOnLoad = true;
      expect(await frameOutcome(api, 600)).toBeNull(); // wedge 3 → reload recovers
      expect(videos[0].loadCalls).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('FRAME_RENDERER_SCRIPT — media draw geometry', () => {
  class DrawVideo {
    videoWidth = 800;
    videoHeight = 600;
    currentTime = 0;
    style: Record<string, string> = {};
    crossOrigin = '';
    preload = '';
    muted = false;
    playsInline = false;
    onloadeddata: (() => void) | null = null;
    onerror: (() => void) | null = null;
    listeners: Record<string, Array<() => void>> = {};
    set src(_value: string) {
      queueMicrotask(() => this.onloadeddata?.());
    }
    addEventListener(name: string, fn: () => void) {
      (this.listeners[name] ||= []).push(fn);
    }
    removeEventListener(name: string, fn: () => void) {
      this.listeners[name] = (this.listeners[name] || []).filter((item) => item !== fn);
    }
  }

  const drawArguments = async (clip: Record<string, unknown>): Promise<number[]> => {
    const calls: unknown[][] = [];
    const state: Record<string, unknown> = {
      canvas: { width: 200, height: 400 },
      drawImage: (...args: unknown[]) => calls.push(args),
    };
    const context = new Proxy(state, {
      get: (target, prop) => prop in target ? target[prop as string] : () => undefined,
      set: (target, prop, value) => { target[prop as string] = value; return true; },
    });
    const canvas = { width: 0, height: 0, getContext: () => context };
    const video = new DrawVideo();
    const win: Record<string, unknown> = {
      __DATA: {
        output: {
          id: 'o', width: 200, height: 400, fps: 30, durationMs: 1000,
          background: '#000000',
          tracks: [{
            id: 'tv', type: 'video',
            clips: [{
              id: 'v', type: 'video', mediaType: 'video', src: 'clip.mp4',
              startMs: 0, endMs: 1000, x: 0, y: 0, width: 200, height: 400,
              focalPoint: { x: 0.75, y: 0.25 },
              ...clip,
            }],
          }],
        },
        baseUrl: 'https://example.test',
      },
    };
    const doc = {
      getElementById: () => canvas,
      body: { appendChild: () => {} },
      createElement: (tag: string) => tag === 'video'
        ? video
        : { width: 0, height: 0, getContext: () => context },
    };
    const fn = new Function('window', 'document', 'Image', FRAME_RENDERER_SCRIPT);
    fn(win, doc, class {});
    const api = win.__FRAME_API as { renderFrame: (ms: number) => Promise<void> };
    await api.renderFrame(0);
    const call = calls.find((args) => args[0] === video);
    expect(call).toBeTruthy();
    return call!.slice(1).map(Number);
  };

  const cases = [
    {
      clip: {},
      expected: [375, 0, 300, 600, 0, 0, 200, 400],
    },
    {
      clip: { fitMode: 'cover' },
      expected: [375, 0, 300, 600, 0, 0, 200, 400],
    },
    {
      clip: { fitMode: 'contain' },
      expected: [0, 0, 800, 600, 0, 125, 200, 150],
    },
    {
      clip: { fitMode: 'fill' },
      expected: [0, 0, 800, 600, 0, 0, 200, 400],
    },
    {
      clip: { crop: { x: 40, y: 60, width: 200, height: 100 } },
      expected: [40, 60, 200, 100, 0, 150, 200, 100],
    },
  ];

  it.each([false, true])('matches preview arguments using natural video dimensions (filtered=%s)', async (filtered) => {
    for (const testCase of cases) {
      const clip = filtered ? { ...testCase.clip, filters: ['grayscale'] } : testCase.clip;
      expect(await drawArguments(clip)).toEqual(testCase.expected);
    }
  });
});
