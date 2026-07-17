import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { AiDesignerGateway } from './ai-designer.gateway';

// Unit-tests the gateway helpers plus the security-critical connect/authz/join paths.
// Socket-specific methods are accessed via `(gateway as any)`.

const fakeUser = (id: string, overrides: Partial<{ isSuperAdmin: boolean; activated: boolean }> = {}) =>
  ({
    id,
    email: `${id}@test.com`,
    activated: true,
    isSuperAdmin: false,
    ...overrides,
  } as any);

const fakeOrg = (id: string, overrides: Partial<{ createdAt: Date }> = {}) =>
  ({
    id,
    name: `org-${id}`,
    createdAt: overrides.createdAt ?? new Date(),
    users: [{ disabled: false, roleRef: { key: 'member' } }],
  } as any);

const fakeClient = (
  address: string,
  opts: {
    headers?: Record<string, string>;
    auth?: Record<string, unknown>;
    query?: Record<string, unknown>;
    ctx?: any;
  } = {}
) =>
  ({
    handshake: {
      address,
      headers: opts.headers ?? {},
      auth: opts.auth ?? {},
      query: opts.query ?? {},
    },
    data: { ctx: opts.ctx },
    emit: vi.fn(),
    disconnect: vi.fn(),
    join: vi.fn().mockResolvedValue(undefined),
    leave: vi.fn().mockResolvedValue(undefined),
  } as any);

const makeGateway = (overrides: {
  service?: any;
  authContext?: any;
  roles?: any;
  permissions?: any;
  budgetGuard?: any;
  defaultsGate?: any;
  idempotency?: any;
  conductor?: any;
  policy?: any;
} = {}) =>
  new AiDesignerGateway(
    overrides.service ?? null,
    overrides.authContext ?? null,
    overrides.roles ?? null,
    overrides.permissions ?? null,
    overrides.budgetGuard ?? null,
    overrides.defaultsGate ?? null,
    overrides.idempotency ?? null,
    overrides.conductor ?? null,
    overrides.policy ?? (null as any)
  );

const makeGatewayWithMocks = (
  overrides: {
    policy?: any;
    idempotency?: any;
    conductor?: any;
    service?: any;
    authContext?: any;
    roles?: any;
    permissions?: any;
  } = {}
) =>
  new AiDesignerGateway(
    overrides.service ?? {
      getSessionForUser: vi.fn().mockResolvedValue({ id: 's1' }),
      appendMessage: vi.fn().mockResolvedValue({ id: 'm1', seq: 1 }),
      getMessagesAfterSeq: vi.fn().mockResolvedValue([]),
    },
    overrides.authContext ?? null,
    overrides.roles ?? null,
    overrides.permissions ?? null,
    null as any,
    null as any,
    overrides.idempotency ??
      ({
        forSession: vi.fn().mockResolvedValue(true),
        releaseForSession: vi.fn().mockResolvedValue(undefined),
        start: vi.fn().mockResolvedValue(true),
        releaseStart: vi.fn().mockResolvedValue(undefined),
      } as any),
    overrides.conductor ?? (null as any),
    overrides.policy ?? (null as any)
  );

const fakeSocket = (ctx: any) =>
  ({
    data: { ctx },
    emit: vi.fn(),
    join: vi.fn().mockResolvedValue(undefined),
    leave: vi.fn().mockResolvedValue(undefined),
  } as any);

const abilityThatCan = () =>
  ({
    can: vi.fn().mockReturnValue(true),
  } as any);

