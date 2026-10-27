import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  acquireVideoElement,
  releaseVideoElement,
  releaseVideoElements,
  resetVideoElementRegistry,
  sharedVideoElement,
} from './video-element-registry';
import type { VideoClip } from './designer.store';

const clip = (src = 'https://example.com/a.mp4'): VideoClip =>
  ({ id: 'clip-1', startMs: 0, endMs: 4000, src }) as VideoClip;

beforeAll(() => {
  for (const method of ['pause', 'load']) {
    Object.defineProperty(HTMLMediaElement.prototype, method, {
      value: vi.fn(),
      configurable: true,
    });
  }
});

describe('video element registry', () => {
  afterEach(() => {
    resetVideoElementRegistry();
    vi.restoreAllMocks();
  });

  it('shares one element between canvas and playback consumers', () => {
    const canvas = {};
    const playback = {};
    const first = acquireVideoElement(canvas, clip(), {});
    const second = acquireVideoElement(playback, clip(), {});

    expect(second).toBe(first);
    expect(document.querySelectorAll('video')).toHaveLength(1);

    releaseVideoElement(playback, 'clip-1');
    expect(sharedVideoElement('clip-1')).toBe(first);
    expect(first?.isConnected).toBe(true);

    releaseVideoElement(canvas, 'clip-1');
    expect(sharedVideoElement('clip-1')).toBeUndefined();
    expect(first?.isConnected).toBe(false);
  });

  it('follows an in-place source replacement for both consumers', () => {
    const canvas = {};
    const playback = {};
    const first = acquireVideoElement(canvas, clip(), {})!;
    vi.spyOn(first, 'load').mockClear().mockImplementation(() => {});
    acquireVideoElement(playback, clip(), {});
    const replacement = acquireVideoElement(playback, clip('https://example.com/b.mp4'), {})!;

    expect(replacement).toBe(first);
    expect(replacement.getAttribute('src')).toBe('https://example.com/b.mp4');
    expect(first.load).toHaveBeenCalledTimes(1);
    expect(acquireVideoElement(canvas, clip('https://example.com/b.mp4'), {})).toBe(first);
    expect(first.load).toHaveBeenCalledTimes(1);
    releaseVideoElements(canvas);
    releaseVideoElements(playback);
  });

  it('does not let a stale playback consumer undo the canvas source', () => {
    const canvas = {};
    const playback = {};
    acquireVideoElement(canvas, clip(), { sourceAuthority: true });
    acquireVideoElement(playback, clip(), {});
    acquireVideoElement(canvas, clip('https://example.com/b.mp4'), { sourceAuthority: true });
    acquireVideoElement(playback, clip(), {});

    expect(sharedVideoElement('clip-1')?.getAttribute('src')).toBe('https://example.com/b.mp4');

    releaseVideoElements(canvas);
    acquireVideoElement(playback, clip(), {});
    expect(sharedVideoElement('clip-1')?.getAttribute('src')).toBe('https://example.com/a.mp4');
    releaseVideoElements(playback);
  });

  it('notifies both consumers when a replacement fails and recovers', () => {
    const canvas = {};
    const playback = {};
    const canvasError = vi.fn();
    const playbackError = vi.fn();
    const recovered = vi.fn();
    const element = acquireVideoElement(canvas, clip(), { onError: canvasError })!;
    acquireVideoElement(playback, clip(), { onError: playbackError, onCanPlay: recovered });

    element.dispatchEvent(new Event('error'));
    element.dispatchEvent(new Event('canplay'));

    expect(canvasError).toHaveBeenCalledOnce();
    expect(playbackError).toHaveBeenCalledOnce();
    expect(recovered).toHaveBeenCalledOnce();
    releaseVideoElements(canvas);
    releaseVideoElements(playback);
  });

  it('announces decoded frames through requestVideoFrameCallback', () => {
    let decoded: (() => void) | undefined;
    Object.defineProperty(HTMLMediaElement.prototype, 'requestVideoFrameCallback', {
      configurable: true,
      value: vi.fn((callback: () => void) => {
        decoded = callback;
        return 1;
      }),
    });
    const onFrame = vi.fn();
    acquireVideoElement({}, clip(), { onFrame });

    expect(decoded).toBeTypeOf('function');
    decoded!();
    expect(onFrame).toHaveBeenCalledOnce();
  });
});
