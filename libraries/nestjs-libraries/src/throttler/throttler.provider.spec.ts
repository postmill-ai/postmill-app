import { describe, it, expect, vi, afterEach } from 'vitest';
import { ThrottlerBehindProxyGuard } from './throttler.provider';

// F9: the HTTP throttler must key pre-auth routes on the REAL client IP
// resolved from XFF via TRUST_PROXY_HOPS (Nth-from-right) — identical to the
// WS gateway and the MCP rate limits. Bare req.ip behind a proxy is the
// proxy's socket address: one platform-wide bucket for every client.

const makeGuard = () =>
  // getTracker touches none of the ThrottlerGuard constructor deps.
  new ThrottlerBehindProxyGuard(
    undefined as any,
    undefined as any,
    undefined as any
  ) as any;

const req = (overrides: Record<string, any> = {}) => ({
  url: '/api/auth/login',
  ip: '10.0.0.9',
  headers: {},
  ...overrides,
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('ThrottlerBehindProxyGuard.getTracker', () => {
  it('prefers the org id when present (authed routes)', async () => {
    vi.stubEnv('TRUST_PROXY_HOPS', '1');
    const guard = makeGuard();
    const tracker = await guard.getTracker(
      req({
        org: { id: 'org-1' },
        headers: { 'x-forwarded-for': '192.168.1.10' },
      })
    );
    expect(tracker).toBe('org-1_other');
  });

  it('falls back to req.ip when TRUST_PROXY_HOPS is unset (XFF never trusted blindly)', async () => {
    vi.stubEnv('TRUST_PROXY_HOPS', '');
    const guard = makeGuard();
    // Spoofed XFF must not mint a distinct tracker.
    const a = await guard.getTracker(
      req({ headers: { 'x-forwarded-for': 'spoof-1' } })
    );
    const b = await guard.getTracker(
      req({ headers: { 'x-forwarded-for': 'spoof-2' } })
    );
    expect(a).toBe('10.0.0.9_other');
    expect(b).toBe('10.0.0.9_other');
  });

  it('hops=1: distinct rightmost-XFF clients get distinct trackers', async () => {
    vi.stubEnv('TRUST_PROXY_HOPS', '1');
    const guard = makeGuard();
    const a = await guard.getTracker(
      req({ headers: { 'x-forwarded-for': '192.168.1.10' } })
    );
    const b = await guard.getTracker(
      req({ headers: { 'x-forwarded-for': '192.168.1.11' } })
    );
    expect(a).toBe('192.168.1.10_other');
    expect(b).toBe('192.168.1.11_other');
    expect(a).not.toBe(b);
  });

  it('hops=1: padded left-most attacker entries do not change the tracker', async () => {
    vi.stubEnv('TRUST_PROXY_HOPS', '1');
    const guard = makeGuard();
    const plain = await guard.getTracker(
      req({ headers: { 'x-forwarded-for': '192.168.1.10' } })
    );
    const padded = await guard.getTracker(
      req({
        headers: { 'x-forwarded-for': 'evil-1, evil-2, 192.168.1.10' },
      })
    );
    expect(padded).toBe(plain);
  });

  it('exactness caveat: overestimated hops fall back to req.ip (short chain)', async () => {
    // TRUST_PROXY_HOPS=2 but only one proxy appends XFF → parts.length < hops
    // → fail closed to the socket peer rather than attacker-supplied padding.
    vi.stubEnv('TRUST_PROXY_HOPS', '2');
    const guard = makeGuard();
    const tracker = await guard.getTracker(
      req({ headers: { 'x-forwarded-for': '192.168.1.10' } })
    );
    expect(tracker).toBe('10.0.0.9_other');
  });

  it('preserves the per-route suffix (_posts / _other)', async () => {
    vi.stubEnv('TRUST_PROXY_HOPS', '1');
    const guard = makeGuard();
    const posts = await guard.getTracker(
      req({
        url: '/api/posts',
        headers: { 'x-forwarded-for': '192.168.1.10' },
      })
    );
    const other = await guard.getTracker(
      req({
        url: '/api/auth/login',
        headers: { 'x-forwarded-for': '192.168.1.10' },
      })
    );
    expect(posts).toBe('192.168.1.10_posts');
    expect(other).toBe('192.168.1.10_other');
  });

  it("falls back to 'anon' when there is no org and no req.ip", async () => {
    vi.stubEnv('TRUST_PROXY_HOPS', '');
    const guard = makeGuard();
    const tracker = await guard.getTracker(req({ ip: undefined }));
    expect(tracker).toBe('anon_other');
  });
});
