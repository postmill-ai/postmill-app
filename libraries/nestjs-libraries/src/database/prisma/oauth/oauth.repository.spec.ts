import { describe, it, expect, vi } from 'vitest';
import { OAuthRepository } from './oauth.repository';

/**
 * 2.1 — an expired-but-unrevoked pos_ token must not authenticate forever.
 * findByAccessToken must scope on both revokedAt AND tokenExpiresAt.
 *
 * NOTE (4.5): this is a DELIBERATE white-box spec — it asserts the exact Prisma
 * `where` shape (the `OR` branches + `revokedAt: null`). A semantically-equivalent
 * rewrite of the query would falsely fail here. That coupling is intentional for a
 * security-critical filter: the change-detector is the point (any edit to the
 * expiry/revocation predicate must be re-reviewed), so keep it white-box rather
 * than loosening it to a behavior-style matcher.
 */
describe('OAuthRepository.findByAccessToken', () => {
  const makeRepo = () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const oauthAuth = { model: { oAuthAuthorization: { findFirst } } } as any;
    const oauthApp = { model: { oAuthApp: {} } } as any;
    return { repo: new OAuthRepository(oauthApp, oauthAuth), findFirst };
  };

  it('rejects expired tokens (OR: null | tokenExpiresAt > now) and keeps revokedAt: null', () => {
    const { repo, findFirst } = makeRepo();
    repo.findByAccessToken('enc-token');

    const where = findFirst.mock.calls[0][0].where;
    expect(where.revokedAt).toBeNull();
    expect(Array.isArray(where.OR)).toBe(true);
    // one branch allows legacy null rows, the other requires a future expiry
    const hasNullBranch = where.OR.some(
      (b: any) => b.tokenExpiresAt === null
    );
    const hasFutureBranch = where.OR.some(
      (b: any) => b.tokenExpiresAt?.gt instanceof Date
    );
    expect(hasNullBranch).toBe(true);
    expect(hasFutureBranch).toBe(true);
  });
});


describe('OAuthRepository org-scoped mutations (TI-12)', () => {
  const makeRepo = (overrides: any = {}) => {
    const findFirst = vi.fn().mockResolvedValue({ id: 'app-1', organizationId: 'org-1' });
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const getAppByOrgId = vi.fn().mockResolvedValue({ id: 'app-1', organizationId: 'org-1' });
    const oauthApp = {
      model: {
        oAuthApp: {
          findFirst,
          updateMany,
        },
      },
    } as any;
    const oauthAuth = { model: { oAuthAuthorization: {} } } as any;
    const repo = new OAuthRepository(oauthApp, oauthAuth);
    if (overrides.getAppByOrgId) {
      repo.getAppByOrgId = overrides.getAppByOrgId;
    }
    return { repo, findFirst, updateMany, getAppByOrgId };
  };

  it('updateApp scopes the write by orgId', async () => {
    const { repo, updateMany, getAppByOrgId } = makeRepo();
    await repo.updateApp('org-1', { name: 'Updated' });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'app-1', organizationId: 'org-1' },
      data: { name: 'Updated' },
    });
  });

  it('deleteApp scopes the soft-delete by orgId', async () => {
    const { repo, updateMany } = makeRepo();
    const result = await repo.deleteApp('org-1');
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'app-1', organizationId: 'org-1' },
      }),
    );
    expect(result).toEqual(expect.objectContaining({ id: 'app-1' }));
  });

  it('updateClientSecret scopes the write by orgId', async () => {
    const { repo, updateMany } = makeRepo();
    await repo.updateClientSecret('org-1', 'new-secret');
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'app-1', organizationId: 'org-1' },
      data: { clientSecret: 'new-secret' },
    });
  });

  it('returns null when the org-scoped update affects no rows', async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: 'app-1', organizationId: 'org-1' });
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const oauthApp = {
      model: { oAuthApp: { findFirst, updateMany } },
    } as any;
    const repo = new OAuthRepository(oauthApp, { model: { oAuthAuthorization: {} } } as any);
    expect(await repo.updateApp('org-1', { name: 'Updated' })).toBeNull();
  });
});
