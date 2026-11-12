import { BadRequestException } from '@nestjs/common';
import { CHANNEL_PRESETS } from '@postmill-ai/nestjs-libraries/integrations/social/channel-presets';

export interface BrandCustomFont {
  fileId: string;
  family: string;
  path: string;
  weights: number[];
  italic?: boolean;
  serverRender?: boolean;
}

export interface BrandAsset {
  fileId?: string;
  url: string;
  caption?: string;
}

export interface BrandKit {
  id: string;
  organizationId: string;
  name: string | null;
  enabled: boolean;
  isDefault: boolean;
  instructions: string | null;
  language: string | null;
  palette: string[];
  fontFamilies: string[];
  preferredFormats: string[];
  customFonts: BrandCustomFont[];
  logoFileIds: string[];
  assets: BrandAsset[];
  introFileId: string | null;
  outroFileId: string | null;
  enforcement: Record<string, any>;
  [key: string]: any;
}

const VALID_FORMAT_IDS = new Set(
  CHANNEL_PRESETS.filter((preset) => preset.id !== 'custom').map((preset) => preset.id),
);

const normalizeStrings = (value: unknown, objectKey: 'hex' | 'name'): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry === 'string') return entry;
      if (entry && typeof entry === 'object') {
        const candidate = (entry as Record<string, unknown>)[objectKey];
        return typeof candidate === 'string' ? candidate : '';
      }
      return '';
    })
    .map((entry) => entry.trim())
    .filter(Boolean);
};

export const normalizePreferredFormats = (value: unknown): string[] => {
  const formats = normalizeStrings(value, 'name');
  return [...new Set(formats)];
};

export const validatePreferredFormats = (value: unknown): string[] => {
  const formats = normalizePreferredFormats(value);
  const invalid = formats.filter((id) => !VALID_FORMAT_IDS.has(id));
  if (invalid.length) {
    throw new BadRequestException(`Unknown brand format: ${invalid.join(', ')}`);
  }
  return formats;
};

export const normalizeBrandProfile = (brand: Record<string, any>): BrandKit => ({
  ...brand,
  palette: normalizeStrings(brand.palette, 'hex'),
  fontFamilies: normalizeStrings(brand.fontFamilies, 'name'),
  preferredFormats: normalizePreferredFormats(brand.preferredFormats),
  customFonts: Array.isArray(brand.customFonts) ? brand.customFonts : [],
  logoFileIds: Array.isArray(brand.logoFileIds) ? brand.logoFileIds : [],
  assets: Array.isArray(brand.assets) ? brand.assets : [],
} as BrandKit);

export const normalizeBrandProfilePatch = <T extends Record<string, any>>(patch: T): T => {
  const normalized: Record<string, any> = { ...patch };
  if (patch.palette !== undefined) normalized.palette = normalizeStrings(patch.palette, 'hex');
  if (patch.fontFamilies !== undefined) {
    normalized.fontFamilies = normalizeStrings(patch.fontFamilies, 'name');
  }
  if (patch.preferredFormats !== undefined) {
    normalized.preferredFormats = validatePreferredFormats(patch.preferredFormats);
  }
  return normalized as T;
};