const abilityThatCannot = () =>
  ({
    can: vi.fn().mockReturnValue(false),
  } as any);

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('AiDesignerGateway rate limiting', () => {
  it('caps per-user events at the configured limit and resets after the window', () => {
    vi.useFakeTimers();
    const gw = makeGateway() as any;

    for (let i = 0; i < 5; i++) {
      expect(gw._rateLimit('user-1', 'start')).toBe(true);
    }
    expect(gw._rateLimit('user-1', 'start')).toBe(false);

    // Another user is unaffected; unknown events are unlimited.
    expect(gw._rateLimit('user-2', 'start')).toBe(true);
    expect(gw._rateLimit('user-1', 'unknown-event')).toBe(true);

    vi.advanceTimersByTime(60_001);
    expect(gw._rateLimit('user-1', 'start')).toBe(true);
  });

  it('keys the connect budget on the transport address when TRUST_PROXY_HOPS is unset', () => {
    vi.stubEnv('TRUST_PROXY_HOPS', '');
    const gw = makeGateway() as any;

    // 120 attempts allowed, the 121st rejected — spoofed XFF must not mint a
    // fresh bucket per attempt.
    for (let i = 0; i < 120; i++) {
      expect(
        gw._connectRateLimit(
          fakeClient('10.0.0.9', { headers: { 'x-forwarded-for': `spoof-${i}` } })
        )
      ).toBe(true);
    }
    expect(
      gw._connectRateLimit(
        fakeClient('10.0.0.9', { headers: { 'x-forwarded-for': 'spoof-final' } })
      )
    ).toBe(false);

    // A genuinely different transport address gets its own bucket.
    expect(gw._connectRateLimit(fakeClient('10.0.0.10'))).toBe(true);
  });

  it('uses the Nth-from-right XFF entry when TRUST_PROXY_HOPS is set', () => {
    vi.stubEnv('TRUST_PROXY_HOPS', '1');
    const gw = makeGateway() as any;

    // Two different client IPs behind the same proxy each get their own bucket.
    const proxy = '10.0.0.9';
    for (let i = 0; i < 120; i++) {
      expect(
        gw._connectRateLimit(
          fakeClient(proxy, {
            headers: { 'x-forwarded-for': '192.168.1.10' },
          })
        )
      ).toBe(true);
    }
    expect(
      gw._connectRateLimit(
        fakeClient(proxy, {
          headers: { 'x-forwarded-for': '192.168.1.10' },
        })
      )
    ).toBe(false);

    // A different client IP behind the same proxy gets a fresh bucket.
    expect(
      gw._connectRateLimit(
        fakeClient(proxy, {
          headers: { 'x-forwarded-for': '192.168.1.11' },
        })
      )
    ).toBe(true);
  });

  it('ignores padded left-most XFF entries when hops matches the real chain (D3)', () => {
    vi.stubEnv('TRUST_PROXY_HOPS', '1');
    const gw = makeGateway() as any;

    // Attacker-controlled left-most padding must not mint fresh buckets: with
    // TRUST_PROXY_HOPS equal to the real proxy count, only the rightmost
    // entry is consulted, so all padded variants share one bucket.
    const proxy = '10.0.0.9';
    for (let i = 0; i < 120; i++) {
      expect(
        gw._connectRateLimit(
          fakeClient(proxy, {
            headers: {
              'x-forwarded-for': `evil-${i}, 192.168.1.12`,
            },
          })
        )
      ).toBe(true);
    }
    expect(
      gw._connectRateLimit(
        fakeClient(proxy, {
          headers: { 'x-forwarded-for': 'evil-final, 192.168.1.12' },
        })
      )
    ).toBe(false);
  });

  it('falls back to handshake.address when XFF has fewer entries than TRUST_PROXY_HOPS', () => {
    vi.stubEnv('TRUST_PROXY_HOPS', '2');
    const gw = makeGateway() as any;

    // Only one XFF entry but hops=2 => fallback to address, so repeated calls
    // from the same address hit the same bucket.
    for (let i = 0; i < 120; i++) {
      expect(
        gw._connectRateLimit(
          fakeClient('10.0.0.9', {
            headers: { 'x-forwarded-for': '192.168.1.10' },
          })
        )
      ).toBe(true);
    }
    expect(
      gw._connectRateLimit(
        fakeClient('10.0.0.9', {
          headers: { 'x-forwarded-for': '192.168.1.11' },
        })
      )
    ).toBe(false);
  });

  it('sweeps expired buckets on the connect path once the map grows large', () => {
    vi.useFakeTimers();
    const gw = makeGateway() as any;

    // Seed past the sweep threshold with already-expiring buckets.
    for (let i = 0; i < 10_001; i++) {
      gw._rateBuckets.set(`ip:seed-${i}:connect`, {
        count: 1,
        resetAt: Date.now() + 60_000,
      });
    }
    vi.advanceTimersByTime(60_001);

    gw._connectRateLimit(fakeClient('10.0.0.9'));
    // All seeded (now expired) buckets were swept; only the fresh one remains.
    expect(gw._rateBuckets.size).toBe(1);
    expect(gw._rateBuckets.has('ip:10.0.0.9:connect')).toBe(true);
  });

  it('enforces a post-auth per-user connect budget', () => {
    const gw = makeGateway() as any;
    const userId = 'user-1';
    for (let i = 0; i < 30; i++) {
      expect(gw._userConnectRateLimit(userId)).toBe(true);
    }
    expect(gw._userConnectRateLimit(userId)).toBe(false);
    expect(gw._userConnectRateLimit('user-2')).toBe(true);
  });
});

