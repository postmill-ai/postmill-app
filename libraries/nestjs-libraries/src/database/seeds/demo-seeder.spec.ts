import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger } from '@nestjs/common';
import { AuthService } from '@postmill-ai/helpers/auth/auth.service';
import { DemoSeeder } from './demo-seeder';

// The cast contract the e2e personas bind to. e2e/tests/auth.setup.ts signs in
// as these addresses via E2E_MEMBER_EMAIL / E2E_FREE_EMAIL, so a change here is
// a breaking change to the test suite — pinned deliberately rather than
// imported from the seeder's private CAST array.
const CAST = [
  { email: 'demo-jordan@solstice.demo', roleKey: 'editor' },
  { email: 'demo-sam@solstice.demo', roleKey: 'member' },
  { email: 'demo-priya@solstice.demo', roleKey: 'viewer' },
];

const ORG_ID = 'org-1';
const OWNER_ID = 'user-owner';

type Prisma = {
  user: { findFirst: any; create: any; update: any };
  userProfile: { upsert: any };
  appRole: { findFirst: any };
  userOrganization: { findFirst: any; create: any };
};

const makePrisma = (): Prisma => {
  let n = 0;
  return {
    user: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(async ({ data }: any) => ({
        id: `cast-${++n}`,
        ...data,
      })),
      update: vi.fn().mockImplementation(async ({ where, data }: any) => ({
        id: where.id,
        ...data,
      })),
    },
    userProfile: { upsert: vi.fn().mockResolvedValue(undefined) },
    appRole: {
      findFirst: vi
        .fn()
        .mockImplementation(async ({ where }: any) => ({ id: `role-${where.key}` })),
    },
    userOrganization: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(undefined),
    },
  };
};

// _seedCast is the only surface under test; the rest of the seeder's
// collaborators are never touched on this path.
const makeSeeder = (prisma: Prisma) =>
  new DemoSeeder(
    prisma as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
  );

const seedCast = (seeder: DemoSeeder, prismaOrgId = ORG_ID) =>
  (seeder as any)._seedCast(prismaOrgId, OWNER_ID);

describe('DemoSeeder._seedCast', () => {
  let prisma: Prisma;
  let seeder: DemoSeeder;

  beforeEach(() => {
    prisma = makePrisma();
    seeder = makeSeeder(prisma);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.DEV_SEED_DEMO_PASSWORD;
  });

  it('gives every cast member a password that verifies against the default', async () => {
    await seedCast(seeder);

    expect(prisma.user.create).toHaveBeenCalledTimes(CAST.length);
    CAST.forEach(({ email }, i) => {
      const { data } = prisma.user.create.mock.calls[i][0];
      expect(data.email).toBe(email);
      expect(data.password).toEqual(expect.any(String));
      // Not null, and a real bcrypt hash rather than the plaintext.
      expect(data.password).not.toBe('Test123!');
      expect(AuthService.comparePassword('Test123!', data.password)).toBe(true);
      expect(data.activated).toBe(true);
    });
  });

  it('honours DEV_SEED_DEMO_PASSWORD so owner and cast share one password', async () => {
    process.env.DEV_SEED_DEMO_PASSWORD = 'S3curePass!';
    await seedCast(seeder);

    for (const call of prisma.user.create.mock.calls) {
      expect(AuthService.comparePassword('S3curePass!', call[0].data.password)).toBe(true);
      expect(AuthService.comparePassword('Test123!', call[0].data.password)).toBe(false);
    }
  });

  it('backfills a null password on a cast row left by an earlier seeder version', async () => {
    prisma.user.findFirst.mockImplementation(async ({ where }: any) =>
      where.email === 'demo-jordan@solstice.demo'
        ? { id: 'legacy-jordan', email: where.email, password: null }
        : null
    );

    await seedCast(seeder);

    expect(prisma.user.update).toHaveBeenCalledTimes(1);
    const { where, data } = prisma.user.update.mock.calls[0][0];
    expect(where.id).toBe('legacy-jordan');
    expect(AuthService.comparePassword('Test123!', data.password)).toBe(true);
    expect(data.activated).toBe(true);
    // The other two were absent, so they take the create path.
    expect(prisma.user.create).toHaveBeenCalledTimes(2);
  });

  it('leaves an already-hashed cast password untouched', async () => {
    const existing = AuthService.hashPassword('Test123!');
    prisma.user.findFirst.mockResolvedValue({
      id: 'existing',
      email: 'demo-jordan@solstice.demo',
      password: existing,
    });

    await seedCast(seeder);

    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('keeps the editor/member/viewer role split the RBAC spec relies on', async () => {
    await seedCast(seeder);

    const roleKeys = prisma.appRole.findFirst.mock.calls.map((c: any) => c[0].where.key);
    expect(roleKeys).toEqual(CAST.map((c) => c.roleKey));

    const created = prisma.userOrganization.create.mock.calls.map((c: any) => c[0].data);
    expect(created).toHaveLength(CAST.length);
    created.forEach((d: any, i: number) => {
      expect(d.organizationId).toBe(ORG_ID);
      expect(d.roleId).toBe(`role-${CAST[i].roleKey}`);
      expect(d.disabled).toBe(false);
    });
  });
});
