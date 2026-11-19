import { inject } from 'vitest';
import { getTestPrisma } from '@postmill-ai/nestjs-libraries/testing/test-db';
import { PrismaRepository, PrismaService } from '@postmill-ai/nestjs-libraries/database/prisma/prisma.service';
import { DesignRepository } from './design.repository';

const makeRepository = (prisma: ReturnType<typeof getTestPrisma>) => new DesignRepository(
  new PrismaRepository<'design'>(prisma as unknown as PrismaService),
  new PrismaRepository<'designTemplate'>(prisma as unknown as PrismaService),
  new PrismaRepository<'designTemplateFolder'>(prisma as unknown as PrismaService),
  new PrismaRepository<'designVersion'>(prisma as unknown as PrismaService),
  new PrismaRepository<'file'>(prisma as unknown as PrismaService),
  new PrismaRepository<'designerRecentOpen'>(prisma as unknown as PrismaService),
);

describe('DesignRepository gallery queries (integration)', () => {
  it('sorts recent targets across pages per user/org and applies search/folder/category filters', async () => {
    const prisma = getTestPrisma(inject('dbUrl'));
    const repository = makeRepository(prisma);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const ids = {
      org1: `gallery-org-1-${suffix}`,
      org2: `gallery-org-2-${suffix}`,
      user1: `gallery-user-1-${suffix}`,
      user2: `gallery-user-2-${suffix}`,
      oldDesign: `gallery-old-${suffix}`,
      systemTemplate: `gallery-system-${suffix}`,
      categoryTemplate: `gallery-category-${suffix}`,
    };
    try {
      await prisma.organization.createMany({ data: [{ id: ids.org1, name: 'Gallery 1' }, { id: ids.org2, name: 'Gallery 2' }] });
      await prisma.user.createMany({ data: [
        { id: ids.user1, email: `${suffix}-1@example.test`, providerName: 'LOCAL' },
        { id: ids.user2, email: `${suffix}-2@example.test`, providerName: 'LOCAL' },
      ] });
      await prisma.design.createMany({ data: [
        ...Array.from({ length: 25 }, (_, index) => ({
          organizationId: ids.org1,
          createdById: ids.user1,
          name: `Design ${String(index).padStart(2, '0')}`,
          doc: { mode: 'image' },
          createdAt: new Date('2026-02-01T00:00:00.000Z'),
        })),
        {
          id: ids.oldDesign, organizationId: ids.org1, createdById: ids.user1,
          name: 'R&D oldest', doc: { mode: 'image' }, createdAt: new Date('2020-01-01T00:00:00.000Z'),
        },
      ] });
      await prisma.designTemplate.createMany({ data: [
        ...Array.from({ length: 25 }, (_, index) => ({
          organizationId: ids.org1, name: `Template ${String(index).padStart(2, '0')}`, category: 'Social', doc: { mode: 'image' },
        })),
        { id: ids.systemTemplate, name: 'System oldest', category: 'Social', doc: { mode: 'image' }, isSystem: true, createdAt: new Date('2020-01-01T00:00:00.000Z') },
        { id: ids.categoryTemplate, organizationId: ids.org1, name: 'Feed', category: 'instagram-post', doc: { mode: 'image' } },
      ] });

      await repository.markDesignOpened(ids.org1, ids.user1, ids.oldDesign);
      await repository.markDesignOpened(ids.org1, ids.user1, ids.oldDesign);
      const recentDesigns = await repository.findByOrg(ids.org1, 1, 24, { sort: 'recent', userId: ids.user1 });
      expect(recentDesigns[0].id).toBe(ids.oldDesign);
      const otherUserDesigns = await repository.findByOrg(ids.org1, 1, 24, { sort: 'recent', userId: ids.user2 });
      expect(otherUserDesigns.some((design) => design.id === ids.oldDesign)).toBe(false);
      expect(await prisma.designerRecentOpen.count({ where: { organizationId: ids.org1, userId: ids.user1, designId: ids.oldDesign } })).toBe(1);
      expect(await repository.countByOrg(ids.org1, 'R&D')).toBe(1);
      expect((await repository.findByOrg(ids.org1, 1, 24, { query: 'R&D' }))[0].id).toBe(ids.oldDesign);

      await repository.markTemplateOpened(ids.org1, ids.user1, ids.systemTemplate);
      await repository.markTemplateOpened(ids.org1, ids.user1, ids.systemTemplate);
      await repository.markTemplateOpened(ids.org2, ids.user1, ids.systemTemplate);
      const recentTemplates = await repository.findTemplatesByOrg(ids.org1, 1, 24, undefined, undefined, { sort: 'recent', userId: ids.user1 });
      expect(recentTemplates[0].id).toBe(ids.systemTemplate);
      const otherUserTemplates = await repository.findTemplatesByOrg(ids.org1, 1, 24, undefined, undefined, { sort: 'recent', userId: ids.user2 });
      expect(otherUserTemplates.some((template) => template.id === ids.systemTemplate)).toBe(false);
      expect(await prisma.designerRecentOpen.count({ where: { templateId: ids.systemTemplate } })).toBe(2);

      const noFolderCategory = await repository.findTemplatesByOrg(ids.org1, 1, 24, undefined, undefined, { folderId: null, category: 'ig-post' });
      expect(noFolderCategory.map((template) => template.id)).toEqual([ids.categoryTemplate]);
      const canonicalSearch = await repository.findTemplatesByOrg(ids.org1, 1, 24, undefined, undefined, { query: 'IG Post' });
      expect(canonicalSearch.map((template) => template.id)).toEqual([ids.categoryTemplate]);
      expect(await repository.countTemplatesByOrg(ids.org1, undefined, { query: 'IG Post' })).toBe(1);
    } finally {
      await prisma.designerRecentOpen.deleteMany({ where: { organizationId: { in: [ids.org1, ids.org2] } } });
      await prisma.design.deleteMany({ where: { organizationId: ids.org1 } });
      await prisma.designTemplate.deleteMany({ where: { organizationId: ids.org1 } });
      await prisma.designTemplate.deleteMany({ where: { id: ids.systemTemplate } });
      await prisma.user.deleteMany({ where: { id: { in: [ids.user1, ids.user2] } } });
      await prisma.organization.deleteMany({ where: { id: { in: [ids.org1, ids.org2] } } });
      await prisma.$disconnect();
    }
  });
});