describe('AiDesignerGateway _authenticate', () => {
  const authContext = {
    resolve: vi.fn(),
  } as any;

  const roles = {
    getEffectivePermissions: vi.fn().mockResolvedValue({
      permissions: ['media:create'],
    }),
  } as any;

  const permissions = {
    check: vi.fn().mockResolvedValue(abilityThatCan()),
  } as any;

  const baseCtx = {
    user: fakeUser('u1'),
    org: fakeOrg('o1'),
    isSuperAdmin: false,
    roleKey: 'member',
  };

  beforeEach(() => {
    authContext.resolve.mockReset();
    roles.getEffectivePermissions.mockReset();
    permissions.check.mockReset();
    authContext.resolve.mockResolvedValue({ ok: true, context: baseCtx });
    roles.getEffectivePermissions.mockResolvedValue({ permissions: ['media:create'] });
    permissions.check.mockResolvedValue(abilityThatCan());
  });

  it('passes with a valid cookie and CSRF token in handshake.auth', async () => {
    const gw = makeGateway({ authContext, roles, permissions }) as any;
    const client = fakeClient('10.0.0.9', {
      headers: { cookie: 'auth=valid-jwt; csrf_token=abc123' },
      auth: { csrfToken: 'abc123' },
    });

    const result = await gw._authenticate(client);

    expect(result?.ctx.userId).toBe('u1');
    expect(result?.ctx.orgId).toBe('o1');
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it('disconnects with csrf_failed when CSRF cookie is missing', async () => {
    const gw = makeGateway({ authContext, roles, permissions }) as any;
    const client = fakeClient('10.0.0.9', {
      headers: { cookie: 'auth=valid-jwt' },
      auth: { csrfToken: 'abc123' },
    });

    await gw._authenticate(client);

    expect(authContext.resolve).not.toHaveBeenCalled();
    expect(client.emit).toHaveBeenCalledWith('error', {
      code: 'csrf_failed',
      message: expect.any(String),
    });
    expect(client.disconnect).toHaveBeenCalled();
  });

  it('disconnects with csrf_failed when CSRF token mismatches', async () => {
    const gw = makeGateway({ authContext, roles, permissions }) as any;
    const client = fakeClient('10.0.0.9', {
      headers: { cookie: 'auth=valid-jwt; csrf_token=abc123' },
      auth: { csrfToken: 'wrong' },
    });

    await gw._authenticate(client);

    expect(authContext.resolve).not.toHaveBeenCalled();
    expect(client.emit).toHaveBeenCalledWith('error', {
      code: 'csrf_failed',
      message: expect.any(String),
    });
  });

  it('bypasses CSRF when NOT_SECURED is set', async () => {
    vi.stubEnv('NOT_SECURED', 'true');
    const gw = makeGateway({ authContext, roles, permissions }) as any;
    const client = fakeClient('10.0.0.9', {
      headers: { cookie: 'auth=valid-jwt' },
    });

    const result = await gw._authenticate(client);

    expect(result?.ctx.userId).toBe('u1');
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it('disconnects with auth_failed on bad JWT', async () => {
    authContext.resolve.mockResolvedValue({ ok: false, reason: 'invalid_jwt' });
    const gw = makeGateway({ authContext, roles, permissions }) as any;
    const client = fakeClient('10.0.0.9', {
      headers: { cookie: 'auth=bad-jwt; csrf_token=abc123' },
      auth: { csrfToken: 'abc123' },
    });

    await gw._authenticate(client);

    expect(client.emit).toHaveBeenCalledWith('error', {
      code: 'auth_failed',
      message: expect.any(String),
    });
  });

  it('disconnects with auth_failed when user is not found or not activated', async () => {
    authContext.resolve.mockResolvedValue({ ok: false, reason: 'user_not_found' });
    const gw = makeGateway({ authContext, roles, permissions }) as any;
    const client = fakeClient('10.0.0.9', {
      headers: { cookie: 'auth=valid-jwt; csrf_token=abc123' },
      auth: { csrfToken: 'abc123' },
    });

    await gw._authenticate(client);

    expect(client.emit).toHaveBeenCalledWith('error', {
      code: 'auth_failed',
      message: expect.any(String),
    });
  });

  it('disconnects with auth_failed when no org is resolved', async () => {
    authContext.resolve.mockResolvedValue({ ok: false, reason: 'no_org' });
    const gw = makeGateway({ authContext, roles, permissions }) as any;
    const client = fakeClient('10.0.0.9', {
      headers: { cookie: 'auth=valid-jwt; csrf_token=abc123' },
      auth: { csrfToken: 'abc123' },
    });

    await gw._authenticate(client);

    expect(client.emit).toHaveBeenCalledWith('error', {
      code: 'auth_failed',
      message: expect.any(String),
    });
  });

  it('passes showOrgId from cookie to the resolver', async () => {
    const gw = makeGateway({ authContext, roles, permissions }) as any;
    const client = fakeClient('10.0.0.9', {
      headers: {
        cookie: 'auth=valid-jwt; csrf_token=abc123; showorg=org-b',
      },
      auth: { csrfToken: 'abc123' },
    });

    await gw._authenticate(client);

    expect(authContext.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ showOrgId: 'org-b' })
    );
  });

  it('passes impersonateOrgUserId from cookie to the resolver', async () => {
    const gw = makeGateway({ authContext, roles, permissions }) as any;
    const client = fakeClient('10.0.0.9', {
      headers: {
        cookie:
          'auth=valid-jwt; csrf_token=abc123; impersonate=impersonated-user',
      },
      auth: { csrfToken: 'abc123' },
    });

    await gw._authenticate(client);

    expect(authContext.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ impersonateOrgUserId: 'impersonated-user' })
    );
  });

  it('uses the resolved impersonated user and org in the socket context', async () => {
    authContext.resolve.mockResolvedValue({
      ok: true,
      context: {
        user: fakeUser('u-impersonated'),
        org: fakeOrg('o-impersonated'),
        isSuperAdmin: true,
        roleKey: 'member',
      },
    });
    const gw = makeGateway({ authContext, roles, permissions }) as any;
    const client = fakeClient('10.0.0.9', {
      headers: { cookie: 'auth=admin-jwt; csrf_token=abc123' },
      auth: { csrfToken: 'abc123' },
    });

    const result = await gw._authenticate(client);

    expect(result?.ctx.userId).toBe('u-impersonated');
    expect(result?.ctx.orgId).toBe('o-impersonated');
    expect(result?.ctx.isSuperAdmin).toBe(true);
  });

  it('reads requestedSessionId from handshake.auth only, not query', async () => {
    const gw = makeGateway({ authContext, roles, permissions }) as any;
    const client = fakeClient('10.0.0.9', {
      headers: { cookie: 'auth=valid-jwt; csrf_token=abc123' },
      auth: { csrfToken: 'abc123', sessionId: 'from-auth' },
      query: { sessionId: 'from-query' },
    });

    const result = await gw._authenticate(client);

    expect(result?.requestedSessionId).toBe('from-auth');
  });

  it('reads lastAcked from handshake.auth only, not query', async () => {
    const gw = makeGateway({ authContext, roles, permissions }) as any;
    const client = fakeClient('10.0.0.9', {
      headers: { cookie: 'auth=valid-jwt; csrf_token=abc123' },
      auth: { csrfToken: 'abc123', lastAcked: 42 },
      query: { lastAcked: '99' },
    });

    const result = await gw._authenticate(client);

    expect(result?.ctx.lastAcked).toBe(42);
  });

  it('disconnects with rate_limited when post-auth per-user connect budget is exhausted', async () => {
    const gw = makeGateway({ authContext, roles, permissions }) as any;
    const baseClient = () =>
      fakeClient('10.0.0.9', {
        headers: { cookie: 'auth=valid-jwt; csrf_token=abc123' },
        auth: { csrfToken: 'abc123' },
      });

    for (let i = 0; i < 30; i++) {
      const client = baseClient();
      await gw._authenticate(client);
      expect(client.disconnect).not.toHaveBeenCalled();
    }

    const blocked = baseClient();
    await gw._authenticate(blocked);
    expect(blocked.emit).toHaveBeenCalledWith('error', {
      code: 'rate_limited',
      message: expect.any(String),
    });
    expect(blocked.disconnect).toHaveBeenCalled();
  });
});

