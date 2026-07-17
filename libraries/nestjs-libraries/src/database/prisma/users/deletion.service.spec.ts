import { describe, expect, it, vi } from 'vitest';
import { DeletionService } from './deletion.service';

function makeTx() {
  const fn = () => vi.fn().mockResolvedValue({ count: 0 });
  // Proxy returns a fresh model object with deleteMany/delete/updateMany for any
  // model accessed, so we don't have to enumerate all ~50 here.
  return new Proxy(
    {},
    {
      get: () => ({ deleteMany: fn(), delete: fn(), updateMany: fn() }),
    }
  ) as any;
}

describe('DeletionService', () => {
  it('deleteOrganization tears down then deletes the org row and audits', async () => {
    const orgDelete = vi.fn().mockResolvedValue({ id: 'org-1' });
    const tx = new Proxy(
      {},
      {
        get: (_t, prop) => {
          if (prop === 'organization') {
            return { delete: orgDelete };
          }
          return {
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
            updateMany: vi.fn().mockResolvedValue({ count: 0 }),
          };
        },
      }
    ) as any;

    const prisma = {
      $transaction: vi.fn(async (cb: any) => cb(tx)),
    } as any;
    const audit = { create: vi.fn().mockResolvedValue({}) } as any;

    const service = new DeletionService(prisma, audit);
    const result = await service.deleteOrganization('org-1', { userId: 'u-1' });

    expect(result).toEqual({ id: 'org-1' });
    expect(orgDelete).toHaveBeenCalledWith({ where: { id: 'org-1' } });
    expect(audit.create).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        action: 'organization.delete',
        entity: 'organization',
      })
    );
  });

  it('erases only orgs the user is the SOLE MEMBER of, leaving shared orgs intact', async () => {
    const memberships = [
      { organizationId: 'org-solo' },
      { organizationId: 'org-shared' },
    ];
    const userDelete = vi.fn().mockResolvedValue({ id: 'u-1' });

    const prisma = {
      userOrganization: {
        findMany: vi.fn().mockResolvedValue(memberships),
        // org-shared still has another member → must NOT be torn down; org-solo has none.
        count: vi
          .fn()
          .mockImplementation(({ where }: any) =>
            Promise.resolve(where?.organizationId === 'org-shared' ? 1 : 0)
          ),
      },
      $transaction: vi.fn(async (cb: any) => {
        if (typeof cb === 'function') {
          const tx = new Proxy(
            {},
            {
              get: (_t, prop) =>
                prop === 'user'
                  ? { delete: userDelete }
                  : { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
            }
          );
          return cb(tx);
        }
        return [];
      }),
    } as any;
    const audit = { create: vi.fn().mockResolvedValue({}) } as any;

    const service = new DeletionService(prisma, audit);
    // Stub deleteOrganization to isolate the user path.
    const delOrg = vi
      .spyOn(service, 'deleteOrganization')
      .mockResolvedValue({ id: 'org-solo' });

    const result = await service.deleteUser('u-1');

    expect(delOrg).toHaveBeenCalledWith('org-solo', { userId: 'u-1' });
    expect(delOrg).not.toHaveBeenCalledWith('org-shared', expect.anything());
    expect(userDelete).toHaveBeenCalledWith({ where: { id: 'u-1' } });
    expect(result).toEqual({ id: 'u-1' });
  });
});
