import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ThreadsProvider } from './social.adapter';

describe('ThreadsProvider.checkLoaded', () => {
  let provider: ThreadsProvider;

  beforeEach(() => {
    vi.useFakeTimers();
    provider = new ThreadsProvider();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const mockFetchForStatuses = (statuses: string[]) => {
    let index = 0;
    return vi.fn(async () => ({
      json: async () => ({
        status: statuses[index++] || 'PENDING',
        id: 'err-id',
        error_message: 'boom',
      }),
    }));
  };

  it('returns true once the container status becomes FINISHED', async () => {
    (provider as any).fetch = mockFetchForStatuses(['PENDING', 'FINISHED']);

    const promise = (provider as any).checkLoaded('container-1', 'token');
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(promise).resolves.toBe(true);
    expect((provider as any).fetch).toHaveBeenCalledTimes(2);
  });

  it('throws the container id when the API reports ERROR', async () => {
    (provider as any).fetch = mockFetchForStatuses(['ERROR']);

    await expect(
      (provider as any).checkLoaded('container-2', 'token')
    ).rejects.toThrow('err-id');
  });

  it('terminates after a bounded number of attempts when status stays PENDING', async () => {
    const fetchMock = vi.fn(async () => ({
      json: async () => ({ status: 'PENDING', id: 'err-id' }),
    }));
    (provider as any).fetch = fetchMock;

    // Attach the catch handler before advancing timers so the rejection is never
    // observed as unhandled.
    const promise = (provider as any)
      .checkLoaded('container-3', 'token')
      .then(
        () => {
          throw new Error('checkLoaded should have rejected');
        },
        (err: Error) => err
      );

    // 60 attempts × 2200 ms plus a small buffer — enough for every sleep.
    await vi.advanceTimersByTimeAsync(60 * 2200 + 1000);

    const err = await promise;
    expect(err.message).toMatch(
      /Threads media container container-3 did not finish processing after 60 attempts/
    );
    expect(fetchMock).toHaveBeenCalledTimes(60);
  });
});