describe('AiDesignerGateway _authorize', () => {
  const authContext = { resolve: vi.fn() } as any;

  it('disconnects with rbac_media_create when user lacks media:create and media:manage', async () => {
    const roles = {
      getEffectivePermissions: vi.fn().mockResolvedValue({
        permissions: ['media:read'],
      }),
    } as any;
    const permissions = { check: vi.fn().mockResolvedValue(abilityThatCan()) } as any;
    const gw = makeGateway({ authContext, roles, permissions }) as any;
    const client = fakeClient('10.0.0.9');
    const ctx = { userId: 'u1', orgId: 'o1', isSuperAdmin: false, roleKey: 'member', orgCreatedAt: new Date(), lastAuthzAt: 0, lastAcked: 0 };

    const ok = await gw._authorize(client, ctx);

    expect(ok).toBe(false);
    expect(client.emit).toHaveBeenCalledWith('error', {
      code: 'rbac_media_create',
      message: expect.any(String),
    });
  });

  it('super-admin bypasses RBAC and needs no permission check', async () => {
    const roles = { getEffectivePermissions: vi.fn() } as any;
    const permissions = { check: vi.fn().mockResolvedValue(abilityThatCan()) } as any;
    const gw = makeGateway({ authContext, roles, permissions }) as any;
    const client = fakeClient('10.0.0.9');
    const ctx = { userId: 'u1', orgId: 'o1', isSuperAdmin: true, roleKey: 'owner', orgCreatedAt: new Date(), lastAuthzAt: 0, lastAcked: 0 };

    const ok = await gw._authorize(client, ctx);

    expect(ok).toBe(true);
    expect(roles.getEffectivePermissions).not.toHaveBeenCalled();
    expect(permissions.check).not.toHaveBeenCalled();
    expect(ctx.lastAuthzAt).toBeGreaterThan(0);
  });
});

