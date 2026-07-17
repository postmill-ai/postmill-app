import { describe, it, expect, vi } from 'vitest';
import { AiDesignerAssetService } from './ai-designer-asset.service';

const ORG_ID = 'org-1';

const makeService = () => {
  const aiDefaults = {
    textToImage: vi.fn().mockResolvedValue('https://example.com/img.png'),
  };
  const fileService = {
    importFromUrl: vi.fn().mockResolvedValue({ id: 'file-1', path: '/file-1.png' }),
    saveGeneratedMedia: vi.fn().mockResolvedValue({ id: 'file-1', path: '/file-1.png' }),
  };
  const storageService = {
    getLocalAdapterForOrg: vi.fn().mockResolvedValue({
      writeBuffer: vi.fn().mockResolvedValue('/fallback.png'),
    }),
  };
  const stockMedia = {
    searchPhotos: vi.fn().mockResolvedValue({ results: [] }),
  };

  return {
    service: new AiDesignerAssetService(
      aiDefaults as any,
      fileService as any,
      storageService as any,
      stockMedia as any
    ),
    aiDefaults,
    fileService,
  };
};

const makeContext = (overrides: { orgId?: string; rawInput?: string } = {}) => ({
  raw_input: overrides.rawInput ?? JSON.stringify({
    type: 'asset-request',
    assetNeeds: [
      { slotId: 's1', brief: 'a blue gradient', prefer: 'generate' as const },
    ],
  }),
  metadata: { orgId: overrides.orgId ?? ORG_ID },
} as any);

describe('AiDesignerAssetService', () => {
  it('reads orgId from context metadata', async () => {
    const { service, aiDefaults } = makeService();

    await (service as any)._handler(makeContext());

    expect(aiDefaults.textToImage).toHaveBeenCalledWith(ORG_ID, expect.any(String));
  });

  it('returns an error envelope when metadata orgId is missing', async () => {
    const { service, aiDefaults } = makeService();

    const response = await (service as any)._handler(makeContext({ orgId: '' }));

    const parsed = JSON.parse(response.content);
    expect(parsed.type).toBe('error');
    expect(parsed.message).toMatch(/missing orgId/i);
    expect(aiDefaults.textToImage).not.toHaveBeenCalled();
  });

  it('clamps assetNeeds to MAX_ASSET_NEEDS = 8', async () => {
    const { service, aiDefaults } = makeService();

    const needs = Array.from({ length: 12 }, (_, i) => ({
      slotId: `slot-${i}`,
      brief: `brief ${i}`,
      prefer: 'generate' as const,
    }));

    const response = await (service as any)._handler(makeContext({
      rawInput: JSON.stringify({ type: 'asset-request', assetNeeds: needs }),
    }));

    const parsed = JSON.parse(response.content);
    expect(Object.keys(parsed.assets).length).toBe(8);
    expect(aiDefaults.textToImage).toHaveBeenCalledTimes(8);
  });
});
