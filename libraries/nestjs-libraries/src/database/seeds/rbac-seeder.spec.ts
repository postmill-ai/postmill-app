import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RbacSeeder } from './rbac-seeder';

// Mock the Prisma client. `permission.upsert` returns id === "resource:action"
// so the assertions below read in human-readable permission strings.
const makePrisma = () => ({
  permission: {
    upsert: vi.fn(({ where }: any) => {
      const { resource, action } = where.resource_action;
      return Promise.resolve({ id: `${resource}:${action}` });
    }),
  },
  appRole: {
    // Role already exists → exercises the reconcile (delete-stale) path, which is
    // what fixes existing deployments (a fresh create would never carry stale grants).
    findFirst: vi.fn(({ where }: any) => Promise.resolve({ id: where.key })),
    create: vi.fn(),
  },
  appRolePermission: {
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    createMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
});

const idsFor = (prisma: ReturnType<typeof makePrisma>, roleKey: string) => {
  const call = prisma.appRolePermission.createMany.mock.calls
    .map((c) => c[0])
    .find((a: any) => a.data[0]?.roleId === roleKey);
  return (call?.data ?? []).map((d: any) => d.permissionId);
};

describe('RbacSeeder', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let seeder: RbacSeeder;

  beforeEach(() => {
    prisma = makePrisma();
    seeder = new RbacSeeder(prisma as any);
  });

  it('grants admin organization create/read/update but NOT the manage wildcard or delete', async () => {
    await seeder.seed();
    const ids = idsFor(prisma, 'admin');
    expect(ids).toContain('organization:create');
    expect(ids).toContain('organization:read');
    expect(ids).toContain('organization:update');
    // The bug: `organization:manage` implies delete via the guard wildcard, so
    // admin must hold neither — otherwise admin can delete the org.
    expect(ids).not.toContain('organization:manage');
    expect(ids).not.toContain('organization:delete');
    // Billing exclusion unchanged: wildcard dropped, explicit actions retained.
    expect(ids).not.toContain('billing:manage');
    expect(ids).toContain('billing:delete');
  });

  it('owner keeps the full manage wildcard (incl. billing:manage / organization:manage)', async () => {
    await seeder.seed();
    const ids = idsFor(prisma, 'owner');
    expect(ids).toContain('billing:manage');
    expect(ids).toContain('organization:manage');
  });

  it('reconciles: deletes any grant not in the role definition (sheds a stale admin→organization:manage)', async () => {
    await seeder.seed();
    const adminDelete = prisma.appRolePermission.deleteMany.mock.calls
      .map((c) => c[0])
      .find((a: any) => a.where.roleId === 'admin');
    expect(adminDelete).toBeTruthy();
    const notIn = adminDelete.where.permissionId.notIn as string[];
    // A previously-seeded organization:manage row is not in the desired set, so it
    // matches `notIn` and is removed on the next boot.
    expect(notIn).not.toContain('organization:manage');
    expect(notIn).not.toContain('organization:delete');
    // Desired perms are protected from deletion.
    expect(notIn).toContain('organization:update');
    // Scoped to this one template role only.
    expect(adminDelete.where.roleId).toBe('admin');
  });
});
