import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BrandsService } from './brands.service';

interface MockBrandsRepository {
  getBrands: ReturnType<typeof vi.fn>;
  getBrand: ReturnType<typeof vi.fn>;
  getDefaultBrand: ReturnType<typeof vi.fn>;
  getFirstBrand: ReturnType<typeof vi.fn>;
  countBrands: ReturnType<typeof vi.fn>;
  createBrand: ReturnType<typeof vi.fn>;
  updateBrand: ReturnType<typeof vi.fn>;
  deleteBrand: ReturnType<typeof vi.fn>;
  setBrandAsDefault: ReturnType<typeof vi.fn>;
}

describe('BrandsService', () => {
  let repository: MockBrandsRepository;
  let service: BrandsService;

  beforeEach(() => {
    repository = {
      getBrands: vi.fn(),
      getBrand: vi.fn(),
      getDefaultBrand: vi.fn(),
      getFirstBrand: vi.fn(),
      countBrands: vi.fn(),
      createBrand: vi.fn(),
      updateBrand: vi.fn(),
      deleteBrand: vi.fn(),
      setBrandAsDefault: vi.fn(),
    };
    service = new BrandsService(repository as never);
  });

  describe('reads (org-scoped delegation)', () => {
    it('getBrands delegates with the org id', () => {
      const brands = [{ id: 'b1' }];
      repository.getBrands.mockReturnValue(brands);
      expect(service.getBrands('org-1')).toBe(brands);
      expect(repository.getBrands).toHaveBeenCalledWith('org-1');
    });

    it('getBrand delegates with org and brand id', () => {
      const brand = { id: 'b1' };
      repository.getBrand.mockReturnValue(brand);
      expect(service.getBrand('org-1', 'b1')).toBe(brand);
      expect(repository.getBrand).toHaveBeenCalledWith('org-1', 'b1');
    });

    it('getDefaultBrand delegates with the org id', () => {
      const brand = { id: 'b1', isDefault: true };
      repository.getDefaultBrand.mockReturnValue(brand);
      expect(service.getDefaultBrand('org-1')).toBe(brand);
      expect(repository.getDefaultBrand).toHaveBeenCalledWith('org-1');
    });
  });

  describe('createBrand', () => {
    it('marks the first brand of an org as default', async () => {
      repository.countBrands.mockResolvedValue(0);
      repository.createBrand.mockResolvedValue({ id: 'b1' });

      await service.createBrand('org-1', { name: 'My Brand' });

      expect(repository.createBrand).toHaveBeenCalledWith('org-1', {
        name: 'My Brand',
        slug: 'my-brand',
        isDefault: true,
      });
    });

    it('does not mark subsequent brands as default', async () => {
      repository.countBrands.mockResolvedValue(2);
      repository.createBrand.mockResolvedValue({ id: 'b3' });

      await service.createBrand('org-1', { name: 'Third' });

      expect(repository.createBrand).toHaveBeenCalledWith('org-1', {
        name: 'Third',
        slug: 'third',
        isDefault: false,
      });
    });

    it('slugifies the name (lowercase, dashes, strips symbols and edge dashes)', async () => {
      repository.countBrands.mockResolvedValue(1);
      repository.createBrand.mockResolvedValue({ id: 'b2' });

      await service.createBrand('org-1', { name: '  --My!! Cool   Brand 2.0--  ' });

      const data = repository.createBrand.mock.calls[0][1];
      expect(data.slug).toBe('my-cool-brand-20');
    });

    it('passes through optional fields', async () => {
      repository.countBrands.mockResolvedValue(1);
      repository.createBrand.mockResolvedValue({ id: 'b2' });

      await service.createBrand('org-1', {
        name: 'B',
        instructions: 'Be bold',
        language: 'en',
        platformInstructions: { x: 'short' },
        enabled: false,
      });

      expect(repository.createBrand).toHaveBeenCalledWith('org-1', {
        name: 'B',
        instructions: 'Be bold',
        language: 'en',
        platformInstructions: { x: 'short' },
        enabled: false,
        slug: 'b',
        isDefault: false,
      });
    });
  });

  describe('updateBrand', () => {
    it('delegates org-scoped to the repository', async () => {
      repository.updateBrand.mockResolvedValue({ id: 'b1', name: 'New' });

      const result = await service.updateBrand('org-1', 'b1', { name: 'New' });

      expect(repository.updateBrand).toHaveBeenCalledWith('org-1', 'b1', {
        name: 'New',
      });
      expect(result).toEqual({ id: 'b1', name: 'New' });
    });

    it('returns null for a brand outside the org (repository contract)', async () => {
      repository.updateBrand.mockResolvedValue(null);
      expect(
        await service.updateBrand('org-1', 'other-org-brand', { name: 'x' })
      ).toBeNull();
    });
  });

  describe('deleteBrand', () => {
    it('returns null when the brand does not exist in the org', async () => {
      repository.getBrand.mockResolvedValue(null);

      expect(await service.deleteBrand('org-1', 'missing')).toBeNull();
      expect(repository.deleteBrand).not.toHaveBeenCalled();
    });

    it('returns null when the repository delete misses (org-scoped)', async () => {
      repository.getBrand.mockResolvedValue({ id: 'b1', isDefault: false });
      repository.deleteBrand.mockResolvedValue(null);

      expect(await service.deleteBrand('org-1', 'b1')).toBeNull();
      expect(repository.setBrandAsDefault).not.toHaveBeenCalled();
    });

    it('deletes a non-default brand without touching the default', async () => {
      repository.getBrand.mockResolvedValue({ id: 'b2', isDefault: false });
      repository.deleteBrand.mockResolvedValue({ id: 'b2' });

      const result = await service.deleteBrand('org-1', 'b2');

      expect(result).toEqual({ id: 'b2' });
      expect(repository.countBrands).not.toHaveBeenCalled();
      expect(repository.setBrandAsDefault).not.toHaveBeenCalled();
    });

    it('reassigns default to the first remaining brand when the default is deleted', async () => {
      repository.getBrand.mockResolvedValue({ id: 'b1', isDefault: true });
      repository.deleteBrand.mockResolvedValue({ id: 'b1' });
      repository.countBrands.mockResolvedValue(2);
      repository.getFirstBrand.mockResolvedValue({ id: 'b2' });

      const result = await service.deleteBrand('org-1', 'b1');

      expect(result).toEqual({ id: 'b1' });
      expect(repository.setBrandAsDefault).toHaveBeenCalledWith('org-1', 'b2');
    });

    it('does not reassign when the deleted default was the only brand', async () => {
      repository.getBrand.mockResolvedValue({ id: 'b1', isDefault: true });
      repository.deleteBrand.mockResolvedValue({ id: 'b1' });
      repository.countBrands.mockResolvedValue(0);

      const result = await service.deleteBrand('org-1', 'b1');

      expect(result).toEqual({ id: 'b1' });
      expect(repository.getFirstBrand).not.toHaveBeenCalled();
      expect(repository.setBrandAsDefault).not.toHaveBeenCalled();
    });

    it('skips reassignment when no first brand can be resolved', async () => {
      repository.getBrand.mockResolvedValue({ id: 'b1', isDefault: true });
      repository.deleteBrand.mockResolvedValue({ id: 'b1' });
      repository.countBrands.mockResolvedValue(1);
      repository.getFirstBrand.mockResolvedValue(null);

      await service.deleteBrand('org-1', 'b1');

      expect(repository.setBrandAsDefault).not.toHaveBeenCalled();
    });
  });

  describe('setDefaultBrand', () => {
    it('returns null when the brand is not in the org', async () => {
      repository.getBrand.mockResolvedValue(null);

      expect(await service.setDefaultBrand('org-1', 'foreign')).toBeNull();
      expect(repository.setBrandAsDefault).not.toHaveBeenCalled();
    });

    it('delegates to setBrandAsDefault (repository enforces exactly-one-default)', async () => {
      repository.getBrand.mockResolvedValue({ id: 'b2', isDefault: false });
      repository.setBrandAsDefault.mockResolvedValue({ id: 'b2', isDefault: true });

      const result = await service.setDefaultBrand('org-1', 'b2');

      expect(repository.setBrandAsDefault).toHaveBeenCalledWith('org-1', 'b2');
      expect(result).toEqual({ id: 'b2', isDefault: true });
    });
  });
});
