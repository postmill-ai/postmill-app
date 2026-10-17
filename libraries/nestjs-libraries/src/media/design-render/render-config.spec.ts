import { describe, it, expect, afterEach } from 'vitest';
import { getCapturePageCount, getPodmanRenderConfig, getRenderTimeoutMs, MAX_CAPTURE_PAGES, PARALLEL_CAPTURE_MIN_FRAMES } from './render-config';

describe('render-config (2.3 network isolation)', () => {
  afterEach(() => {
    delete process.env.VIDEO_RENDER_NETWORK;
    delete process.env.VIDEO_RENDER_TIMEOUT_MS;
    delete process.env.VIDEO_RENDER_CAPTURE_PAGES;
  });

  it('defaults the Podman render network to an isolated bridge, never host', () => {
    delete process.env.VIDEO_RENDER_NETWORK;
    const cfg = getPodmanRenderConfig();
    expect(cfg.network).toBe('bridge');
    expect(cfg.network).not.toBe('host');
  });

  it('still honours an explicit VIDEO_RENDER_NETWORK override (incl. opt-in host)', () => {
    process.env.VIDEO_RENDER_NETWORK = 'host';
    expect(getPodmanRenderConfig().network).toBe('host');

    process.env.VIDEO_RENDER_NETWORK = 'none';
    expect(getPodmanRenderConfig().network).toBe('none');
  });

  it('exposes a wall-clock render timeout (default 120s, env-tunable)', () => {
    delete process.env.VIDEO_RENDER_TIMEOUT_MS;
    expect(getRenderTimeoutMs()).toBe(120000);
    process.env.VIDEO_RENDER_TIMEOUT_MS = '5000';
    expect(getRenderTimeoutMs()).toBe(5000);
  });

  describe('getCapturePageCount (parallel frame capture)', () => {
    const MANY_FRAMES = PARALLEL_CAPTURE_MIN_FRAMES + 100;

    it('stays sequential at or below the frame threshold, regardless of env', () => {
      expect(getCapturePageCount(PARALLEL_CAPTURE_MIN_FRAMES)).toBe(1);
      expect(getCapturePageCount(10)).toBe(1);
      process.env.VIDEO_RENDER_CAPTURE_PAGES = '4';
      expect(getCapturePageCount(PARALLEL_CAPTURE_MIN_FRAMES)).toBe(1);
    });

    it('defaults to min(3, available parallelism) above the threshold', () => {
      delete process.env.VIDEO_RENDER_CAPTURE_PAGES;
      const pages = getCapturePageCount(MANY_FRAMES);
      expect(pages).toBeGreaterThanOrEqual(1);
      expect(pages).toBeLessThanOrEqual(3);
    });

    it('honours VIDEO_RENDER_CAPTURE_PAGES, with 1 forcing sequential', () => {
      process.env.VIDEO_RENDER_CAPTURE_PAGES = '1';
      expect(getCapturePageCount(MANY_FRAMES)).toBe(1);
      process.env.VIDEO_RENDER_CAPTURE_PAGES = '2';
      expect(getCapturePageCount(MANY_FRAMES)).toBe(2);
    });

    it('caps the env override at MAX_CAPTURE_PAGES and ignores junk values', () => {
      process.env.VIDEO_RENDER_CAPTURE_PAGES = '100';
      expect(getCapturePageCount(MANY_FRAMES)).toBe(MAX_CAPTURE_PAGES);
      process.env.VIDEO_RENDER_CAPTURE_PAGES = 'banana';
      expect(getCapturePageCount(MANY_FRAMES)).toBeLessThanOrEqual(3);
      process.env.VIDEO_RENDER_CAPTURE_PAGES = '-2';
      expect(getCapturePageCount(MANY_FRAMES)).toBeLessThanOrEqual(3);
    });
  });
});
