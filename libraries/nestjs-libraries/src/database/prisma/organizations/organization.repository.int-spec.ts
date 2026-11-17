import { inject } from 'vitest';
import {
  PrismaRepository,
  PrismaService,
  PrismaTransaction,
} from '@postmill-ai/nestjs-libraries/database/prisma/prisma.service';
import { getTestPrisma } from '@postmill-ai/nestjs-libraries/testing/test-db';
import { OrganizationRepository } from './organization.repository';

describe('OrganizationRepository invite acceptance (integration)', () => {
  it('allows concurrent retries by one user without duplicating membership', async () => {
    const prisma = getTestPrisma(inject('dbUrl'));
    const repository = new OrganizationRepository(
      new PrismaRepository<'organization'>(prisma as unknown as PrismaService),
      new PrismaRepository<'userOrganization'>(prisma as unknown as PrismaService),
      new PrismaRepository<'user'>(prisma as unknown as PrismaService),
      new PrismaRepository<'storageProviderConfig'>(prisma as unknown as PrismaService),
      new PrismaRepository<'appRole'>(prisma as unknown as PrismaService),
      new PrismaTransaction(prisma as unknown as PrismaService),
    );
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const organizationId = `invite-org-${suffix}`;
    const userId = `invite-user-${suffix}`;
    const roleId = `invite-role-${suffix}`;
    const inviteId = `invite-${suffix}`;

    try {
      await prisma.organization.create({ data: { id: organizationId, name: 'Invite test org' } });
      await prisma.user.create({
        data: { id: userId, email: `${userId}@example.com`, providerName: 'LOCAL' },
      });
      await prisma.appRole.create({
        data: { id: roleId, key: 'member', name: 'Member', isSystem: true },
      });

      const attempts = await Promise.allSettled([
        repository.addUserToOrg(userId, inviteId, organizationId, 'USER'),
        repository.addUserToOrg(userId, inviteId, organizationId, 'USER'),
      ]);

      expect(attempts.map((attempt) => attempt.status)).toEqual(['fulfilled', 'fulfilled']);
      expect(await prisma.userOrganization.count({ where: { userId, organizationId } })).toBe(1);
      await expect(
        repository.addUserToOrg(userId, inviteId, organizationId, 'USER'),
      ).resolves.toMatchObject({ userId, organizationId });
      expect(await prisma.userOrganization.count({ where: { userId, organizationId } })).toBe(1);
    } finally {
      await prisma.organization.delete({ where: { id: organizationId } }).catch(() => undefined);
      await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
      await prisma.appRole.delete({ where: { id: roleId } }).catch(() => undefined);
      await prisma.$disconnect();
    }
  });
});
