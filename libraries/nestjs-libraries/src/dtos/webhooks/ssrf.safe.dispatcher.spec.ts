import { describe, it, expect, vi, beforeEach } from 'vitest';
import dns from 'node:dns';

// Capture the Agent constructor options so the connect hardening is asserted
// without opening a socket. The exported dispatcher is the object this mock returns.
vi.mock('undici', () => ({
  Agent: vi.fn(function (this: unknown, opts: unknown) {
    return { opts };
  }),
}));
vi.mock('node:dns', () => ({ default: { lookup: vi.fn() } }));

import {
  getSsrfSafeDispatcher,
  ssrfSafeDispatcher,
} from './ssrf.safe.dispatcher';

const connect = (ssrfSafeDispatcher as any).opts.connect;

describe('ssrfSafeDispatcher', () => {
  beforeEach(() => {
    vi.mocked(dns.lookup).mockReset();
  });

  it('restores the 10s connect timeout and keeps happy-eyeballs enabled', () => {
    expect(connect.timeout).toBe(10_000);
    expect(connect.autoSelectFamily).toBe(true);
  });

  it.each([4, 6] as const)('caches the IPv%s dispatcher and passes its family to DNS', (family) => {
    const dispatcher = getSsrfSafeDispatcher(family);
    expect(getSsrfSafeDispatcher(family)).toBe(dispatcher);

    vi.mocked(dns.lookup).mockImplementation(((
      _hostname: string,
      _options: unknown,
      callback: (err: null, addresses: Array<{ address: string; family: number }>) => void,
    ) => callback(null, [{ address: family === 4 ? '93.184.215.14' : '2606:2800:220:1:248:1893:25c8:1946', family }])) as any);
    const familyConnect = (dispatcher as any).opts.connect;
    familyConnect.lookup('example.com', { all: true }, () => {});

    expect(dns.lookup).toHaveBeenCalledWith(
      'example.com',
      expect.objectContaining({ all: true, family }),
      expect.any(Function),
    );
  });

  it('reuses the default cached dispatcher', () => {
    expect(getSsrfSafeDispatcher()).toBe(ssrfSafeDispatcher);
  });

  it('keeps the DNS-pinning lookup: blocked literal IPs are rejected', () => {
    let err: Error | null = null;
    connect.lookup('127.0.0.1', {}, (e: Error) => {
      err = e;
    });
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/Blocked IP/);
  });

  it('rejects a blocked address returned by family-filtered DNS', () => {
    vi.mocked(dns.lookup).mockImplementation(((
      _hostname: string,
      _options: unknown,
      callback: (err: null, addresses: Array<{ address: string; family: number }>) => void,
    ) => callback(null, [{ address: '127.0.0.1', family: 4 }])) as any);
    const ipv4Connect = (getSsrfSafeDispatcher(4) as any).opts.connect;
    let err: Error | null = null;

    ipv4Connect.lookup('example.com', { all: true }, (e: Error) => {
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
