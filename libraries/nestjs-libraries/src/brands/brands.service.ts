import { Injectable } from '@nestjs/common';
import { BrandsRepository } from '@gitroom/nestjs-libraries/database/prisma/brands/brands.repository';

@Injectable()
export class BrandsService {
  constructor(private _repository: BrandsRepository) {}

  getBrands(orgId: string) {
    return this._repository.getBrands(orgId);
  }

  getBrand(orgId: string, brandId: string) {
    return this._repository.getBrand(orgId, brandId);
  }

  getDefaultBrand(orgId: string) {
    return this._repository.getDefaultBrand(orgId);
  }

  async createBrand(
    orgId: string,
    data: {
      name: string;
      instructions?: string;
      language?: string;
      platformInstructions?: Record<string, string>;
      languageProfiles?: Record<string, any>;
      enabled?: boolean;
      logoFileIds?: string[];
      palette?: string[];
      fontFamilies?: string[];
      introFileId?: string | null;
      outroFileId?: string | null;
      assets?: { fileId?: string; url: string; caption?: string }[];
      enforcement?: Record<string, any>;
    },
  ) {
    const count = await this._repository.countBrands(orgId);
    const slug = data.name
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    return this._repository.createBrand(orgId, {
      ...data,
      slug,
      isDefault: count === 0,
    });
  }

  async updateBrand(
    orgId: string,
    brandId: string,
    data: {
      name?: string;
      instructions?: string;
      language?: string;
      platformInstructions?: Record<string, string>;
      languageProfiles?: Record<string, any>;
      enabled?: boolean;
      logoFileIds?: string[];
      palette?: string[];
      fontFamilies?: string[];
      introFileId?: string | null;
      outroFileId?: string | null;
      assets?: { fileId?: string; url: string; caption?: string }[];
      enforcement?: Record<string, any>;
    },
  ) {
    return this._repository.updateBrand(orgId, brandId, data);
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
    return this._repository.setBrandAsDefault(orgId, brandId);
  }

  getCustomFonts(orgId: string) {
    return this._repository.getCustomFonts(orgId);
  }

  addCustomFont(orgId: string, font: { family: string; fileId: string; path: string; weights: number[] }) {
    return this._repository.addCustomFont(orgId, font);
  }

  removeCustomFont(orgId: string, fileId: string) {
    return this._repository.removeCustomFont(orgId, fileId);
  }
}
