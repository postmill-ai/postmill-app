import { describe, it, expect, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { CampaignTagService } from './campaign-item.service';

function makeService(overrides: any = {}) {
  const items = {
    tag: vi.fn().mockResolvedValue({}),
    setPostCampaign: vi.fn().mockResolvedValue({}),
    copyAllToCampaign: vi.fn().mockResolvedValue(0),
    deleteExpired: vi.fn().mockResolvedValue({ count: 0 }),
    ...overrides.items,
  };
  const resolver = {
    resolveBatch: vi.fn().mockResolvedValue(new Map()),
    ...overrides.resolver,
  };
  const campaigns = {
    findById: vi.fn().mockResolvedValue({ id: 'c1', organizationId: 'org1', name: 'Launch' }),
    ...overrides.campaigns,
  };
  const audit = { create: vi.fn().mockResolvedValue({}) };

  const service = new CampaignTagService(
    items as any,
    resolver as any,
    campaigns as any,
    audit as any
  );
  return { service, items, resolver, campaigns, audit };
}

describe('CampaignTagService.tagItem', () => {
  it('rejects a foreign non-POST entityId (resolver empty) and does not upsert', async () => {
    const { service, items, resolver } = makeService({
      resolver: { resolveBatch: vi.fn().mockResolvedValue(new Map()) },
    });

    await expect(
      service.tagItem('org1', 'c1', 'u1', 'channel', 'foreign-int')
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(resolver.resolveBatch).toHaveBeenCalledWith('org1', 'INTEGRATION', ['foreign-int']);
    expect(items.tag).not.toHaveBeenCalled();
  });

  it('upserts a valid, org-owned non-POST entity', async () => {
    const { service, items } = makeService({
      resolver: {
        resolveBatch: vi
          .fn()
          .mockResolvedValue(new Map([['int1', { id: 'int1', name: 'YouTube' }]])),
      },
    });

    const res = await service.tagItem('org1', 'c1', 'u1', 'channel', 'int1');

    expect(res).toEqual({ success: true });
    expect(items.tag).toHaveBeenCalledWith({
      campaignId: 'c1',
      organizationId: 'org1',
      entityType: 'INTEGRATION',
      entityId: 'int1',
      createdById: 'u1',
    });
  });

  it('keeps the POST scoping path (no resolver gate)', async () => {
    const { service, items, resolver } = makeService();

    await service.tagItem('org1', 'c1', 'u1', 'post', 'p1');

    expect(items.setPostCampaign).toHaveBeenCalledWith('org1', 'p1', 'c1');
    expect(items.tag).not.toHaveBeenCalled();
    // POST resolves its name via the fixed 'a post' short-circuit, never the resolver.
    expect(resolver.resolveBatch).not.toHaveBeenCalled();
  });

  describe('purgeExpiredItems', () => {
    it('delegates to the repository and returns the deleted count', async () => {
      const { service, items } = makeService({
        items: { deleteExpired: vi.fn().mockResolvedValue({ count: 5 }) },
      });

      const result = await service.purgeExpiredItems(30);

      expect(items.deleteExpired).toHaveBeenCalledWith(30, expect.any(Date));
      expect(result).toEqual({ deleted: 5 });
    });
  });
});


describe('CampaignTagService.copyTags', () => {
  it('verifies target campaign ownership before copying', async () => {
    const { service, items, campaigns } = makeService({
      campaigns: {
        findById: vi.fn().mockImplementation((id: string) =>
          id === 'target' ? { id: 'target', organizationId: 'org1', name: 'Target' } : null
        ),
      },
    });

    const result = await service.copyTags('org1', 'source', 'target', 'u1');

    expect(campaigns.findById).toHaveBeenCalledWith('target', 'org1');
    expect(items.copyAllToCampaign).toHaveBeenCalledWith('source', 'target', 'org1', 'u1');
    expect(result).toBe(0);
  });

  it('rejects copying to a campaign owned by another org', async () => {
    const { service, items } = makeService({
      campaigns: {
        findById: vi.fn().mockResolvedValue(null),
      },
    });

    await expect(service.copyTags('org1', 'source', 'foreign-target', 'u1')).rejects.toBeInstanceOf(
      NotFoundException
    );
    expect(items.copyAllToCampaign).not.toHaveBeenCalled();
  });
});
