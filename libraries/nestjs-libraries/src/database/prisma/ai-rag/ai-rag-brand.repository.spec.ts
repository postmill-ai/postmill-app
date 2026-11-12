import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AiRagRepository } from './ai-rag.repository';

vi.mock('@postmill-ai/nestjs-libraries/database/prisma/prisma.service', () => ({
  PrismaRepository: vi.fn(function() { return { model: {} }; }),
}));

const model: any = {
  aIContentIndex: {
    findMany: vi.fn().mockResolvedValue([]),
    deleteMany: vi.fn(),
    create: vi.fn(),
  },
  $queryRawUnsafe: vi.fn().mockResolvedValue([]),
  $executeRawUnsafe: vi.fn(),
  $transaction: vi.fn(async (fn: any) => fn(model)),
};
const repository = new AiRagRepository({ model } as any);

describe('AiRagRepository Brand Kit filters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    model.aIContentIndex.create.mockImplementation(({ data }: any) => ({ id: 'chunk-1', ...data }));
  });

  it('filters BM25 rows by org and brand', async () => {
    await repository.findChunksForBm25('org-1', 'brand-1');
    expect(model.aIContentIndex.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', brandProfileId: 'brand-1', chunk: { not: null } },
      select: { id: true, chunk: true, sourceType: true, sourceId: true },
      take: 500,
    });
  });

  it('parameterizes the brand in vector and text searches', async () => {
    await repository.vectorSearch('org-1', '[0.1]', 5, 'brand-1');
    expect(model.$queryRawUnsafe.mock.calls[0][0]).toContain('ci."brandProfileId" = $4');
    expect(model.$queryRawUnsafe.mock.calls[0].slice(1)).toEqual(['[0.1]', 'org-1', 5, 'brand-1']);

    await repository.textSearchTerms('org-1', ['fact'], 5, 'brand-1');
    expect(model.$queryRawUnsafe.mock.calls[1][0]).toContain('ci."brandProfileId" = $4');
    expect(model.$queryRawUnsafe.mock.calls[1].slice(1)).toEqual(['fact', 'org-1', 5, 'brand-1']);
  });

  it('stores the brand on replacement chunks and scopes deletion', async () => {
    await repository.replaceSourceChunks({
      organizationId: 'org-1', sourceType: 'text', sourceId: 'source-1', contentHash: 'hash',
      chunks: ['Fact'], embeddings: [], pgvectorAvailable: false, brandProfileId: 'brand-1',
      formatVector: (values) => values.join(','),
    });
    expect(model.aIContentIndex.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ brandProfileId: 'brand-1' }),
    });
    await repository.deleteContentIndexEntries('org-1', 'text', 'source-1', 'brand-1');
    expect(model.aIContentIndex.deleteMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', sourceType: 'text', sourceId: 'source-1', brandProfileId: 'brand-1' },
    });
  });

  it('isolates legacy unassigned rows for listing and deletion', async () => {
    await repository.getOrgContentIndexEntries('org-1', undefined, true);
    expect(model.aIContentIndex.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: 'org-1', brandProfileId: null },
    }));
    await repository.deleteContentIndexEntries('org-1', 'text', 'legacy-1', undefined, true);
    expect(model.aIContentIndex.deleteMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', sourceType: 'text', sourceId: 'legacy-1', brandProfileId: null },
    });
  });
});
