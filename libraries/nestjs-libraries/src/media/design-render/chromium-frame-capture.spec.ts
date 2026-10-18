import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
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
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
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
    on: vi.fn(),
    off: vi.fn(),
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
  /** Browser event handlers registered by the service, keyed by event name. */
  let browserHandlers: Record<string, Array<(...args: any[]) => void>>;
  /** Per-test hook to instrument a page right after creation. */
  let customizePage: (page: FakePage) => void;

  beforeEach(() => {
    pages.length = 0;
    browserHandlers = {};
    customizePage = () => {};
    launch.mockReset();
    launch.mockImplementation(async () => ({
      newPage: async () => {
        const page = makeFakePage(pages.length);
        customizePage(page);
        pages.push(page);
        return page;
      },
      close: vi.fn(async () => {}),
      on: vi.fn((event: string, handler: (...args: any[]) => void) => {
        (browserHandlers[event] ||= []).push(handler);
      }),
      off: vi.fn((event: string, handler: (...args: any[]) => void) => {
        browserHandlers[event] = (browserHandlers[event] || []).filter((h) => h !== handler);
      }),
    }));
    service = new ChromiumFrameCaptureService();
  });

  afterEach(() => {
    delete process.env.VIDEO_RENDER_CAPTURE_PAGES;
    delete process.env.VIDEO_RENDER_FRAME_TIMEOUT_MS;
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

  it('auto mode picks the conservative default min(2, floor(cpus/2)) for long compositions', async () => {
    delete process.env.VIDEO_RENDER_CAPTURE_PAGES;
    await service.captureFrames(output(12000), 30, '/tmp/frames');
    const expectedPages = Math.min(2, Math.max(1, Math.floor(os.cpus().length / 2)));
    expect(pages).toHaveLength(expectedPages);
    expect(pages.flatMap((p) => p.shots)).toHaveLength(360);
  });

  it('sets pages up SEQUENTIALLY — the next page is not set up while the previous one loads', async () => {
    process.env.VIDEO_RENDER_CAPTURE_PAGES = '2';
    // Gate page 0's setup at the frame-API wait; page 1's setup must not start.
    let releaseSetup!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseSetup = resolve;
    });
    customizePage = (page) => {
      if (page.index === 0) {
        page.waitForFunction.mockImplementationOnce(async () => {
          await gate;
        });
      }
    };

    const capturing = service.captureFrames(output(12000), 30, '/tmp/frames');
    await vi.waitFor(() => expect(pages).toHaveLength(2));
    await vi.waitFor(() => expect(pages[0].setViewport).toHaveBeenCalled());
    // Give a wrongly-parallel implementation a chance to start page 1's setup.
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(pages[1].setViewport).not.toHaveBeenCalled();

    releaseSetup();
    await capturing;
    expect(pages[1].setViewport).toHaveBeenCalled();
    expect(pages.flatMap((p) => p.shots)).toHaveLength(360);
  });

  it('rejects a wedged frame with the per-frame watchdog, not the outer render budget', async () => {
    process.env.VIDEO_RENDER_CAPTURE_PAGES = '2';
    process.env.VIDEO_RENDER_FRAME_TIMEOUT_MS = '50';
    // Page 1's renderFrame evaluate never resolves — a wedged CDP call.
    customizePage = (page) => {
      if (page.index === 1) {
        const original = page.evaluate.getMockImplementation();
        page.evaluate.mockImplementation(async (fn: unknown, arg?: unknown) => {
          if (typeof arg === 'number') return new Promise(() => {});
          return original?.(fn, arg);
        });
      }
    };

    // Page 1's stride starts at global index 1 → frame 2.
    await expect(
      service.captureFrames(output(12000), 30, '/tmp/frames'),
    ).rejects.toThrow(/Frame 2 capture timed out after 50ms/);
  });

  it('rejects in-flight strides when the browser disconnects mid-capture, then cleans up listeners', async () => {
    process.env.VIDEO_RENDER_CAPTURE_PAGES = '2';
    customizePage = (page) => {
      const original = page.evaluate.getMockImplementation();
      page.evaluate.mockImplementation(async (fn: unknown, arg?: unknown) => {
        if (typeof arg === 'number') return new Promise(() => {});
        return original?.(fn, arg);
      });
    };

    const capturing = service.captureFrames(output(12000), 30, '/tmp/frames');
    const assertion = expect(capturing).rejects.toThrow(/disconnected mid-capture/);

    // Both strides must be parked on their first frame before the socket dies.
    await vi.waitFor(() => expect(pages).toHaveLength(2));
    await vi.waitFor(() => expect(browserHandlers['disconnected'] ?? []).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 25));
    browserHandlers['disconnected'][0]();

    await assertion;
    // The disconnect listener is removed once capture settles.
    expect(browserHandlers['disconnected'] ?? []).toHaveLength(0);
  });

  it('rejects in-flight strides when a page crashes mid-capture', async () => {
    process.env.VIDEO_RENDER_CAPTURE_PAGES = '2';
    let crashPage!: (err: Error) => void;
    customizePage = (page) => {
      const original = page.evaluate.getMockImplementation();
      page.evaluate.mockImplementation(async (fn: unknown, arg?: unknown) => {
        if (typeof arg === 'number') return new Promise(() => {});
        return original?.(fn, arg);
      });
      page.on.mockImplementation((event: string, handler: (err: Error) => void) => {
        if (event === 'error') crashPage = handler;
      });
    };

    const capturing = service.captureFrames(output(12000), 30, '/tmp/frames');
    const assertion = expect(capturing).rejects.toThrow(/page crashed mid-capture/);

    await vi.waitFor(() => expect(pages).toHaveLength(2));
    await new Promise((resolve) => setTimeout(resolve, 25));
    crashPage(new Error('boom'));

    await assertion;
  });
});
