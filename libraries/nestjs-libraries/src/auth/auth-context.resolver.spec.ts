import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AuthContextResolver,
  AuthContextResult,
} from './auth-context.resolver';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { Organization, User } from '@prisma/client';

const makeUser = (overrides: Partial<User> = {}): User =>
  ({
    id: 'user-1',
    email: 'user@example.com',
    activated: true,
    isSuperAdmin: false,
    providerName: 'LOCAL',
    providerId: null,
    lastOnline: new Date(),
    ip: null,
    agent: null,
    lastReadNotifications: new Date(),
    password: 'hashed',
    ...overrides,
  }) as User;

const makeOrg = (
  id: string,
  membershipOverrides: Partial<{
    disabled: boolean;
    roleId: string | null;
    roleRef: { key: string } | null;
    userId: string;
  }> = {},
  userId: string = 'user-1'
): Organization & { users: any[] } =>
  ({
    id,
    name: `Org ${id}`,
    createdAt: new Date(),
    users: [
      {
        disabled: false,
        roleId: 'role-1',
        roleRef: { key: 'admin' },
        userId,
        ...membershipOverrides,
      },
    ],
  }) as Organization & { users: any[] };

const makeServices = () => {
  const users = {
    getUserById: vi.fn(),
  } as any;
  const orgs = {
    getUserOrg: vi.fn(),
    getOrgsByUserId: vi.fn(),
  } as any;
  const resolver = new AuthContextResolver(users, orgs);
  return { resolver, users, orgs };
};

