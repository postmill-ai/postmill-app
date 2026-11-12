import { PrismaRepository } from '@postmill-ai/nestjs-libraries/database/prisma/prisma.service';
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

  createBrand(organizationId: string, data: Record<string, any> & { name: string }) {
    return this._aiBrandProfile.model.aIBrandProfile.create({
      data: {
        ...data,
        organizationId,
        platformInstructions: data.platformInstructions || {},
        languageProfiles: data.languageProfiles ?? {},
        enabled: data.enabled ?? true,
        isDefault: data.isDefault ?? false,
        logoFileIds: data.logoFileIds ?? [],
        palette: data.palette ?? [],
        fontFamilies: data.fontFamilies ?? [],
        preferredFormats: data.preferredFormats ?? [],
        assets: data.assets ?? [],
        enforcement: data.enforcement ?? {},
      },
    });
  }

  async updateBrand(
    organizationId: string,
    brandId: string,
    data: Record<string, any>,
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

  private async _brandForFonts(organizationId: string, brandId?: string | null) {
    if (brandId) return this.getBrand(organizationId, brandId);
    if (brandId === null) return null;
    return (await this.getDefaultBrand(organizationId)) || (await this.getFirstBrand(organizationId));
  }

  async getCustomFonts(organizationId: string, brandId?: string | null) {
    if (brandId === null) {
      const brands = await this.getBrands(organizationId);
      return brands.flatMap((brand) => Array.isArray(brand.customFonts) ? brand.customFonts : []);
    }
    const brand = await this._brandForFonts(organizationId, brandId);
    if (!brand) return [];
    const fonts = brand.customFonts as any[] | null;
    return Array.isArray(fonts) ? fonts : [];
  }

  async addCustomFont(
    organizationId: string,
    font: { family: string; fileId: string; path: string; weights: number[]; italic?: boolean; serverRender?: boolean },
    brandId?: string,
  ) {
    let brand = await this._brandForFonts(organizationId, brandId);
    if (!brand) {
      if (brandId) return [];
      brand = await this._aiBrandProfile.model.aIBrandProfile.create({
        data: { organizationId, name: 'Default Brand', isDefault: true },
      });
    }
    const key = (f: { family?: string; weights?: number[]; italic?: boolean }) =>
      `${(f.family || '').toLowerCase()}|${f.weights?.[0] ?? 400}|${f.italic ? 'i' : 'n'}`;
    const existing = ((brand.customFonts as any[]) || []).filter(
      (f: any) => key(f) !== key(font)
    );
    existing.push(font);
    await this._aiBrandProfile.model.aIBrandProfile.update({
      where: { id: brand.id, organizationId },
      data: { customFonts: existing },
    });
    return existing;
  }

  async removeCustomFont(organizationId: string, fileId: string, brandId?: string) {
    const brand = await this._brandForFonts(organizationId, brandId);
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
