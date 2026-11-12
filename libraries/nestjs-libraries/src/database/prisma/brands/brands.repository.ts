import { PrismaRepository } from '@postmill-ai/nestjs-libraries/database/prisma/prisma.service';
import { Injectable, NotFoundException } from '@nestjs/common';
import { BrandProfileWrite, pickBrandProfileWrite } from '@postmill-ai/nestjs-libraries/brands/brand-kit';

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

  createBrand(organizationId: string, data: BrandProfileWrite & { name: string }) {
    const values = pickBrandProfileWrite(data);
    return this._aiBrandProfile.model.aIBrandProfile.create({
      data: {
        ...values,
        organizationId,
        platformInstructions: values.platformInstructions || {},
        languageProfiles: values.languageProfiles ?? {},
        enabled: values.enabled ?? true,
        isDefault: values.isDefault ?? false,
        logoFileIds: values.logoFileIds ?? [],
        palette: values.palette ?? [],
        fontFamilies: values.fontFamilies ?? [],
        preferredFormats: values.preferredFormats ?? [],
        assets: values.assets ?? [],
        enforcement: values.enforcement ?? {},
      },
    });
  }

  async updateBrand(
    organizationId: string,
    brandId: string,
    data: BrandProfileWrite,
  ) {
    const brand = await this._aiBrandProfile.model.aIBrandProfile.findFirst({
      where: { id: brandId, organizationId },
    });
    if (!brand) return null;
    return this._aiBrandProfile.model.aIBrandProfile.update({
      where: { id: brandId, organizationId },
      data: pickBrandProfileWrite(data),
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
      const faces = new Map<string, any>();
      for (const brand of brands) {
        const fonts = Array.isArray(brand.customFonts) ? brand.customFonts as any[] : [];
        for (const font of fonts) {
          for (const weight of font.weights?.length ? font.weights : [400]) {
            const key = `${(font.family || '').toLowerCase()}|${weight}|${font.italic ? 'i' : 'n'}`;
            if (!faces.has(key)) faces.set(key, { ...font, weights: [weight] });
          }
        }
      }
      return [...faces.values()];
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
      if (brandId) throw new NotFoundException('Brand not found');
      // Fonts live on the org's default profile — an org with zero profiles
      // used to get a silent no-op here (the upload "succeeded" and vanished).
      // Create the default profile, named like the AI-settings upsert does.
      brand = await this._aiBrandProfile.model.aIBrandProfile.create({
        data: { organizationId, name: 'Default Brand', isDefault: true },
      });
    }
    // Identity is (family, weight, italic), not the row. Re-uploading a weight
    // used to append a second entry for it, and which of the two the renderers
    // picked depended on iteration order — the new file replaces the old one.
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
