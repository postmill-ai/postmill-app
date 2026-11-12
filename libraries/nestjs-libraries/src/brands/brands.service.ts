import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { BrandsRepository } from '@postmill-ai/nestjs-libraries/database/prisma/brands/brands.repository';
import {
  BrandCustomFont,
  BrandProfileInput,
  normalizeBrandProfile,
  normalizeBrandProfilePatch,
} from './brand-kit';

@Injectable()
export class BrandsService {
  constructor(private _repository: BrandsRepository) {}

  async getBrands(orgId: string) {
    return (await this._repository.getBrands(orgId)).map(normalizeBrandProfile);
  }

  async getBrand(orgId: string, brandId: string) {
    const brand = await this._repository.getBrand(orgId, brandId);
    return brand ? normalizeBrandProfile(brand) : null;
  }

  async getBrandOwnedStrict(orgId: string, brandId: string) {
    const brand = await this.getBrand(orgId, brandId);
    if (!brand) throw new NotFoundException('Brand not found');
    return brand;
  }

  async getBrandStrict(orgId: string, brandId: string) {
    const brand = await this.getBrandOwnedStrict(orgId, brandId);
    if (!brand.enabled) throw new BadRequestException('Brand is disabled');
    return brand;
  }

  async getDefaultBrand(orgId: string) {
    const brand = await this._repository.getDefaultBrand(orgId);
    return brand ? normalizeBrandProfile(brand) : null;
  }

  async createBrand(orgId: string, data: BrandProfileInput & { name: string }) {
    const count = await this._repository.countBrands(orgId);
    const normalized = normalizeBrandProfilePatch(data);
    const slug = data.name
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    const brand = await this._repository.createBrand(orgId, {
      ...normalized,
      name: data.name,
      slug,
      isDefault: count === 0,
    });
    return normalizeBrandProfile(brand);
  }

  async updateBrand(orgId: string, brandId: string, data: BrandProfileInput) {
    const brand = await this._repository.updateBrand(
      orgId,
      brandId,
      normalizeBrandProfilePatch(data),
    );
    return brand ? normalizeBrandProfile(brand) : null;
  }

  async upsertDefaultBrand(orgId: string, data: BrandProfileInput) {
    const existing = await this._repository.getDefaultBrand(orgId);
    if (existing) return this.updateBrand(orgId, existing.id, data);
    return this.createBrand(orgId, { ...data, name: 'Default Brand' });
  }

  async deleteBrand(orgId: string, brandId: string) {
    const brand = await this._repository.getBrand(orgId, brandId);
    if (!brand) return null;

    const deleted = await this._repository.deleteBrand(orgId, brandId);
    if (!deleted) return null;

    if (brand.isDefault) {
      const remaining = await this._repository.countBrands(orgId);
      if (remaining > 0) {
        const first = await this._repository.getFirstBrand(orgId);
        if (first) {
          await this._repository.setBrandAsDefault(orgId, first.id);
        }
      }
    }

    return deleted;
  }

  async setDefaultBrand(orgId: string, brandId: string) {
    const brand = await this._repository.getBrand(orgId, brandId);
    if (!brand) return null;
    const updated = await this._repository.setBrandAsDefault(orgId, brandId);
    return updated ? normalizeBrandProfile(updated) : null;
  }

  getCustomFonts(orgId: string, brandId?: string | null) {
    return this._repository.getCustomFonts(orgId, brandId);
  }

  addCustomFont(orgId: string, font: BrandCustomFont, brandId?: string) {
    return this._repository.addCustomFont(orgId, font, brandId);
  }

  removeCustomFont(orgId: string, fileId: string, brandId?: string) {
    return this._repository.removeCustomFont(orgId, fileId, brandId);
  }
}