describe('AiDesignerGateway _gate', () => {
  const authContext = { resolve: vi.fn() } as any;
  const roles = {
    getEffectivePermissions: vi.fn().mockResolvedValue({
      permissions: ['media:create'],
    }),
  } as any;
  const permissions = { check: vi.fn().mockResolvedValue(abilityThatCan()) } as any;

  beforeEach(() => {
    roles.getEffectivePermissions.mockClear();
    permissions.check.mockClear();
  });

  it('re-runs authorization when the cached snapshot is older than 60s', async () => {
    const gw = makeGateway({ authContext, roles, permissions }) as any;
    const client = fakeClient('10.0.0.9');
    const ctx = {
      userId: 'u1',
      orgId: 'o1',
      isSuperAdmin: false,
      roleKey: 'member',
      orgCreatedAt: new Date(),
      lastAuthzAt: 0,
      lastAcked: 0,
    };
    client.data.ctx = ctx;

    await gw._gate(client, 'message');

    expect(roles.getEffectivePermissions).toHaveBeenCalledWith('o1', 'u1');
    expect(permissions.check).not.toHaveBeenCalled();
    expect(ctx.lastAuthzAt).toBeGreaterThan(0);
  });

  it('does not re-run authorization within the 60s window', async () => {
    const gw = makeGateway({ authContext, roles, permissions }) as any;
    const client = fakeClient('10.0.0.9');
    const now = Date.now();
    client.data.ctx = {
      userId: 'u1',
      orgId: 'o1',
      isSuperAdmin: false,
      roleKey: 'member',
      orgCreatedAt: new Date(),
      lastAuthzAt: now,
      lastAcked: 0,
    };

    await gw._gate(client, 'message');

    expect(roles.getEffectivePermissions).not.toHaveBeenCalled();
    expect(permissions.check).not.toHaveBeenCalled();
  });

  it('disconnects when permissions are revoked mid-session', async () => {
    roles.getEffectivePermissions.mockResolvedValue({
      permissions: ['media:create'],
    });
    permissions.check.mockResolvedValue(abilityThatCan());
    const gw = makeGateway({ authContext, roles, permissions }) as any;
    const client = fakeClient('10.0.0.9');
    client.data.ctx = {
      userId: 'u1',
      orgId: 'o1',
      isSuperAdmin: false,
      roleKey: 'member',
      orgCreatedAt: new Date(),
      lastAuthzAt: 0,
      lastAcked: 0,
    };

    // First gate passes and caches authz.
    await gw._gate(client, 'message');
    expect(client.disconnect).not.toHaveBeenCalled();

    // Simulate revocation on the next gate.
    roles.getEffectivePermissions.mockResolvedValue({
      permissions: ['media:read'],
    });
    client.data.ctx.lastAuthzAt = 0;

    await gw._gate(client, 'message');
    expect(client.emit).toHaveBeenCalledWith('error', {
      code: 'rbac_media_create',
      message: expect.any(String),
    });
    expect(client.disconnect).toHaveBeenCalled();
  });
});

