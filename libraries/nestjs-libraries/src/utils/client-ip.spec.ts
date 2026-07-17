import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveClientIp } from './client-ip';

// F9: shared client-IP resolution for every rate limiter behind a reverse
// proxy (HTTP throttler, WS gateway connect budget, MCP rate limits).
// TRUST_PROXY_HOPS must equal the EXACT number of XFF-appending proxies.

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('resolveClientIp — TRUST_PROXY_HOPS unset/invalid', () => {
  it('falls back to the socket peer when TRUST_PROXY_HOPS is unset', () => {
    vi.stubEnv('TRUST_PROXY_HOPS', undefined);
    // A spoofed XFF must not mint a fresh rate-limit bucket.
    expect(resolveClientIp('1.2.3.4', '10.0.0.9')).toBe('10.0.0.9');
    expect(resolveClientIp(undefined, '10.0.0.9')).toBe('10.0.0.9');
  });

  it('treats an empty value as disabled', () => {
    vi.stubEnv('TRUST_PROXY_HOPS', '');
    expect(resolveClientIp('1.2.3.4', '10.0.0.9')).toBe('10.0.0.9');
  });

  it.each(['abc', '0', '-1', '1.5', '2e1x'])(
    'treats invalid value %s as disabled',
    (value) => {
      vi.stubEnv('TRUST_PROXY_HOPS', value);
      expect(resolveClientIp('1.2.3.4', '10.0.0.9')).toBe('10.0.0.9');
    }
  );
});

describe('resolveClientIp — Nth-from-right resolution', () => {
  it('hops=1 resolves the rightmost XFF entry (single proxy)', () => {
    vi.stubEnv('TRUST_PROXY_HOPS', '1');
    expect(resolveClientIp('192.168.1.10', '10.0.0.9')).toBe('192.168.1.10');
  });

  it('hops=2 resolves the second-from-right entry (two proxies)', () => {
    vi.stubEnv('TRUST_PROXY_HOPS', '2');
    // client, proxy-1, proxy-2(socket peer): the client IP is 2nd from right.
    expect(
      resolveClientIp('192.168.1.10, 172.16.0.1', '10.0.0.9')
    ).toBe('192.168.1.10');
  });

  it('trims whitespace and ignores empty entries', () => {
    vi.stubEnv('TRUST_PROXY_HOPS', '1');
    expect(resolveClientIp('  192.168.1.10 , , 172.16.0.1 ', '10.0.0.9')).toBe(
      '172.16.0.1'
    );
  });

  it('accepts the array header form (first value wins)', () => {
    vi.stubEnv('TRUST_PROXY_HOPS', '1');
    expect(
      resolveClientIp(['192.168.1.10', '10.9.9.9'], '10.0.0.9')
    ).toBe('192.168.1.10');
  });

  it('falls back when the header is not a string', () => {
    vi.stubEnv('TRUST_PROXY_HOPS', '1');
    expect(resolveClientIp(undefined, '10.0.0.9')).toBe('10.0.0.9');
  });
});

describe('resolveClientIp — spoofing resistance (D3)', () => {
  it('padded left-most attacker entries do not change the resolved IP when hops matches the real chain', () => {
    vi.stubEnv('TRUST_PROXY_HOPS', '1');
    // Real chain: client 192.168.1.10 behind one proxy. Attacker-controlled
    // left-most padding is appended by the client but never consulted.
    const plain = resolveClientIp('192.168.1.10', '10.0.0.9');
    const padded = resolveClientIp(
      'evil-1, evil-2, evil-3, 192.168.1.10',
      '10.0.0.9'
    );
    expect(padded).toBe('192.168.1.10');
    expect(padded).toBe(plain);
  });

  it('exactness caveat: OVERESTIMATED hops fall back to the socket peer (parts.length < hops)', () => {
    // Operator set TRUST_PROXY_HOPS=2 but only one proxy appends XFF: the
    // chain is shorter than the configured count, so resolution fails closed
    // to req.ip rather than landing in attacker-supplied left-most padding.
    vi.stubEnv('TRUST_PROXY_HOPS', '2');
    expect(resolveClientIp('192.168.1.10', '10.0.0.9')).toBe('10.0.0.9');
  });

  it('exactness caveat: UNDERESTIMATED hops resolve an intermediate proxy IP', () => {
    // Operator set 1 but two proxies append XFF: the resolved entry is the
    // intermediate proxy, re-grouping its clients into one bucket (partial
    // lockout persists) — documenting why the count must be exact.
    vi.stubEnv('TRUST_PROXY_HOPS', '1');
    expect(
      resolveClientIp('192.168.1.10, 172.16.0.1', '10.0.0.9')
    ).toBe('172.16.0.1');
  });
});
