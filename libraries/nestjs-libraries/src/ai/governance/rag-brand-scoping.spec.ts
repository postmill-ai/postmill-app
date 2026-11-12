import { describe, expect, it, vi, beforeEach } from 'vitest';
import { RagService } from './rag.service';

const redis = vi.hoisted(() => {
  const value: any = { lpush: vi.fn().mockResolvedValue(1) };
  value.duplicate = vi.fn(() => value);
  return value;
});
vi.mock('@postmill-ai/nestjs-libraries/redis/redis.service', () => ({ ioRedis: redis }));

const repository = {
  getOrgRagEnabled: vi.fn(),
  setOrgRagEnabled: vi.fn(),
  getOrgContentIndexEntries: vi.fn(),
  findContentHash: vi.fn(),
  replaceSourceChunks: vi.fn(),
  ensurePgvectorTable: vi.fn(),
  textSearchTerms: vi.fn(),
  textSearchRecent: vi.fn(),
  vectorSearch: vi.fn(),
  findChunksForBm25: vi.fn(),
  deleteContentIndexEntries: vi.fn(),
};
const brands = { getBrandStrict: vi.fn() };
const settingsManager = { getSettings: vi.fn() };
const modelProvider = {
  embeddingModel: vi.fn().mockResolvedValue(null),
  resolveConfigForScope: vi.fn().mockResolvedValue({ providerId: 'openai', modelId: 'embed' }),
};

const createService = () => new RagService(
  {} as any,
  repository as any,
  modelProvider as any,
  settingsManager as any,
  {} as any,
  { recordSpend: vi.fn(), checkBudget: vi.fn() } as any,
  { get: vi.fn().mockResolvedValue(null) } as any,
  brands as any,
);

describe('RAG organization and Brand Kit scoping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repository.getOrgRagEnabled.mockResolvedValue(null);
    repository.getOrgContentIndexEntries.mockResolvedValue([]);
    repository.findContentHash.mockResolvedValue(null);
    repository.ensurePgvectorTable.mockRejectedValue(new Error('no vector'));
    repository.textSearchTerms.mockResolvedValue([]);
    repository.textSearchRecent.mockResolvedValue([]);
    repository.vectorSearch.mockResolvedValue([]);
    repository.findChunksForBm25.mockResolvedValue([]);
    brands.getBrandStrict.mockResolvedValue({ id: 'brand-1', enabled: true });
    settingsManager.getSettings.mockResolvedValue({ ragSettings: { enabled: false } });
  });

  it('allows an org override to enable Knowledge without changing the global default', async () => {
    repository.getOrgRagEnabled.mockResolvedValue({ ragEnabled: true });
    await createService().indexContent({
      organizationId: 'org-1', sourceType: 'text', sourceId: 'source-1', content: 'Brand fact', brandProfileId: 'brand-1',
    });
    expect(brands.getBrandStrict).toHaveBeenCalledWith('org-1', 'brand-1');
    const queued = JSON.parse(redis.lpush.mock.calls[0][1]);
    expect(queued.brandProfileId).toBe('brand-1');
    expect(settingsManager.getSettings).toHaveBeenCalledTimes(1);
  });

  it('allows an org override to disable an otherwise globally enabled feature', async () => {
    repository.getOrgRagEnabled.mockResolvedValue({ ragEnabled: false });
    settingsManager.getSettings.mockResolvedValue({ ragSettings: { enabled: true } });
    await expect(createService().indexContent({
      organizationId: 'org-1', sourceType: 'text', sourceId: 'source-1', content: 'Brand fact',
    })).rejects.toMatchObject({ status: 400 });
  });

  it('scopes search and status to the requested Brand Kit', async () => {
    repository.getOrgRagEnabled.mockResolvedValue({ ragEnabled: true });
    repository.getOrgContentIndexEntries.mockResolvedValue([
      { sourceType: 'text', sourceId: 'source-1', brandProfileId: 'brand-1', chunk: 'A', createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-02') },
    ]);
    const service = createService();
    await service.search({ organizationId: 'org-1', query: 'brand fact', brandProfileId: 'brand-1', limit: 2 });
    expect(repository.textSearchTerms).toHaveBeenCalledWith('org-1', ['brand', 'fact'], 2, 'brand-1');
    await expect(service.getStatus('org-1', 'brand-1')).resolves.toMatchObject({ enabled: true, indexedItems: 1 });
  });

  it('keeps identical source ids independent across Brand Kits', async () => {
    repository.getOrgRagEnabled.mockResolvedValue({ ragEnabled: true });
    const service = createService();
    for (const brandProfileId of ['brand-1', 'brand-2']) {
      await service.indexContent({
        organizationId: 'org-1', sourceType: 'text', sourceId: 'shared', content: 'Brand fact', brandProfileId,
      });
    }
    const queued = redis.lpush.mock.calls.map((call) => JSON.parse(call[1]));
    expect(queued.map((item) => item.sourceId)).toEqual([
      'brand:brand-1:shared', 'brand:brand-2:shared',
    ]);
    expect(repository.findContentHash).toHaveBeenNthCalledWith(1, 'org-1', 'text', 'brand:brand-1:shared');
    expect(repository.findContentHash).toHaveBeenNthCalledWith(2, 'org-1', 'text', 'brand:brand-2:shared');
  });

  it('returns public source ids while searching, listing, and deleting scoped storage ids', async () => {
    repository.getOrgRagEnabled.mockResolvedValue({ ragEnabled: true });
    repository.textSearchTerms.mockResolvedValue([
      { text: 'Fact', sourceType: 'text', sourceId: 'brand:brand-1:shared', score: 1 },
    ]);
    repository.getOrgContentIndexEntries.mockResolvedValue([
      { sourceType: 'text', sourceId: 'brand:brand-1:shared', brandProfileId: 'brand-1', chunk: 'Fact', createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-02') },
    ]);
    const service = createService();
    await expect(service.search({ organizationId: 'org-1', query: 'fact', brandProfileId: 'brand-1' }))
      .resolves.toEqual([{ text: 'Fact', sourceType: 'text', sourceId: 'shared', score: 1 }]);
    await expect(service.getItems('org-1', { brandProfileId: 'brand-1' }))
      .resolves.toMatchObject({ items: [{ sourceId: 'shared' }] });
    await service.deleteItem('org-1', 'text', 'shared', 'brand-1');
    expect(repository.deleteContentIndexEntries).toHaveBeenCalledWith(
      'org-1', 'text', 'brand:brand-1:shared', 'brand-1',
    );
  });

  it('persists false as an org override rather than converting it to inherit', async () => {
    await createService().setOrgRagEnabled('org-1', false);
    expect(repository.setOrgRagEnabled).toHaveBeenCalledWith('org-1', false);
  });
});
