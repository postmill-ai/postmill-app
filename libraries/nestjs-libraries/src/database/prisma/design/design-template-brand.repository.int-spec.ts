import { inject } from 'vitest';
import { getTestPrisma } from '@postmill-ai/nestjs-libraries/testing/test-db';
import { PrismaRepository, PrismaService } from '@postmill-ai/nestjs-libraries/database/prisma/prisma.service';
import { DesignRepository } from './design.repository';

describe('DesignRepository Brand Kit template ordering (integration)', () => {
  it('prioritizes a brand in SQL before pagination and filters org scope in list and count', async () => {
    const prisma = getTestPrisma(inject('dbUrl'));
    const repository = new DesignRepository(
      new PrismaRepository<'design'>(prisma as unknown as PrismaService),
      new PrismaRepository<'designTemplate'>(prisma as unknown as PrismaService),
      new PrismaRepository<'designTemplateFolder'>(prisma as unknown as PrismaService),
      new PrismaRepository<'designVersion'>(prisma as unknown as PrismaService),
      new PrismaRepository<'file'>(prisma as unknown as PrismaService),
      new PrismaRepository<'designerRecentOpen'>(prisma as unknown as PrismaService),
    );
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const organizationId = `template-org-${suffix}`;
    const brandId = `template-brand-${suffix}`;
    const brandTemplateId = `template-brand-row-${suffix}`;
    const systemTemplateId = `template-system-row-${suffix}`;
    try {
      await prisma.organization.create({ data: { id: organizationId, name: 'Template test org' } });
      await prisma.aIBrandProfile.create({ data: { id: brandId, organizationId, name: 'Brand' } });
      await prisma.designTemplate.createMany({
        data: [
          ...Array.from({ length: 25 }, (_, index) => ({
            organizationId,
            name: `Ordinary ${String(index).padStart(2, '0')}`,
            category: 'test',
            doc: { mode: 'image' },
          })),
          { id: systemTemplateId, name: 'System', category: 'test', doc: { mode: 'image' }, isSystem: true },
          { id: brandTemplateId, organizationId, brandProfileId: brandId, name: 'Zzz last', category: 'Launch Collection', doc: { mode: 'image' } },
        ],
      });

      const pageOne = await repository.findTemplatesByOrg(organizationId, 1, 24, brandId);
      expect(pageOne).toHaveLength(24);
      expect(pageOne[0].id).toBe(brandTemplateId);
      expect(pageOne[1].id).toBe(systemTemplateId);
      const pageTwo = await repository.findTemplatesByOrg(organizationId, 2, 24, brandId);
      expect(pageTwo).toHaveLength(3);
      expect(pageTwo.some((template) => template.id === brandTemplateId)).toBe(false);

      const orgOnly = await repository.findTemplatesByOrg(organizationId, 1, 100, brandId, 'org');
      expect(orgOnly).toHaveLength(26);
      expect(orgOnly[0].id).toBe(brandTemplateId);
      expect(orgOnly.some((template) => template.id === systemTemplateId)).toBe(false);
      expect(await repository.countTemplatesByOrg(organizationId)).toBe(27);
      expect(await repository.countTemplatesByOrg(organizationId, 'org')).toBe(26);

      const brandSearch = await repository.findTemplatesByOrg(organizationId, 1, 24, brandId, 'org', 'launch col');
      expect(brandSearch.map((template) => template.id)).toEqual([brandTemplateId]);
      expect(await repository.countTemplatesByOrg(organizationId, 'org', 'launch col')).toBe(1);

      const ordinarySearch = await repository.findTemplatesByOrg(organizationId, 1, 24, undefined, 'org', 'ordinary 2');
      expect(ordinarySearch).toHaveLength(5);
      expect(ordinarySearch.every((template) => template.name.toLowerCase().includes('ordinary 2'))).toBe(true);
      expect(await repository.countTemplatesByOrg(organizationId, 'org', 'ordinary 2')).toBe(5);
      expect(await repository.findTemplatesByOrg(organizationId, 1, 24, brandId, 'org', 'no match')).toEqual([]);
    } finally {
      await prisma.designTemplate.deleteMany({ where: { organizationId } });
      await prisma.designTemplate.deleteMany({ where: { id: systemTemplateId } });
      await prisma.organization.delete({ where: { id: organizationId } }).catch(() => undefined);
      await prisma.$disconnect();
    }
  });
});