describe('AiDesignerGateway _joinSessionRoom', () => {
  it('errors and does not join a session that does not belong to the user', async () => {
    const service = {
      getSessionForUser: vi.fn().mockResolvedValue(null),
    } as any;
    const gw = makeGateway({ service }) as any;
    const client = fakeClient('10.0.0.9');
    const ctx = { userId: 'u1', orgId: 'o1' };

    await gw._joinSessionRoom(client, 'foreign-session', ctx);

    expect(client.join).not.toHaveBeenCalled();
    expect(client.emit).toHaveBeenCalledWith('error', {
      code: 'session_not_found',
      message: expect.any(String),
    });
    expect(client.disconnect).toHaveBeenCalled();
  });

  it('joins an owned session and emits its state', async () => {
    const session: any = {
      id: 'own-session',
      organizationId: 'o1',
      userId: 'u1',
      mode: 'chat',
      format: 'image',
      config: {},
      brief: null,
      state: 'awaiting_plan',
      activeDesignIds: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const service = {
      getSessionForUser: vi.fn().mockResolvedValue(session),
      getMessagesAfterSeq: vi.fn().mockResolvedValue([]),
    } as any;
    const gw = makeGateway({ service }) as any;
    const client = fakeClient('10.0.0.9');
    const ctx = { userId: 'u1', orgId: 'o1', lastAcked: 0 };

    await gw._joinSessionRoom(client, 'own-session', ctx);

    expect(client.join).toHaveBeenCalledWith('session:own-session');
    expect(client.emit).toHaveBeenCalledWith(
      'session:state',
      expect.objectContaining({ session: expect.objectContaining({ id: 'own-session' }) })
    );
  });

  it('rolls a stale executing session back to awaiting_plan and emits a recovery message', async () => {
    vi.useFakeTimers();
    const stale = new Date(Date.now() - 16 * 60_000);
    const session: any = {
      id: 'stuck-session',
      organizationId: 'o1',
      userId: 'u1',
      mode: 'chat',
      format: 'image',
      config: {},
      brief: null,
      state: 'executing',
      activeDesignIds: null,
      createdAt: stale,
      updatedAt: stale,
    };
    const recovered = { ...session, state: 'awaiting_plan', updatedAt: new Date() };
    const service = {
      getSessionForUser: vi.fn().mockResolvedValue(session),
      updateSession: vi.fn().mockResolvedValue(recovered),
      getMessagesAfterSeq: vi.fn().mockResolvedValue([]),
    } as any;
    const gw = makeGateway({ service }) as any;
    gw.server = { to: vi.fn().mockReturnValue({ emit: vi.fn() }) } as any;
    const client = fakeClient('10.0.0.9');
    const ctx = { userId: 'u1', orgId: 'o1', lastAcked: 0 };

    await gw._joinSessionRoom(client, 'stuck-session', ctx);

    expect(service.updateSession).toHaveBeenCalledWith(
      'stuck-session',
      'o1',
      'u1',
      { state: 'awaiting_plan' }
    );
    expect(gw.server.to).toHaveBeenCalledWith('session:stuck-session');
    expect(client.join).toHaveBeenCalledWith('session:stuck-session');
    expect(client.emit).toHaveBeenCalledWith(
      'session:state',
      expect.objectContaining({
        session: expect.objectContaining({ state: 'awaiting_plan' }),
      })
    );
  });

  it('does not touch a fresh executing session', async () => {
    const session: any = {
      id: 'fresh-session',
      organizationId: 'o1',
      userId: 'u1',
      mode: 'chat',
      format: 'image',
      config: {},
      brief: null,
      state: 'executing',
      activeDesignIds: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const service = {
      getSessionForUser: vi.fn().mockResolvedValue(session),
      updateSession: vi.fn(),
      getMessagesAfterSeq: vi.fn().mockResolvedValue([]),
    } as any;
    const gw = makeGateway({ service }) as any;
    const client = fakeClient('10.0.0.9');
    const ctx = { userId: 'u1', orgId: 'o1', lastAcked: 0 };

    await gw._joinSessionRoom(client, 'fresh-session', ctx);

    expect(service.updateSession).not.toHaveBeenCalled();
    expect(client.join).toHaveBeenCalledWith('session:fresh-session');
  });
});

describe('AiDesignerGateway handleMessage idempotency', () => {
  const authContext = { resolve: vi.fn() } as any;
  const roles = {
    getEffectivePermissions: vi.fn().mockResolvedValue({
      permissions: ['media:create'],
    }),
  } as any;
  const permissions = { check: vi.fn().mockResolvedValue(abilityThatCan()) } as any;
  const policy = {
    check: vi.fn().mockResolvedValue({ ok: true, instruction: 'hello' }),
  } as any;

  it('rejects a duplicate nonce', async () => {
    const idempotency = {
      forSession: vi.fn().mockResolvedValue(false),
    } as any;
    const gw = makeGatewayWithMocks({ idempotency, policy }) as any;
    const client = fakeSocket({
      userId: 'u1',
      orgId: 'o1',
      sessionId: 's1',
      lastAuthzAt: Date.now(),
    });

    await gw.handleMessage(client, { nonce: 'n1', text: 'hello' });

    expect(client.emit).toHaveBeenCalledWith('error', {
      code: 'duplicate_nonce',
      message: expect.any(String),
      nonce: 'n1',
    });
  });

  it('releases the nonce when input guardrails reject the message', async () => {
    const idempotency = {
      forSession: vi.fn().mockResolvedValue(true),
      releaseForSession: vi.fn().mockResolvedValue(undefined),
    } as any;
    const rejectingPolicy = {
      check: vi.fn().mockResolvedValue({
        ok: false,
        reason: 'guardrail_blocked',
        message: 'blocked',
      }),
    } as any;
    const service = {
      getSessionForUser: vi.fn().mockResolvedValue({ id: 's1' }),
    } as any;
    const gw = makeGatewayWithMocks({
      idempotency,
      policy: rejectingPolicy,
      service,
    }) as any;
    const client = fakeSocket({
      userId: 'u1',
      orgId: 'o1',
      sessionId: 's1',
      lastAuthzAt: Date.now(),
    });

    await gw.handleMessage(client, { nonce: 'n1', text: 'bad' });

    expect(idempotency.releaseForSession).toHaveBeenCalledWith('n1', 's1');
    expect(client.emit).toHaveBeenCalledWith('error', {
      code: 'guardrail_blocked',
      message: 'blocked',
      nonce: 'n1',
    });
  });

  it('does not burn the nonce when the session is not owned by the user', async () => {
    const idempotency = {
      forSession: vi.fn().mockResolvedValue(true),
    } as any;
    const service = {
      getSessionForUser: vi.fn().mockResolvedValue(null),
    } as any;
    const gw = makeGatewayWithMocks({ idempotency, policy, service }) as any;
    const client = fakeSocket({
      userId: 'u1',
      orgId: 'o1',
      sessionId: 's1',
      lastAuthzAt: Date.now(),
    });

    await gw.handleMessage(client, { nonce: 'n1', text: 'hello' });

    expect(idempotency.forSession).not.toHaveBeenCalled();
    expect(client.emit).toHaveBeenCalledWith('error', {
      code: 'session_not_found',
      message: expect.any(String),
    });
  });

  it('dispatches the conductor and releases the nonce on unexpected failure', async () => {
    const idempotency = {
      forSession: vi.fn().mockResolvedValue(true),
      releaseForSession: vi.fn().mockResolvedValue(undefined),
    } as any;
    const conductor = {
      handleMessage: vi.fn().mockRejectedValue(new Error('boom')),
    } as any;
    const service = {
      getSessionForUser: vi.fn().mockResolvedValue({ id: 's1' }),
      appendMessage: vi.fn().mockResolvedValue({ id: 'm1', seq: 1 }),
    } as any;
    const gw = makeGatewayWithMocks({
      idempotency,
      policy,
      conductor,
      service,
    }) as any;
    gw.server = { to: vi.fn().mockReturnValue({ emit: vi.fn() }) } as any;
    const client = fakeSocket({
      userId: 'u1',
      orgId: 'o1',
      sessionId: 's1',
      lastAuthzAt: Date.now(),
    });

    await gw.handleMessage(client, { nonce: 'n1', text: 'hello' });

    expect(conductor.handleMessage).toHaveBeenCalled();
    expect(idempotency.releaseForSession).toHaveBeenCalledWith('n1', 's1');
    expect(client.emit).toHaveBeenCalledWith('error', {
      code: 'internal_error',
      message: expect.any(String),
      nonce: 'n1',
    });
  });
});

describe('AiDesignerGateway handleCancel', () => {
  const authContext = { resolve: vi.fn() } as any;
  const roles = {
    getEffectivePermissions: vi.fn().mockResolvedValue({
      permissions: ['media:create'],
    }),
  } as any;
  const permissions = { check: vi.fn().mockResolvedValue(abilityThatCan()) } as any;

  it('emits internal_error when the conductor throws', async () => {
    const conductor = {
      handleCancel: vi.fn().mockRejectedValue(new Error('cancel boom')),
    } as any;
    const gw = makeGateway({ authContext, roles, permissions, conductor }) as any;
    const client = fakeSocket({
      userId: 'u1',
      orgId: 'o1',
      sessionId: 's1',
      lastAuthzAt: Date.now(),
    });

    await gw.handleCancel(client);

    expect(conductor.handleCancel).toHaveBeenCalled();
    expect(client.emit).toHaveBeenCalledWith('error', {
      code: 'internal_error',
      message: expect.any(String),
    });
  });
});

describe('AiDesignerGateway handleStart cleanup', () => {
  const authContext = { resolve: vi.fn() } as any;
  const roles = {
    getEffectivePermissions: vi.fn().mockResolvedValue({
      permissions: ['media:create'],
    }),
  } as any;
  const permissions = { check: vi.fn().mockResolvedValue(abilityThatCan()) } as any;
  const budgetGuard = {
    checkStartBudget: vi.fn().mockResolvedValue({ allowed: true }),
  } as any;
  const defaultsGate = {
    missingDefaults: vi.fn().mockResolvedValue({ blocked: false }),
  } as any;
  const policy = {
    check: vi.fn().mockResolvedValue({ ok: true, instruction: undefined }),
  } as any;

  it('deletes the just-created session when the conductor throws', async () => {
    const session: any = {
      id: 'new-session',
      organizationId: 'o1',
      userId: 'u1',
      mode: 'chat',
      format: 'image',
      config: { channels: ['x-post'], variants: 1 },
      brief: null,
      state: 'intake',
      activeDesignIds: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const service = {
      atSessionCap: vi.fn().mockResolvedValue(false),
      createSession: vi.fn().mockResolvedValue(session),
      deleteSession: vi.fn().mockResolvedValue(session),
      getSessionForUser: vi.fn().mockResolvedValue(session),
      getMessagesAfterSeq: vi.fn().mockResolvedValue([]),
    } as any;
    const idempotency = {
      start: vi.fn().mockResolvedValue(true),
      releaseStart: vi.fn().mockResolvedValue(undefined),
    } as any;
    const conductor = {
      handleStart: vi.fn().mockRejectedValue(new Error('conductor boom')),
    } as any;
    const gw = makeGateway({
      authContext,
      roles,
      permissions,
      budgetGuard,
      defaultsGate,
      idempotency,
      conductor,
      policy,
      service,
    }) as any;
    gw.server = { to: vi.fn().mockReturnValue({ emit: vi.fn() }) } as any;
    const client = fakeSocket({
      userId: 'u1',
      orgId: 'o1',
      lastAuthzAt: Date.now(),
    });

    await gw.handleStart(client, {
      nonce: 'n1',
      mode: 'chat',
      config: { channels: ['x-post'], variants: 1 },
    });

    expect(service.createSession).toHaveBeenCalled();
    expect(conductor.handleStart).toHaveBeenCalled();
    expect(service.deleteSession).toHaveBeenCalledWith('new-session', 'o1', 'u1');
    expect(idempotency.releaseStart).toHaveBeenCalledWith('n1', 'u1', 'o1');
    expect(client.emit).toHaveBeenCalledWith('error', {
      code: 'internal_error',
      message: expect.any(String),
      nonce: 'n1',
    });
  });
});

describe('AiDesignerGateway input policy fast-fail', () => {
  it('emits invalid_payload before nonce claim when form values are too large', async () => {
    const policy = {
      check: vi.fn().mockResolvedValue({
        ok: false,
        reason: 'value_bounds',
        message: 'too big',
      }),
    } as any;
    const idempotency = {
      forSession: vi.fn().mockResolvedValue(true),
    };
    const gw = makeGatewayWithMocks({ policy, idempotency });
    const client = fakeSocket({
      userId: 'u1',
      orgId: 'o1',
      sessionId: 's1',
      lastAuthzAt: Date.now(),
    });

    await gw.handleFormSubmit(client, {
      nonce: 'n1',
      replyTo: 'r1',
      values: { blob: 'x' },
    });

    expect(policy.check).toHaveBeenCalledWith(
      { values: { blob: 'x' } },
      'o1'
    );
    expect(idempotency.forSession).not.toHaveBeenCalled();
    expect(client.emit).toHaveBeenCalledWith('error', {
      code: 'invalid_payload',
      message: 'too big',
      nonce: 'n1',
    });
  });

  it('emits guardrail_blocked when the revise instruction is blocked', async () => {
    const policy = {
      check: vi.fn().mockResolvedValue({
        ok: false,
        reason: 'guardrail_blocked',
        message: 'blocked',
      }),
    } as any;
    const idempotency = {
      forSession: vi.fn().mockResolvedValue(true),
      releaseForSession: vi.fn().mockResolvedValue(undefined),
    };
    const gw = makeGatewayWithMocks({ policy, idempotency });
    const client = fakeSocket({
      userId: 'u1',
      orgId: 'o1',
      sessionId: 's1',
      lastAuthzAt: Date.now(),
    });

    await gw.handleRevise(client, {
      nonce: 'n1',
      instruction: 'bad',
      targetDesignId: 'd1',
    });

    expect(policy.check).toHaveBeenCalledWith(
      { values: {}, instruction: 'bad' },
      'o1'
    );
    expect(idempotency.releaseForSession).toHaveBeenCalledWith('n1', 's1');
    expect(client.emit).toHaveBeenCalledWith('error', {
      code: 'guardrail_blocked',
      message: 'blocked',
      nonce: 'n1',
    });
  });
});
