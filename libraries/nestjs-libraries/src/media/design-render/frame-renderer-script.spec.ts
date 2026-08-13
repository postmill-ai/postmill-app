import { describe, it, expect } from 'vitest';
import { escapeForScriptTag, FRAME_RENDERER_SCRIPT } from './frame-renderer-script';
import { interpolateClipKeyframes } from '../designer-doc/keyframes';

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

  const run = (output: unknown) => {
    const canvas = { width: 0, height: 0, getContext: () => stubContext() };
    const win: Record<string, unknown> = {
      __DATA: { output, baseUrl: 'https://example.test' },
    };
    const doc = { getElementById: () => canvas };
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

  it('renders a frame without throwing', async () => {
    const api = run(output);
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
});
