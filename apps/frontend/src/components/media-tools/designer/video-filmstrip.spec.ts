import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as any).AudioContext = class {};
});

import { captureFilmstrip } from './video-timeline';

class FakeVideo {
  preload = '';
  duration = 1;
  videoWidth = 640;
  videoHeight = 360;
  muted = false;
  playsInline = false;
  crossOrigin = '';
  onloadedmetadata?: () => void;
  onseeked?: () => void;
  onerror?: () => void;
  load = vi.fn(() => this.onFinish());
  removeAttribute = vi.fn();
  private source = '';

  constructor(private readonly onFinish: () => void) {}

  set src(value: string) {
    this.source = value;
    queueMicrotask(() => this.onloadedmetadata?.());
  }
  get src() { return this.source; }
  set currentTime(_value: number) {
    queueMicrotask(() => this.onseeked?.());
  }
}

describe('captureFilmstrip', () => {
  afterEach(() => vi.restoreAllMocks());

  it('uses metadata preload and captures one source at a time', async () => {
    const original = document.createElement;
    const created: FakeVideo[] = [];
    let active = 0;
    let maxActive = 0;
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag !== 'video') return original.call(document, tag);
      const video = new FakeVideo(() => { active -= 1; });
      active += 1;
      maxActive = Math.max(maxActive, active);
      created.push(video);
      return video as any;
    });

    await Promise.all([
      captureFilmstrip('https://example.com/a.mp4'),
      captureFilmstrip('https://example.com/b.mp4'),
    ]);

    expect(created.map((video) => video.preload)).toEqual(['metadata', 'metadata']);
    expect(created.map((video) => video.src)).toEqual([
      'https://example.com/a.mp4',
      'https://example.com/b.mp4',
    ]);
    expect(maxActive).toBe(1);
    expect(active).toBe(0);
  });
});
