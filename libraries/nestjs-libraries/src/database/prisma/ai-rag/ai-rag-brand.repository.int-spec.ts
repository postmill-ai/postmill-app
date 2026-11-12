import { inject } from 'vitest';
import { getTestPrisma } from '@postmill-ai/nestjs-libraries/testing/test-db';
import { PrismaRepository, PrismaService } from '@postmill-ai/nestjs-libraries/database/prisma/prisma.service';
import { AiRagRepository } from './ai-rag.repository';

describe('AiRagRepository Brand Kit scoping (integration)', () => {
  it('keeps legacy rows and identical public source ids isolated across brands', async () => {
    const prisma = getTestPrisma(inject('dbUrl'));
    const repository = new AiRagRepository(
      new PrismaRepository<'aIContentIndex'>(prisma as unknown as PrismaService),
    );
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const organizationId = `rag-org-${suffix}`;
    const brandAId = `rag-brand-a-${suffix}`;
    const brandBId = `rag-brand-b-${suffix}`;
    try {
      await prisma.organization.create({ data: { id: organizationId, name: 'RAG test org' } });
      await prisma.aIBrandProfile.createMany({
        data: [
          { id: brandAId, organizationId, name: 'Brand A' },
          { id: brandBId, organizationId, name: 'Brand B' },
        ],
      });
      await prisma.aIContentIndex.createMany({
        data: [
          { organizationId, sourceType: 'text', sourceId: 'shared', contentHash: 'legacy', chunk: 'Legacy' },
          { organizationId, sourceType: 'text', sourceId: `brand:${brandAId}:shared`, brandProfileId: brandAId, contentHash: 'a', chunk: 'A' },
          { organizationId, sourceType: 'text', sourceId: `brand:${brandBId}:shared`, brandProfileId: brandBId, contentHash: 'b', chunk: 'B' },
        ],
      });

      expect(await repository.getOrgContentIndexEntries(organizationId, undefined, true))
        .toHaveLength(1);
      expect(await repository.getOrgContentIndexEntries(organizationId, brandAId))
        .toHaveLength(1);
      expect(await repository.getOrgContentIndexEntries(organizationId))
        .toHaveLength(3);

      await repository.deleteContentIndexEntries(organizationId, 'text', 'shared', undefined, true);
      expect(await repository.getOrgContentIndexEntries(organizationId)).toHaveLength(2);
      await repository.deleteContentIndexEntries(organizationId, 'text', `brand:${brandAId}:shared`, brandAId);
      const remaining = await repository.getOrgContentIndexEntries(organizationId);
      expect(remaining).toHaveLength(1);
      expect(remaining[0].brandProfileId).toBe(brandBId);
    } finally {
      await prisma.organization.delete({ where: { id: organizationId } }).catch(() => undefined);
      await prisma.$disconnect();
    }
  });
});