describe('AuthContextResolver', () => {
  beforeEach(() => {
    vi.spyOn(AuthService, 'verifyJWT').mockImplementation((token: string) => {
      if (token === 'valid-token') {
        return { id: 'user-1', exp: 1_000_000_000_000 } as any;
      }
      if (token === 'valid-no-exp') {
        return { id: 'user-1' } as any;
      }
      if (token === 'no-id-token') {
        return {} as any;
      }
      throw new Error('invalid jwt');
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns missing_auth when jwt is empty', async () => {
    const { resolver } = makeServices();
    const result = await resolver.resolve({ jwt: '' });
    expect(result).toEqual({ ok: false, reason: 'missing_auth' });
  });

  it('returns invalid_jwt when verification fails', async () => {
    const { resolver } = makeServices();
    const result = await resolver.resolve({ jwt: 'bad-token' });
    expect(result).toEqual({ ok: false, reason: 'invalid_jwt' });
  });

  it('returns invalid_jwt when payload has no id', async () => {
    const { resolver } = makeServices();
    const result = await resolver.resolve({ jwt: 'no-id-token' });
    expect(result).toEqual({ ok: false, reason: 'invalid_jwt' });
  });

  it('returns user_not_found when user does not exist', async () => {
    const { resolver, users } = makeServices();
    users.getUserById.mockResolvedValue(null);
    const result = await resolver.resolve({ jwt: 'valid-token' });
    expect(result).toEqual({ ok: false, reason: 'user_not_found' });
    expect(users.getUserById).toHaveBeenCalledWith('user-1');
  });

  it('returns user_not_found when user is not activated', async () => {
    const { resolver, users } = makeServices();
    users.getUserById.mockResolvedValue(makeUser({ activated: false }));
    const result = await resolver.resolve({ jwt: 'valid-token' });
    expect(result).toEqual({ ok: false, reason: 'user_not_found' });
  });

  it('resolves user, org, roleKey and expiresAt for a valid JWT', async () => {
    const { resolver, users, orgs } = makeServices();
    const user = makeUser();
    const org = makeOrg('org-1');
    users.getUserById.mockResolvedValue(user);
    orgs.getOrgsByUserId.mockResolvedValue([org]);

    const result = await resolver.resolve({ jwt: 'valid-token' });

    expect(result.ok).toBe(true);
    const ctx = (result as AuthContextResult & { ok: true }).context;
    expect(ctx.user.id).toBe('user-1');
    expect(ctx.org.id).toBe('org-1');
    expect(ctx.isSuperAdmin).toBe(false);
    expect(ctx.roleKey).toBe('admin');
    expect(ctx.expiresAt).toBe(1_000_000_000_000);
    expect(ctx.impersonated).toBe(false);
    expect(ctx.user.password).toBeUndefined();
  });

  it('selects org by showOrgId when provided', async () => {
    const { resolver, users, orgs } = makeServices();
    users.getUserById.mockResolvedValue(makeUser());
    orgs.getOrgsByUserId.mockResolvedValue([
      makeOrg('org-a'),
      makeOrg('org-b'),
    ]);

    const result = await resolver.resolve({
      jwt: 'valid-token',
      showOrgId: 'org-b',
    });

    expect(result.ok).toBe(true);
    expect((result as any).context.org.id).toBe('org-b');
  });

  it('falls back to the first org when showOrgId does not match', async () => {
    const { resolver, users, orgs } = makeServices();
    users.getUserById.mockResolvedValue(makeUser());
    const firstOrg = makeOrg('org-a');
    orgs.getOrgsByUserId.mockResolvedValue([firstOrg, makeOrg('org-b')]);

    const result = await resolver.resolve({
      jwt: 'valid-token',
      showOrgId: 'org-z',
    });

    expect(result.ok).toBe(true);
    expect((result as any).context.org.id).toBe('org-a');
  });

  it('filters out disabled memberships', async () => {
    const { resolver, users, orgs } = makeServices();
    users.getUserById.mockResolvedValue(makeUser());
    orgs.getOrgsByUserId.mockResolvedValue([
      makeOrg('org-disabled', { disabled: true }),
      makeOrg('org-active'),
    ]);

    const result = await resolver.resolve({ jwt: 'valid-token' });

    expect(result.ok).toBe(true);
    expect((result as any).context.org.id).toBe('org-active');
  });

  it('returns no_org when all memberships are disabled', async () => {
    const { resolver, users, orgs } = makeServices();
    users.getUserById.mockResolvedValue(makeUser());
    orgs.getOrgsByUserId.mockResolvedValue([
      makeOrg('org-disabled', { disabled: true }),
    ]);

    const result = await resolver.resolve({ jwt: 'valid-token' });
    expect(result).toEqual({ ok: false, reason: 'no_org' });
  });

  it('returns no_org when user has no organizations', async () => {
    const { resolver, users, orgs } = makeServices();
    users.getUserById.mockResolvedValue(makeUser());
    orgs.getOrgsByUserId.mockResolvedValue([]);

    const result = await resolver.resolve({ jwt: 'valid-token' });
    expect(result).toEqual({ ok: false, reason: 'no_org' });
  });

  it('handles super-admin impersonation by swapping user and org', async () => {
    const { resolver, users, orgs } = makeServices();
    const adminUser = makeUser({ id: 'admin-1', isSuperAdmin: true });
    const impersonatedUser = makeUser({
      id: 'impersonated-1',
      email: 'impersonated@example.com',
    });
    const impersonatedOrg = makeOrg('org-impersonated', {}, 'impersonated-1');

    users.getUserById.mockResolvedValue(adminUser);
    orgs.getUserOrg.mockResolvedValue({
      user: impersonatedUser,
      organization: impersonatedOrg,
    });

    const result = await resolver.resolve({
      jwt: 'valid-token',
      impersonateOrgUserId: 'uo-123',
    });

    expect(result.ok).toBe(true);
    const ctx = (result as any).context;
    expect(ctx.user.id).toBe('impersonated-1');
    expect(ctx.user.isSuperAdmin).toBe(true);
    expect(ctx.user.password).toBeUndefined();
    expect(ctx.org.id).toBe('org-impersonated');
    expect(ctx.isSuperAdmin).toBe(true);
    expect(ctx.roleKey).toBe('admin');
    expect(ctx.impersonated).toBe(true);
    expect(orgs.getUserOrg).toHaveBeenCalledWith('uo-123');
  });

  it('falls back to own orgs when impersonation target is not found', async () => {
    const { resolver, users, orgs } = makeServices();
    const adminUser = makeUser({ id: 'admin-1', isSuperAdmin: true });
    users.getUserById.mockResolvedValue(adminUser);
    orgs.getUserOrg.mockResolvedValue(null);
    orgs.getOrgsByUserId.mockResolvedValue([makeOrg('org-own')]);

    const result = await resolver.resolve({
      jwt: 'valid-token',
      impersonateOrgUserId: 'missing',
    });

    expect(result.ok).toBe(true);
    expect((result as any).context.org.id).toBe('org-own');
    expect((result as any).context.isSuperAdmin).toBe(true);
  });

  it('ignores impersonation for non-super-admin users', async () => {
    const { resolver, users, orgs } = makeServices();
    users.getUserById.mockResolvedValue(makeUser());
    orgs.getOrgsByUserId.mockResolvedValue([makeOrg('org-own')]);

    const result = await resolver.resolve({
      jwt: 'valid-token',
      impersonateOrgUserId: 'uo-123',
    });

    expect(result.ok).toBe(true);
    expect((result as any).context.org.id).toBe('org-own');
    expect(orgs.getUserOrg).not.toHaveBeenCalled();
  });

  it('falls back to member when roleRef is absent', async () => {
    const { resolver, users, orgs } = makeServices();
    users.getUserById.mockResolvedValue(makeUser());
    orgs.getOrgsByUserId.mockResolvedValue([
      makeOrg('org-1', { roleRef: null, roleId: null }),
    ]);

    const result = await resolver.resolve({ jwt: 'valid-token' });

    expect(result.ok).toBe(true);
    expect((result as any).context.roleKey).toBe('member');
  });

  it('omits expiresAt when the JWT has no exp claim', async () => {
    const { resolver, users, orgs } = makeServices();
    users.getUserById.mockResolvedValue(makeUser());
    orgs.getOrgsByUserId.mockResolvedValue([makeOrg('org-1')]);

    const result = await resolver.resolve({ jwt: 'valid-no-exp' });

    expect(result.ok).toBe(true);
    expect((result as any).context.expiresAt).toBeUndefined();
  });
});
