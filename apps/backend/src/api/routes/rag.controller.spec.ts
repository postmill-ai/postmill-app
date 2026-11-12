import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { RagController } from './rag.controller';
import { REQUIRE_PERMISSION_KEY } from '@postmill-ai/backend/services/auth/rbac/require-permission.decorator';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { SuperAdminGuard } from '@postmill-ai/backend/services/auth/rbac/super-admin.guard';

const ragService = {
  getStatus: vi.fn(),
  indexContent: vi.fn(),
  getItems: vi.fn(),
  deleteItem: vi.fn(),
  search: vi.fn(),
  backfill: vi.fn(),
  setOrgRagEnabled: vi.fn(),
  testConnection: vi.fn(),
  refreshSettings: vi.fn(),
};
const settingsManager = {
  getSettings: vi.fn().mockResolvedValue({ ragSettings: { enabled: true } }),
  refreshCache: vi.fn(),
};
const settingsService = { upsertSystemSettings: vi.fn() };
const controller = new RagController(
  ragService as any,
  settingsManager as any,
  settingsService as any,
);
const org = { id: 'org-1' } as any;
const user = { id: 'user-1' } as any;
const superAdmin = { id: 'root', isSuperAdmin: true } as any;

describe('RagController Brand Kit contract', () => {
  it('gates brand reads/writes and deployment settings separately', () => {
    expect(Reflect.getMetadata(REQUIRE_PERMISSION_KEY, controller.indexContent)).toEqual({ resource: 'brands', action: 'update' });
    expect(Reflect.getMetadata(REQUIRE_PERMISSION_KEY, controller.search)).toEqual({ resource: 'brands', action: 'read' });
    expect(Reflect.getMetadata(REQUIRE_PERMISSION_KEY, controller.setEnabled)).toEqual({ resource: 'ai-config', action: 'update' });
    for (const handler of [controller.getSettings, controller.saveSettings, controller.testConnection]) {
      expect(Reflect.getMetadata(REQUIRE_PERMISSION_KEY, handler)).toEqual({ resource: 'ai-config', action: 'update' });
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toContain(SuperAdminGuard);
    }
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

  it('passes the explicit legacy scope through list and delete', async () => {
    await controller.listItems(org, '0', '20', undefined, undefined, 'unassigned');
    expect(ragService.getItems).toHaveBeenCalledWith('org-1', expect.objectContaining({ unassigned: true }));
    await controller.deleteItem(org, 'text', 'legacy-1', undefined, 'unassigned');
    expect(ragService.deleteItem).toHaveBeenCalledWith('org-1', 'text', 'legacy-1', undefined, true);
  });

  it('rejects platform settings for an org admin and allows a super-admin', async () => {
    await expect(controller.saveSettings(user, { enabled: true })).rejects.toMatchObject({ status: 403 });
    expect(settingsService.upsertSystemSettings).not.toHaveBeenCalled();
    await controller.saveSettings(superAdmin, { enabled: true });
    expect(settingsService.upsertSystemSettings).toHaveBeenCalledWith(expect.objectContaining({
      ragSettings: expect.objectContaining({ enabled: true }),
    }));
    expect(ragService.refreshSettings).toHaveBeenCalled();
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
