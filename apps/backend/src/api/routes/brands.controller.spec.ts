import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpException } from '@nestjs/common';
import { Organization } from '@prisma/client';

vi.mock('@gitroom/nestjs-libraries/brands/brands.service', () => ({
  BrandsService: class {},
}));

import { BrandsController } from './brands.controller';
import { REQUIRE_PERMISSION_KEY } from '@gitroom/backend/services/auth/rbac/require-permission.decorator';
import type { BrandsService } from '@gitroom/nestjs-libraries/brands/brands.service';

const org = { id: 'org-1' } as unknown as Organization;

describe('BrandsController', () => {
  let brandsService: {
    getBrands: ReturnType<typeof vi.fn>;
    createBrand: ReturnType<typeof vi.fn>;
    updateBrand: ReturnType<typeof vi.fn>;
    deleteBrand: ReturnType<typeof vi.fn>;
    setDefaultBrand: ReturnType<typeof vi.fn>;
  };
  let controller: BrandsController;

  beforeEach(() => {
    brandsService = {
      getBrands: vi.fn(),
      createBrand: vi.fn(),
      updateBrand: vi.fn(),
      deleteBrand: vi.fn(),
      setDefaultBrand: vi.fn(),
    };
    controller = new BrandsController(
      brandsService as unknown as BrandsService
    );
  });

  describe('RBAC metadata', () => {
    it('gates reads on brands:read and mutations on brands:manage', () => {
      expect(
        Reflect.getMetadata(
          REQUIRE_PERMISSION_KEY,
          BrandsController.prototype.list
        )
      ).toEqual({ resource: 'brands', action: 'read' });

      for (const handler of [
        BrandsController.prototype.create,
        BrandsController.prototype.update,
        BrandsController.prototype.delete,
        BrandsController.prototype.setDefault,
      ]) {
        expect(Reflect.getMetadata(REQUIRE_PERMISSION_KEY, handler)).toEqual({
          resource: 'brands',
          action: 'manage',
        });
      }
    });
  });

  describe('list', () => {
    it('returns the org-scoped brand list', async () => {
      const brands = [{ id: 'b1' }];
      brandsService.getBrands.mockResolvedValue(brands);

      expect(await controller.list(org)).toBe(brands);
      expect(brandsService.getBrands).toHaveBeenCalledWith('org-1');
    });
  });

  describe('create', () => {
    it('delegates creation org-scoped with the body', async () => {
      const body = { name: 'My Brand', instructions: 'Be bold' };
      brandsService.createBrand.mockResolvedValue({ id: 'b1', ...body });

      const result = await controller.create(org, body);

      expect(brandsService.createBrand).toHaveBeenCalledWith('org-1', body);
      expect(result).toEqual({ id: 'b1', ...body });
    });
  });

  describe('update', () => {
    it('returns the updated brand', async () => {
      brandsService.updateBrand.mockResolvedValue({ id: 'b1', name: 'New' });

      const result = await controller.update(org, 'b1', { name: 'New' });

      expect(brandsService.updateBrand).toHaveBeenCalledWith('org-1', 'b1', {
        name: 'New',
      });
      expect(result).toEqual({ id: 'b1', name: 'New' });
    });

    it('404s when the brand is not found in the org', async () => {
      brandsService.updateBrand.mockResolvedValue(null);

      await expect(
        controller.update(org, 'foreign-brand', { name: 'x' })
      ).rejects.toMatchObject({ status: 404, message: 'Brand not found' });
      await expect(
        controller.update(org, 'foreign-brand', { name: 'x' })
      ).rejects.toBeInstanceOf(HttpException);
    });
  });

  describe('delete', () => {
    it('reports success when the brand is deleted', async () => {
      brandsService.deleteBrand.mockResolvedValue({ id: 'b1' });

      expect(await controller.delete(org, 'b1')).toEqual({ success: true });
      expect(brandsService.deleteBrand).toHaveBeenCalledWith('org-1', 'b1');
    });

    it('404s when the brand is not found in the org', async () => {
      brandsService.deleteBrand.mockResolvedValue(null);

      await expect(controller.delete(org, 'missing')).rejects.toMatchObject({
        status: 404,
        message: 'Brand not found',
      });
    });
  });

  describe('setDefault', () => {
    it('returns the new default brand', async () => {
      brandsService.setDefaultBrand.mockResolvedValue({
        id: 'b2',
        isDefault: true,
      });

      const result = await controller.setDefault(org, 'b2');

      expect(brandsService.setDefaultBrand).toHaveBeenCalledWith(
        'org-1',
        'b2'
      );
      expect(result).toEqual({ id: 'b2', isDefault: true });
    });

    it('404s when the brand is not found in the org', async () => {
      brandsService.setDefaultBrand.mockResolvedValue(null);

      await expect(
        controller.setDefault(org, 'missing')
      ).rejects.toMatchObject({ status: 404, message: 'Brand not found' });
    });
  });
});
