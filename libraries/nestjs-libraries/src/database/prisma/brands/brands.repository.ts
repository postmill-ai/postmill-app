import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';

@Injectable()
export class BrandsRepository {
  constructor(
    private _aiBrandProfile: PrismaRepository<'aIBrandProfile'>,
  ) {}

  getBrands(organizationId: string) {
    return this._aiBrandProfile.model.aIBrandProfile.findMany({
      where: { organizationId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
  }

  getBrand(organizationId: string, brandId: string) {
    return this._aiBrandProfile.model.aIBrandProfile.findFirst({
      where: { id: brandId, organizationId },
    });
  }

  getDefaultBrand(organizationId: string) {
    return this._aiBrandProfile.model.aIBrandProfile.findFirst({
      where: { organizationId, isDefault: true },
    });
  }

  getFirstBrand(organizationId: string) {
    return this._aiBrandProfile.model.aIBrandProfile.findFirst({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
    });
  }

  countBrands(organizationId: string) {
    return this._aiBrandProfile.model.aIBrandProfile.count({
      where: { organizationId },
    });
  }

  createBrand(
    organizationId: string,
    data: {
      name: string;
      instructions?: string;
      language?: string;
      platformInstructions?: Record<string, string>;
      languageProfiles?: Record<string, any>;
      enabled?: boolean;
      isDefault?: boolean;
      slug?: string;
      logoFileIds?: string[];
      palette?: string[];
      fontFamilies?: string[];
      assets?: { fileId?: string; url: string; caption?: string }[];
      enforcement?: Record<string, any>;
    },
  ) {
    return this._aiBrandProfile.model.aIBrandProfile.create({
      data: {
        organizationId,
        name: data.name,
        instructions: data.instructions,
        language: data.language,
        platformInstructions: data.platformInstructions || {},
        languageProfiles: data.languageProfiles ?? {},
        enabled: data.enabled ?? true,
        isDefault: data.isDefault ?? false,
        slug: data.slug,
        logoFileIds: data.logoFileIds ?? [],
        palette: data.palette ?? [],
        fontFamilies: data.fontFamilies ?? [],
        assets: data.assets ?? [],
        enforcement: data.enforcement ?? {},
      },
    });
  }

  async updateBrand(
    organizationId: string,
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
    const brand = await this._aiBrandProfile.model.aIBrandProfile.findFirst({
      where: { id: brandId, organizationId },
    });
    if (!brand) return null;
    return this._aiBrandProfile.model.aIBrandProfile.update({
      where: { id: brandId, organizationId },
      data,
    });
  }

  async deleteBrand(organizationId: string, brandId: string) {
    const brand = await this._aiBrandProfile.model.aIBrandProfile.findFirst({
      where: { id: brandId, organizationId },
    });
    if (!brand) return null;
    return this._aiBrandProfile.model.aIBrandProfile.delete({
      where: { id: brandId, organizationId },
    });
  }

  async unsetDefaultBrand(organizationId: string) {
    await this._aiBrandProfile.model.aIBrandProfile.updateMany({
      where: { organizationId, isDefault: true },
      data: { isDefault: false },
    });
  }

  async setBrandAsDefault(organizationId: string, brandId: string) {
    const brand = await this._aiBrandProfile.model.aIBrandProfile.findFirst({
      where: { id: brandId, organizationId },
    });
    if (!brand) return null;
    await this._aiBrandProfile.model.aIBrandProfile.updateMany({
      where: { organizationId, isDefault: true },
      data: { isDefault: false },
    });
    return this._aiBrandProfile.model.aIBrandProfile.update({
      where: { id: brandId, organizationId },
      data: { isDefault: true },
    });
  }

  async getCustomFonts(organizationId: string) {
    const brand = await this.getDefaultBrand(organizationId) || await this.getFirstBrand(organizationId);
    if (!brand) return [];
    const fonts = brand.customFonts as any[] | null;
    return Array.isArray(fonts) ? fonts : [];
  }

  async addCustomFont(
    organizationId: string,
    font: { family: string; fileId: string; path: string; weights: number[] }
  ) {
    const brand = await this.getDefaultBrand(organizationId) || await this.getFirstBrand(organizationId);
    if (!brand) return [];
    const existing = (brand.customFonts as any[]) || [];
    existing.push(font);
    await this._aiBrandProfile.model.aIBrandProfile.update({
      where: { id: brand.id, organizationId },
      data: { customFonts: existing },
    });
    return existing;
  }

  async removeCustomFont(organizationId: string, fileId: string) {
    const brand = await this.getDefaultBrand(organizationId) || await this.getFirstBrand(organizationId);
    if (!brand) return [];
    const existing = (brand.customFonts as any[]) || [];
    const next = existing.filter((f: any) => f.fileId !== fileId);
    await this._aiBrandProfile.model.aIBrandProfile.update({
      where: { id: brand.id, organizationId },
      data: { customFonts: next },
    });
    return next;
  }
}
