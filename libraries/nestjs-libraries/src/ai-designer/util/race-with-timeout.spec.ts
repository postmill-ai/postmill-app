import { describe, expect, it, vi } from 'vitest';
import { raceWithTimeout } from './race-with-timeout';

describe('raceWithTimeout', () => {
  it('resolves when the promise finishes before the timeout', async () => {
    const result = await raceWithTimeout(
      Promise.resolve('ok'),
      1000,
      { label: 'Test' }
    );
    expect(result).toBe('ok');
  });

  it('rejects on timeout with a message that includes the label and duration', async () => {
    const promise = new Promise<string>(() => {
      // never resolves
    });
    await expect(raceWithTimeout(promise, 10, { label: 'LLM revise' })).rejects.toThrow(
      'LLM revise timed out after 10ms'
    );
  });

  it('rejects when the abort signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const promise = Promise.resolve('ok');
    await expect(
      raceWithTimeout(promise, 1000, { signal: controller.signal })
    ).rejects.toThrow('Cancelled');
  });

  it('rejects when the abort signal aborts while the promise is pending', async () => {
    const controller = new AbortController();
    const promise = new Promise<string>(() => {
      // never resolves
    });
    const race = raceWithTimeout(promise, 1000, { signal: controller.signal });
    setTimeout(() => controller.abort(), 10);
    await expect(race).rejects.toThrow('Cancelled');
  });

  it('cleans up the timer and abort listener after resolution', async () => {
    const controller = new AbortController();
    const removeSpy = vi.spyOn(controller.signal, 'removeEventListener');
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

    await raceWithTimeout(Promise.resolve('ok'), 1000, {
      signal: controller.signal,
    });

    expect(removeSpy).toHaveBeenCalled();
    expect(clearTimeoutSpy).toHaveBeenCalled();

    removeSpy.mockRestore();
    clearTimeoutSpy.mockRestore();
  });

  it('cleans up the timer and abort listener after timeout', async () => {
    const controller = new AbortController();
    const removeSpy = vi.spyOn(controller.signal, 'removeEventListener');
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

    const promise = new Promise<string>(() => {
      // never resolves
    });
    await expect(
      raceWithTimeout(promise, 10, { signal: controller.signal })
    ).rejects.toThrow();

    expect(removeSpy).toHaveBeenCalled();
    expect(clearTimeoutSpy).toHaveBeenCalled();

    removeSpy.mockRestore();
    clearTimeoutSpy.mockRestore();
  });

  it('calls onTimeout when the timer wins', async () => {
    const onTimeout = vi.fn();
    const promise = new Promise<string>(() => {
      // never resolves
    });
    await expect(
      raceWithTimeout(promise, 10, { onTimeout })
    ).rejects.toThrow();
    expect(onTimeout).toHaveBeenCalled();
  });
});
