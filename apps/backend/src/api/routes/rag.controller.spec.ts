import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { RagController } from './rag.controller';
import { REQUIRE_PERMISSION_KEY } from '@postmill-ai/backend/services/auth/rbac/require-permission.decorator';

const ragService = {
  getStatus: vi.fn(),
  indexContent: vi.fn(),
  getItems: vi.fn(),
  deleteItem: vi.fn(),
  search: vi.fn(),
  backfill: vi.fn(),
  setOrgRagEnabled: vi.fn(),
  testConnection: vi.fn(),
};
const controller = new RagController(
  ragService as any,
  { getSettings: vi.fn().mockResolvedValue({}) } as any,
  { upsertSystemSettings: vi.fn() } as any,
);
const org = { id: 'org-1' } as any;
const user = { id: 'user-1' } as any;

describe('RagController Brand Kit contract', () => {
  it('gates brand reads/writes and deployment settings separately', () => {
    expect(Reflect.getMetadata(REQUIRE_PERMISSION_KEY, controller.indexContent)).toEqual({ resource: 'brands', action: 'update' });
    expect(Reflect.getMetadata(REQUIRE_PERMISSION_KEY, controller.search)).toEqual({ resource: 'brands', action: 'read' });
    expect(Reflect.getMetadata(REQUIRE_PERMISSION_KEY, controller.setEnabled)).toEqual({ resource: 'brands', action: 'update' });
    expect(Reflect.getMetadata(REQUIRE_PERMISSION_KEY, controller.saveSettings)).toEqual({ resource: 'ai-config', action: 'update' });
    expect(Reflect.getMetadata(REQUIRE_PERMISSION_KEY, controller.testConnection)).toEqual({ resource: 'ai-config', action: 'update' });
  });

  it('passes the selected brand through indexing and search', async () => {
    await controller.indexContent(org, user, { sourceType: 'text', sourceId: 'source-1', content: 'Fact', brandId: 'brand-1' });
    expect(ragService.indexContent).toHaveBeenCalledWith({
      organizationId: 'org-1', sourceType: 'text', sourceId: 'source-1', content: 'Fact', brandProfileId: 'brand-1',
    });
    await controller.search(org, { query: 'Fact', brandId: 'brand-1' });
    expect(ragService.search).toHaveBeenCalledWith({ organizationId: 'org-1', query: 'Fact', limit: 10, brandProfileId: 'brand-1' });
    await controller.triggerBackfill(org, user, { brandId: 'brand-1' });
    expect(ragService.backfill).toHaveBeenCalledWith('org-1', 'user-1', 'brand-1');
  });

  it('preserves a disabled Knowledge response as a client error', async () => {
    ragService.indexContent.mockRejectedValueOnce(new BadRequestException('RAG is not enabled for this organization'));
    await expect(controller.indexContent(org, user, { sourceType: 'text', content: 'Fact' }))
      .rejects.toMatchObject({ status: 400 });
  });

  it('persists false as false, not inherit', async () => {
    await controller.setEnabled(org, { enabled: false });
    expect(ragService.setOrgRagEnabled).toHaveBeenCalledWith('org-1', false);
  });
});
