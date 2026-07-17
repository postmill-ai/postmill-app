import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BrandsRepository } from './brands.repository';

function makeModel() {
  return {
    aIBrandProfile: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
  };
}

function makeRepo(model = makeModel()) {
  return {
    repo: new BrandsRepository({ model } as any),
    model,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('BrandsRepository — tenant isolation', () => {
  describe('setBrandAsDefault', () => {
    it('returns null and does not update when the brand belongs to another org', async () => {
      const { repo, model } = makeRepo();
      model.aIBrandProfile.findFirst.mockResolvedValue(null);

      const result = await repo.setBrandAsDefault('org-1', 'foreign-brand');

      expect(result).toBeNull();
      expect(model.aIBrandProfile.findFirst).toHaveBeenCalledWith({
        where: { id: 'foreign-brand', organizationId: 'org-1' },
      });
      expect(model.aIBrandProfile.updateMany).not.toHaveBeenCalled();
      expect(model.aIBrandProfile.update).not.toHaveBeenCalled();
    });

    it('unsets defaults within the org and marks the matching brand as default', async () => {
      const { repo, model } = makeRepo();
      model.aIBrandProfile.findFirst.mockResolvedValue({
        id: 'brand-1',
        organizationId: 'org-1',
      });
      model.aIBrandProfile.updateMany.mockResolvedValue({ count: 1 });
      model.aIBrandProfile.update.mockResolvedValue({
        id: 'brand-1',
        isDefault: true,
      });

      const result = await repo.setBrandAsDefault('org-1', 'brand-1');

      expect(model.aIBrandProfile.findFirst).toHaveBeenCalledWith({
        where: { id: 'brand-1', organizationId: 'org-1' },
      });
      expect(model.aIBrandProfile.updateMany).toHaveBeenCalledWith({
        where: { organizationId: 'org-1', isDefault: true },
        data: { isDefault: false },
      });
      expect(model.aIBrandProfile.update).toHaveBeenCalledWith({
        where: { id: 'brand-1', organizationId: 'org-1' },
        data: { isDefault: true },
      });
      expect(result).toEqual({ id: 'brand-1', isDefault: true });
    });
  });

  describe('updateBrand', () => {
    it('returns null and does not update when the brand belongs to another org', async () => {
      const { repo, model } = makeRepo();
      model.aIBrandProfile.findFirst.mockResolvedValue(null);

      const result = await repo.updateBrand('org-1', 'foreign-brand', {
        name: 'New name',
      });

      expect(result).toBeNull();
      expect(model.aIBrandProfile.findFirst).toHaveBeenCalledWith({
        where: { id: 'foreign-brand', organizationId: 'org-1' },
      });
      expect(model.aIBrandProfile.update).not.toHaveBeenCalled();
    });

    it('scopes the update by organizationId', async () => {
      const { repo, model } = makeRepo();
      model.aIBrandProfile.findFirst.mockResolvedValue({
        id: 'brand-1',
        organizationId: 'org-1',
      });
      model.aIBrandProfile.update.mockResolvedValue({
        id: 'brand-1',
        name: 'Updated',
      });

      await repo.updateBrand('org-1', 'brand-1', { name: 'Updated' });

      expect(model.aIBrandProfile.update).toHaveBeenCalledWith({
        where: { id: 'brand-1', organizationId: 'org-1' },
        data: { name: 'Updated' },
      });
    });
  });

  describe('deleteBrand', () => {
    it('returns null and does not delete when the brand belongs to another org', async () => {
      const { repo, model } = makeRepo();
      model.aIBrandProfile.findFirst.mockResolvedValue(null);

      const result = await repo.deleteBrand('org-1', 'foreign-brand');

      expect(result).toBeNull();
      expect(model.aIBrandProfile.findFirst).toHaveBeenCalledWith({
        where: { id: 'foreign-brand', organizationId: 'org-1' },
      });
      expect(model.aIBrandProfile.delete).not.toHaveBeenCalled();
    });

    it('scopes the delete by organizationId', async () => {
      const { repo, model } = makeRepo();
      model.aIBrandProfile.findFirst.mockResolvedValue({
        id: 'brand-1',
        organizationId: 'org-1',
      });
      model.aIBrandProfile.delete.mockResolvedValue({ id: 'brand-1' });

      await repo.deleteBrand('org-1', 'brand-1');

      expect(model.aIBrandProfile.delete).toHaveBeenCalledWith({
        where: { id: 'brand-1', organizationId: 'org-1' },
      });
    });
  });
});
