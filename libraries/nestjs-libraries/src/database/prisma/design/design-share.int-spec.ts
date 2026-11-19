import { inject } from 'vitest';
import { getTestPrisma } from '@postmill-ai/nestjs-libraries/testing/test-db';
import { PrismaRepository, PrismaService } from '@postmill-ai/nestjs-libraries/database/prisma/prisma.service';
import { DesignShareRepository } from './design-share.repository';

describe('DesignShareRepository (integration)', () => {
  it('persists feedback and approval while enforcing token, expiry, disable, and soft-delete resolution', async () => {
    const prisma = getTestPrisma(inject('dbUrl'));
    const repository = new DesignShareRepository(
      new PrismaRepository<'design'>(prisma as unknown as PrismaService),
      new PrismaRepository<'designShare'>(prisma as unknown as PrismaService),
      new PrismaRepository<'designShareComment'>(prisma as unknown as PrismaService),
    );
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const organizationId = `share-org-${suffix}`;
    const userId = `share-user-${suffix}`;
    const designId = `share-design-${suffix}`;
    const token = `share-token-${suffix}`;
    try {
      await prisma.organization.create({ data: { id: organizationId, name: 'Share test org' } });
      await prisma.user.create({
        data: { id: userId, email: `${suffix}@example.test`, providerName: 'LOCAL' },
      });
      await prisma.design.create({
        data: {
          id: designId,
          organizationId,
          createdById: userId,
          name: 'Shared design',
          doc: { mode: 'image', outputs: [] },
        },
      });
      const saved = await repository.saveShare(organizationId, designId, {
        token,
        enabled: true,
        commentsEnabled: true,
        expiresAt: new Date(Date.now() + 86400000),
      });
      await repository.createComment({
        shareId: saved.id,
        organizationId,
        authorName: 'Client',
        content: 'Feedback',
      });

      const active = await repository.findActiveByToken(token, new Date());
      expect(active).not.toBeNull();
      expect(active!.comments).toHaveLength(1);
      expect(active!.design.id).toBe(designId);

      const approvedAt = new Date();
      await repository.approveFirst(organizationId, saved.id, 'First', approvedAt);
      const second = await repository.approveFirst(organizationId, saved.id, 'Second', new Date());
      expect(second).not.toBeNull();
      expect(second!.approvedBy).toBe('First');
      expect(second!.approvedAt).toEqual(approvedAt);

      await repository.disableShare(organizationId, designId);
      expect(await repository.findActiveByToken(token, new Date())).toBeNull();
      await repository.saveShare(organizationId, designId, {
        token: 'replacement-must-not-win',
        enabled: true,
        commentsEnabled: false,
        expiresAt: new Date(Date.now() + 86400000),
      });
      expect((await repository.findActiveByToken(token, new Date()))?.token).toBe(token);

      await prisma.designShare.update({ where: { id: saved.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      expect(await repository.findActiveByToken(token, new Date())).toBeNull();
      await prisma.designShare.update({ where: { id: saved.id }, data: { expiresAt: new Date(Date.now() + 86400000) } });
      await prisma.design.update({ where: { id: designId }, data: { deletedAt: new Date() } });
      expect(await repository.findActiveByToken(token, new Date())).toBeNull();
    } finally {
      await prisma.organization.delete({ where: { id: organizationId } }).catch(() => undefined);
      await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
      await prisma.$disconnect();
    }
  });
});
