import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';

import {
  ProvidersController,
  AdminProvidersController,
  FeaturedProviderDto,
} from './providers.controller';
import { SuperAdminGuard } from '@gitroom/backend/services/auth/rbac/super-admin.guard';

const GUARDS_METADATA = '__guards__';

const mockBuildCatalog = vi.fn();
const mockBuildHealth = vi.fn();
const mockFeaturedList = vi.fn();
const mockFeaturedUpsert = vi.fn();
const mockFeaturedReorder = vi.fn();
const mockFeaturedRemove = vi.fn();

vi.mock('@gitroom/nestjs-libraries/providers/provider-catalog.service', () => ({
  ProviderCatalogService: class {
    buildCatalog = mockBuildCatalog;
  },
}));

vi.mock('@gitroom/nestjs-libraries/providers/provider-health.service', () => ({
  ProviderHealthService: class {
    buildHealth = mockBuildHealth;
  },
}));

vi.mock(
  '@gitroom/nestjs-libraries/database/prisma/featured-providers/featured-provider.service',
  () => ({
    FeaturedProviderService: class {
      list = mockFeaturedList;
      upsert = mockFeaturedUpsert;
      reorder = mockFeaturedReorder;
      remove = mockFeaturedRemove;
    },
  }),
);

import { ProviderCatalogService } from '@gitroom/nestjs-libraries/providers/provider-catalog.service';
import { ProviderHealthService } from '@gitroom/nestjs-libraries/providers/provider-health.service';
import { FeaturedProviderService } from '@gitroom/nestjs-libraries/database/prisma/featured-providers/featured-provider.service';

const superAdmin = { id: 'a1', isSuperAdmin: true } as any;

function makeCatalogService() {
  return { buildCatalog: mockBuildCatalog } as unknown as ProviderCatalogService;
}

function makeHealthService() {
  return { buildHealth: mockBuildHealth } as unknown as ProviderHealthService;
}

function makeFeaturedService() {
  return {
    list: mockFeaturedList,
    upsert: mockFeaturedUpsert,
    reorder: mockFeaturedReorder,
    remove: mockFeaturedRemove,
  } as unknown as FeaturedProviderService;
}

describe('ProvidersController', () => {
  let controller: ProvidersController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new ProvidersController(makeCatalogService());
  });

  // PROVIDER_REMEDIATION 3.3: invalid ?domain= must fail closed with 400, not fall
  // open to the full cross-domain catalog.
  describe('catalog domain validation (3.3)', () => {
    it('throws BadRequestException for an unknown domain', async () => {
      await expect(controller.catalog('bogus')).rejects.toThrow(BadRequestException);
      expect(mockBuildCatalog).not.toHaveBeenCalled();
    });

    it('accepts a valid domain and scopes the catalog service call', async () => {
      mockBuildCatalog.mockResolvedValue([]);
      await controller.catalog('ai');
      expect(mockBuildCatalog).toHaveBeenCalledWith('ai');
    });

    it('accepts an omitted domain (full catalog)', async () => {
      mockBuildCatalog.mockResolvedValue([]);
      await controller.catalog(undefined);
      expect(mockBuildCatalog).toHaveBeenCalledWith(undefined);
    });
  });
});

describe('AdminProvidersController', () => {
  let controller: AdminProvidersController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new AdminProvidersController(
      makeHealthService(),
      makeFeaturedService(),
    );
  });

  // PROVIDER_REMEDIATION 4.6: health is kernel-owned; the handler must read
  // kernel.getHealth, NOT a `.health` field mutated onto the provider module.
  it('reads per-version health from the health service (4.6)', () => {
    const sentinel = { successCount: 7, errorCount: 1, consecutiveErrors: 0 };
    mockBuildHealth.mockReturnValue([
      { domain: 'ai', providerId: 'openai', version: 'v1', status: 'active', health: sentinel },
    ]);

    const result = controller.health(superAdmin, undefined);

    expect(mockBuildHealth).toHaveBeenCalledWith(undefined);
    expect(result).toHaveLength(1);
    expect(result[0].health).toBe(sentinel);
  });

  it('validates ?domain= on health too (3.3)', () => {
    expect(() => controller.health(superAdmin, 'bogus')).toThrow(BadRequestException);
    expect(mockBuildHealth).not.toHaveBeenCalled();
  });

  // PROVIDER_REMEDIATION 3.2 + 6.2: SuperAdminGuard is the class-level guard; the
  // redundant PoliciesGuard (a global APP_GUARD) was removed.
  it('is guarded by SuperAdminGuard at class level (3.2)', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, AdminProvidersController) || [];
    expect(guards).toContain(SuperAdminGuard);
  });

  it('no longer carries a redundant class-level PoliciesGuard (6.2)', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, AdminProvidersController) || [];
    const names = guards.map((g: any) => (typeof g === 'function' ? g.name : ''));
    expect(names).not.toContain('PoliciesGuard');
  });

  describe('featured providers', () => {
    it('lists featured providers', () => {
      mockFeaturedList.mockReturnValue([]);
      controller.listFeatured(superAdmin, 'ai');
      expect(mockFeaturedList).toHaveBeenCalledWith('ai');
    });

    it('upserts a featured provider', () => {
      controller.upsertFeatured(superAdmin, {
        domain: 'ai',
        providerId: 'openai',
        sortOrder: 5,
      } as FeaturedProviderDto);
      expect(mockFeaturedUpsert).toHaveBeenCalledWith('ai', 'openai', 5);
    });

    it('reorders featured providers', () => {
      controller.reorderFeatured(superAdmin, {
        domain: 'ai',
        entries: [{ providerId: 'openai', sortOrder: 1 }],
      } as any);
      expect(mockFeaturedReorder).toHaveBeenCalledWith('ai', [
        { providerId: 'openai', sortOrder: 1 },
      ]);
    });

    it('removes a featured provider', () => {
      controller.removeFeatured(superAdmin, { domain: 'ai', providerId: 'openai' } as any);
      expect(mockFeaturedRemove).toHaveBeenCalledWith('ai', 'openai');
    });
  });
});

// PROVIDER_REMEDIATION 3.8: sortOrder is a 32-bit Prisma Int — cap it so an oversize
// value is rejected at validation, not surfaced as an unhandled 500 at the DB layer.
describe('FeaturedProviderDto sortOrder bound (3.8)', () => {
  it('rejects a sortOrder above the 32-bit signed max', async () => {
    const dto = plainToInstance(FeaturedProviderDto, {
      domain: 'ai',
      providerId: 'openai',
      sortOrder: 3000000000,
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'sortOrder')).toBe(true);
  });

  it('accepts a sortOrder within range', async () => {
    const dto = plainToInstance(FeaturedProviderDto, {
      domain: 'ai',
      providerId: 'openai',
      sortOrder: 5,
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});
