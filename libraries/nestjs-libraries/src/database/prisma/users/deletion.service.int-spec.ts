import { inject } from 'vitest';
import { getTestPrisma } from '@postmill-ai/nestjs-libraries/testing/test-db';
import { PrismaService } from '@postmill-ai/nestjs-libraries/database/prisma/prisma.service';
import { DeletionService } from './deletion.service';

describe('DeletionService.deleteUser (integration)', () => {
  it('deletes a member whose DesignVersion/FederationGrant rows sit in a shared org', async () => {
    const prisma = getTestPrisma(inject('dbUrl'));
    const service = new DeletionService(prisma as unknown as PrismaService, {
      create: async () => ({}),
    } as any);
    let orgId: string | undefined;
    try {
      const owner = await prisma.user.create({
        data: { email: 'owner@deletion.int', providerName: 'LOCAL' },
      });
      const member = await prisma.user.create({
        data: { email: 'member@deletion.int', providerName: 'LOCAL' },
      });
      const org = await prisma.organization.create({ data: { name: 'Shared' } });
      orgId = org.id;
      await prisma.userOrganization.createMany({
        data: [
          { userId: owner.id, organizationId: org.id },
          { userId: member.id, organizationId: org.id },
        ],
      });
      // The OWNER's design; the MEMBER saved a version of it (SetNull FK to member).
      const design = await prisma.design.create({
        data: { organizationId: org.id, name: 'Teammate design', doc: {}, createdById: owner.id },
      });
      const version = await prisma.designVersion.create({
        data: { designId: design.id, organizationId: org.id, doc: {}, createdById: member.id },
      });
      await prisma.federationGrant.create({
        data: { userId: member.id, organizationId: org.id, redirectUri: 'https://rp.example/cb' },
      });

      await expect(service.deleteUser(member.id)).resolves.toEqual({ id: member.id });

      expect(await prisma.user.findUnique({ where: { id: member.id } })).toBeNull();
      // The version the member saved on the TEAMMATE's design is preserved,
      // anonymized to createdById = null via the SetNull FK.
      const saved = await prisma.designVersion.findUnique({ where: { id: version.id } });
      expect(saved).not.toBeNull();
      expect(saved!.createdById).toBeNull();
      expect(await prisma.federationGrant.count({ where: { userId: member.id } })).toBe(0);
      // Shared org and the teammate's design survive.
      expect(await prisma.organization.findUnique({ where: { id: org.id } })).not.toBeNull();
      expect(await prisma.design.findUnique({ where: { id: design.id } })).not.toBeNull();
      expect(await prisma.user.findUnique({ where: { id: owner.id } })).not.toBeNull();
    } finally {
      // The per-run DB is shared across int specs (test-db.int-spec asserts 0 users).
      const emails = ['owner@deletion.int', 'member@deletion.int'];
      const users = { user: { email: { in: emails } } };
      // The saved version's createdById is null by now — scope by design, not creator.
      await prisma.designVersion.deleteMany({ where: { design: { createdBy: { email: { in: emails } } } } });
      await prisma.design.deleteMany({ where: { createdBy: { email: { in: emails } } } });
      await prisma.federationGrant.deleteMany({ where: users });
      await prisma.userOrganization.deleteMany({ where: users });
      await prisma.organization.deleteMany({ where: { id: orgId ?? '__none__' } });
      await prisma.user.deleteMany({ where: { email: { in: emails } } });
      await prisma.$disconnect();
    }
  });
});
