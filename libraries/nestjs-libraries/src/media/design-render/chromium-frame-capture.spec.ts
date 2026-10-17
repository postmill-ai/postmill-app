import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import { ChromiumFrameCaptureService, FrameCaptureProgress } from './chromium-frame-capture.service';

// Puppeteer is mocked: the fake browser hands out instrumented pages that record
// which frames each one rendered and which PNG paths each one screenshotted.

interface FakePage {
  index: number;
  renderedTimes: number[];
  shots: string[];
  setViewport: ReturnType<typeof vi.fn>;
  setContent: ReturnType<typeof vi.fn>;
  waitForNetworkIdle: ReturnType<typeof vi.fn>;
  waitForFunction: ReturnType<typeof vi.fn>;
  evaluate: ReturnType<typeof vi.fn>;
  $: ReturnType<typeof vi.fn>;
  goto: ReturnType<typeof vi.fn>;
}

const pages: FakePage[] = [];
const launch = vi.fn();

vi.mock('puppeteer', () => ({
  default: { launch: (...args: unknown[]) => launch(...args) },
}));

function makeFakePage(index: number): FakePage {
  const page: FakePage = {
    index,
    renderedTimes: [],
    shots: [],
    setViewport: vi.fn(async () => {}),
    setContent: vi.fn(async () => {}),
    waitForNetworkIdle: vi.fn(async () => {}),
    waitForFunction: vi.fn(async () => {}),
    goto: vi.fn(async () => {}),
    evaluate: vi.fn(async (_fn: unknown, arg?: unknown) => {
      if (typeof arg === 'number') page.renderedTimes.push(arg);
    }),
    $: vi.fn(async () => ({
      screenshot: async (opts: { path: string }) => {
        page.shots.push(opts.path);
      },
    })),
  };
  return page;
}

const output = (durationMs: number): any => ({
  id: 'vo-1',
  width: 100,
  height: 100,
  fps: 30,
  durationMs,
  tracks: [],
});

describe('ChromiumFrameCaptureService parallel capture', () => {
  let service: ChromiumFrameCaptureService;

  beforeEach(() => {
    pages.length = 0;
    launch.mockReset();
    launch.mockImplementation(async () => ({
      newPage: async () => {
        const page = makeFakePage(pages.length);
        pages.push(page);
        return page;
      },
      close: vi.fn(async () => {}),
    }));
    service = new ChromiumFrameCaptureService();
  });

  afterEach(() => {
    delete process.env.VIDEO_RENDER_CAPTURE_PAGES;
  });

  it('captures sequentially on one page for short compositions', async () => {
    // 5s @ 30fps = 150 frames — below the parallel threshold.
    const progress: FrameCaptureProgress[] = [];
    const frames = await service.captureFrames(
      output(5000),
      30,
      '/tmp/frames',
      (p) => progress.push(p),
    );

    expect(frames).toBe(150);
    expect(pages).toHaveLength(1);
    expect(pages[0].shots).toHaveLength(150);
    expect(pages[0].shots[0]).toBe(path.join('/tmp/frames', 'frame-00001.png'));
    expect(pages[0].shots[149]).toBe(path.join('/tmp/frames', 'frame-00150.png'));
    // Sequential progress: strictly increasing, ends at total.
    expect(progress.map((p) => p.frame)).toEqual(
      Array.from({ length: 150 }, (_, i) => i + 1),
    );
    expect(progress[149].total).toBe(150);
  });

  it('forces sequential capture with VIDEO_RENDER_CAPTURE_PAGES=1', async () => {
    process.env.VIDEO_RENDER_CAPTURE_PAGES = '1';
    // 12s @ 30fps = 360 frames — above the threshold, but pinned to one page.
    await service.captureFrames(output(12000), 30, '/tmp/frames');

    expect(pages).toHaveLength(1);
    expect(pages[0].shots).toHaveLength(360);
  });

  it('spreads frames across N pages with disjoint global indices and global naming', async () => {
    process.env.VIDEO_RENDER_CAPTURE_PAGES = '3';
    // 12s @ 30fps = 360 frames > threshold → 3 pages.
    const progress: FrameCaptureProgress[] = [];
    const frames = await service.captureFrames(
      output(12000),
      30,
      '/tmp/frames',
      (p) => progress.push(p),
    );

    expect(frames).toBe(360);
    expect(pages).toHaveLength(3);

    // Each page set up independently (viewport + content load + frame API await).
    for (const page of pages) {
      expect(page.setViewport).toHaveBeenCalledWith({ width: 100, height: 100, deviceScaleFactor: 1 });
      expect(page.setContent).toHaveBeenCalled();
      expect(page.waitForFunction).toHaveBeenCalled();
    }

    // Stride assignment: page i owns global frame indices where index % 3 === i,
    // written under their global (1-based, zero-padded) names.
    for (const [i, page] of pages.entries()) {
      const expectedIndices: number[] = [];
      for (let f = i; f < 360; f += 3) expectedIndices.push(f);
      expect(page.shots).toEqual(
        expectedIndices.map((f) =>
          path.join('/tmp/frames', `frame-${String(f + 1).padStart(5, '0')}.png`),
        ),
      );
      // renderFrame was evaluated with the matching timeline times.
      expect(page.renderedTimes).toEqual(expectedIndices.map((f) => (f * 1000) / 30));
    }

    // Union covers every frame exactly once.
    const all = pages.flatMap((p) => p.shots).sort();
    const expected = Array.from({ length: 360 }, (_, f) =>
      path.join('/tmp/frames', `frame-${String(f + 1).padStart(5, '0')}.png`),
    ).sort();
    expect(all).toEqual(expected);

    // Progress is a GLOBAL completed count: monotonic, ends at total.
    expect(progress).toHaveLength(360);
    expect(progress.map((p) => p.frame)).toEqual(
      Array.from({ length: 360 }, (_, i) => i + 1),
    );
    expect(progress.every((p) => p.total === 360)).toBe(true);
  });

  it('auto mode caps pages at min(3, parallelism) for long compositions', async () => {
    delete process.env.VIDEO_RENDER_CAPTURE_PAGES;
    await service.captureFrames(output(12000), 30, '/tmp/frames');
    expect(pages.length).toBeGreaterThanOrEqual(1);
    expect(pages.length).toBeLessThanOrEqual(3);
    expect(pages.flatMap((p) => p.shots)).toHaveLength(360);
  });
});
