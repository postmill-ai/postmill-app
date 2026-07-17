import { describe, it, expect, vi } from 'vitest';
import { pollMediaJob, PollMediaJobParse } from '../media-helpers';
import { SafeFetchPort } from '../../ports';

// A SafeFetchPort stub that returns a fresh `ok` JSON response carrying `body` on each call,
// recording how many times it was polled.
function fetchReturning(bodies: unknown[]): { fetch: SafeFetchPort; calls: () => number } {
  let i = 0;
  const fetch = vi.fn(async () => {
    const body = bodies[Math.min(i, bodies.length - 1)];
    i++;
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  });
  return { fetch: fetch as unknown as SafeFetchPort, calls: () => i };
}

const parse = (body: unknown): PollMediaJobParse<string> => {
  const b = body as { status: string; url?: string; error?: string };
  if (b.status === 'completed') return { status: 'completed', result: b.url };
  if (b.status === 'failed') return { status: 'failed', error: b.error };
  return { status: 'pending' };
};

describe('pollMediaJob', () => {
  it('resolves immediately when the first poll is already completed', async () => {
    const { fetch, calls } = fetchReturning([{ status: 'completed', url: 'https://cdn/out.mp4' }]);
    const result = await pollMediaJob({ fetch, url: 'https://api/job/1', attempts: 5, intervalMs: 1, parse });
    expect(result).toBe('https://cdn/out.mp4');
    expect(calls()).toBe(1);
  });

  it('resolves after N pending polls', async () => {
    const { fetch, calls } = fetchReturning([
      { status: 'pending' },
      { status: 'pending' },
      { status: 'completed', url: 'https://cdn/done.mp4' },
    ]);
    const result = await pollMediaJob({ fetch, url: 'https://api/job/2', attempts: 5, intervalMs: 1, parse });
    expect(result).toBe('https://cdn/done.mp4');
    expect(calls()).toBe(3);
  });

  it('throws on a terminal failure status', async () => {
    const { fetch } = fetchReturning([{ status: 'failed', error: 'render exploded' }]);
    await expect(
      pollMediaJob({ fetch, url: 'https://api/job/3', attempts: 5, intervalMs: 1, parse }),
    ).rejects.toThrow('render exploded');
  });

  it('throws a timeout when never completing within the attempt budget', async () => {
    const { fetch, calls } = fetchReturning([{ status: 'pending' }]);
    await expect(
      pollMediaJob({ fetch, url: 'https://api/job/4', attempts: 3, intervalMs: 1, parse }),
    ).rejects.toThrow('did not complete after 3 attempts');
    expect(calls()).toBe(3);
  });

  it('throws when the upstream poll returns a non-ok response', async () => {
    const fetch = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
      text: async () => 'boom',
    } as unknown as Response)) as unknown as SafeFetchPort;
    await expect(
      pollMediaJob({ fetch, url: 'https://api/job/5', attempts: 3, intervalMs: 1, parse }),
    ).rejects.toThrow('Media job poll failed (500): boom');
  });
});
