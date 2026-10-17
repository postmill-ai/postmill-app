import { describe, it, expect, vi } from 'vitest';
import { createThrottledProgressWriter } from './render-progress-throttle';

describe('createThrottledProgressWriter', () => {
  it('writes the first frame, then every 10 frames, then the final frame', async () => {
    const write = vi.fn();
    const reporter = createThrottledProgressWriter(write, { now: () => 0 });
    for (let frame = 1; frame <= 25; frame++) reporter.report(frame, 25);
    await reporter.flush();

    expect(write.mock.calls.map((c) => c[0])).toEqual([1, 11, 21, 25]);
    expect(write.mock.calls.every((c) => c[1] === 25)).toBe(true);
  });

  it('writes early when 2s elapse before the frame stride is reached', async () => {
    const write = vi.fn();
    let now = 0;
    const reporter = createThrottledProgressWriter(write, { now: () => now });
    reporter.report(1, 100); // writes (first)
    reporter.report(2, 100); // skipped: <10 frames, <2s
    now = 2000;
    reporter.report(3, 100); // writes: 2s since the last write
    reporter.report(4, 100); // skipped again
    await reporter.flush();

    expect(write.mock.calls.map((c) => c[0])).toEqual([1, 3]);
  });

  it('serializes async writes and swallows failures (progress is best-effort)', async () => {
    const order: number[] = [];
    const write = vi.fn(async (frame: number) => {
      await new Promise((r) => setTimeout(r, frame === 1 ? 5 : 0));
      order.push(frame);
      if (frame === 11) throw new Error('redis blip');
    });
    const reporter = createThrottledProgressWriter(write, { now: () => 0 });
    for (const frame of [1, 11, 21, 30]) reporter.report(frame, 30);
    await expect(reporter.flush()).resolves.toBeUndefined();

    expect(order).toEqual([1, 11, 21, 30]);
  });

  it('honours custom stride/interval', async () => {
    const write = vi.fn();
    const now = 0;
    const reporter = createThrottledProgressWriter(write, {
      frameStride: 2,
      intervalMs: 1000,
      now: () => now,
    });
    for (let frame = 1; frame <= 5; frame++) reporter.report(frame, 100);
    await reporter.flush();
    expect(write.mock.calls.map((c) => c[0])).toEqual([1, 3, 5]);
  });
});
