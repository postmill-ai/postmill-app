import { describe, it, expect, vi } from 'vitest';

// Capture the Agent constructor options so the connect hardening is asserted
// without opening a socket. The exported dispatcher is the object this mock returns.
vi.mock('undici', () => ({
  Agent: vi.fn(function (this: unknown, opts: unknown) {
    return { opts };
  }),
}));

import { ssrfSafeDispatcher } from './ssrf.safe.dispatcher';

const connect = (ssrfSafeDispatcher as any).opts.connect;

describe('ssrfSafeDispatcher', () => {
  it('raises the connect timeout and enables happy-eyeballs IPv4 fallback', () => {
    expect(connect.timeout).toBe(30_000);
    expect(connect.autoSelectFamily).toBe(true);
  });

  it('keeps the DNS-pinning lookup: blocked literal IPs are rejected', () => {
    let err: Error | null = null;
    connect.lookup('127.0.0.1', {}, (e: Error) => {
      err = e;
    });
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/Blocked IP/);
  });

  it('pins public literal IPs straight through', () => {
    const args: unknown[] = [];
    connect.lookup('93.184.215.14', {}, (...a: unknown[]) => args.push(...a));
    expect(args[0]).toBeNull();
    expect(args[1]).toBe('93.184.215.14');
    expect(args[2]).toBe(4);
  });
});
