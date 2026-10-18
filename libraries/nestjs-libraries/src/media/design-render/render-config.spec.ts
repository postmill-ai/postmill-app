import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { cpus } from 'os';
import type { CpuInfo } from 'os';
import { getCapturePageCount, getFrameTimeoutMs, getPodmanRenderConfig, getRenderTimeoutMs, MAX_CAPTURE_PAGES, PARALLEL_CAPTURE_MIN_FRAMES } from './render-config';

// os.cpus is mocked so the default page count is deterministic across machines.
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, cpus: vi.fn(actual.cpus) };
});

const fakeCpus = (n: number) => Array.from({ length: n }, () => ({})) as CpuInfo[];

describe('render-config (2.3 network isolation)', () => {
  const mockCpus = vi.mocked(cpus);

  beforeEach(() => {
    mockCpus.mockReturnValue(fakeCpus(8));
  });

  afterEach(() => {
    delete process.env.VIDEO_RENDER_NETWORK;
    delete process.env.VIDEO_RENDER_TIMEOUT_MS;
    delete process.env.VIDEO_RENDER_CAPTURE_PAGES;
    delete process.env.VIDEO_RENDER_FRAME_TIMEOUT_MS;
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

    it('threshold is 150 frames (5s @ 30fps), so a typical 10s social video captures in parallel', () => {
      expect(PARALLEL_CAPTURE_MIN_FRAMES).toBe(150);
      delete process.env.VIDEO_RENDER_CAPTURE_PAGES;
      expect(getCapturePageCount(150)).toBe(1);
      expect(getCapturePageCount(300)).toBe(2);
    });

    it('stays sequential at or below the frame threshold, regardless of env', () => {
      expect(getCapturePageCount(PARALLEL_CAPTURE_MIN_FRAMES)).toBe(1);
      expect(getCapturePageCount(10)).toBe(1);
      process.env.VIDEO_RENDER_CAPTURE_PAGES = '4';
      expect(getCapturePageCount(PARALLEL_CAPTURE_MIN_FRAMES)).toBe(1);
    });

    it('defaults to min(2, cpus/2) above the threshold (parallel re-enabled after the stall hardening)', () => {
      delete process.env.VIDEO_RENDER_CAPTURE_PAGES;
      mockCpus.mockReturnValue(fakeCpus(8));
      expect(getCapturePageCount(MANY_FRAMES)).toBe(2);
      mockCpus.mockReturnValue(fakeCpus(4));
      expect(getCapturePageCount(MANY_FRAMES)).toBe(2);
    });

    it('never defaults above 2 pages, and clamps to 1 on small hosts', () => {
      delete process.env.VIDEO_RENDER_CAPTURE_PAGES;
      mockCpus.mockReturnValue(fakeCpus(64));
      expect(getCapturePageCount(MANY_FRAMES)).toBe(2);
      mockCpus.mockReturnValue(fakeCpus(2));
      expect(getCapturePageCount(MANY_FRAMES)).toBe(1);
      mockCpus.mockReturnValue(fakeCpus(1));
      expect(getCapturePageCount(MANY_FRAMES)).toBe(1);
    });

    it('honours VIDEO_RENDER_CAPTURE_PAGES, with 1 forcing sequential', () => {
      process.env.VIDEO_RENDER_CAPTURE_PAGES = '1';
      expect(getCapturePageCount(MANY_FRAMES)).toBe(1);
      process.env.VIDEO_RENDER_CAPTURE_PAGES = '2';
      expect(getCapturePageCount(MANY_FRAMES)).toBe(2);
      process.env.VIDEO_RENDER_CAPTURE_PAGES = '4';
      expect(getCapturePageCount(MANY_FRAMES)).toBe(4);
    });

    it('caps the env override at MAX_CAPTURE_PAGES and falls back to the default for junk values', () => {
      process.env.VIDEO_RENDER_CAPTURE_PAGES = '100';
      expect(getCapturePageCount(MANY_FRAMES)).toBe(MAX_CAPTURE_PAGES);
      process.env.VIDEO_RENDER_CAPTURE_PAGES = 'banana';
      expect(getCapturePageCount(MANY_FRAMES)).toBe(2);
      process.env.VIDEO_RENDER_CAPTURE_PAGES = '-2';
      expect(getCapturePageCount(MANY_FRAMES)).toBe(2);
    });
  });

  describe('getFrameTimeoutMs (per-frame capture watchdog)', () => {
    it('defaults to 30s and honours VIDEO_RENDER_FRAME_TIMEOUT_MS', () => {
      delete process.env.VIDEO_RENDER_FRAME_TIMEOUT_MS;
      expect(getFrameTimeoutMs()).toBe(30000);
      process.env.VIDEO_RENDER_FRAME_TIMEOUT_MS = '5000';
      expect(getFrameTimeoutMs()).toBe(5000);
      process.env.VIDEO_RENDER_FRAME_TIMEOUT_MS = 'banana';
      expect(getFrameTimeoutMs()).toBe(30000);
    });
  });
});
