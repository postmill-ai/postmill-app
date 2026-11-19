import { BadRequestException } from '@nestjs/common';
import { CHANNEL_PRESETS } from '@postmill-ai/nestjs-libraries/integrations/social/channel-presets';

export type BrandCustomFont = {
  fileId: string;
  family: string;
  path: string;
  weights: number[];
  italic?: boolean;
  serverRender?: boolean;
};

export type BrandCustomFontInput = Pick<BrandCustomFont, 'fileId'> & Partial<Omit<BrandCustomFont, 'fileId'>>;

export type BrandAsset = {
  fileId?: string;
  url: string;
  caption?: string;
};

export type BrandAssetInput = {
  fileId?: string;
  url?: string;
  caption?: string;
};

export const BRAND_COLOR_ROLES = ['primary', 'accent', 'background', 'text'] as const;
export const BRAND_LOGO_ROLES = ['main', 'icon', 'dark'] as const;
export type BrandColorRole = typeof BRAND_COLOR_ROLES[number];
export type BrandLogoRole = typeof BRAND_LOGO_ROLES[number];

export type BrandPaletteEntry = {
  name?: string;
  hex?: string;
  role?: BrandColorRole;
};

export type BrandLogoFileEntry = {
  fileId?: string;
  role?: BrandLogoRole;
};

export type BrandColorRoleAssignment = {
  index: number;
  hex: string;
  role: BrandColorRole;
};

export type BrandLogoRoleAssignment = {
  fileId: string;
  role: BrandLogoRole;
};

export interface BrandKit {
  id: string;
  organizationId: string;
  name: string | null;
  enabled: boolean;
  isDefault: boolean;
  instructions: string | null;
  language: string | null;
  palette: string[];
  colorRoles?: BrandColorRoleAssignment[];
  fontFamilies: string[];
  preferredFormats: string[];
  customFonts: BrandCustomFont[];
  logoFileIds: string[];
  logoRoles?: BrandLogoRoleAssignment[];
  assets: BrandAsset[];
  introFileId: string | null;
  outroFileId: string | null;
  enforcement: Record<string, any>;
  [key: string]: any;
}

export interface BrandProfileWrite {
  name?: string;
  instructions?: string | null;
  language?: string | null;
  platformInstructions?: Record<string, any>;
  languageProfiles?: Record<string, any>;
  enabled?: boolean;
  isDefault?: boolean;
  slug?: string | null;
  logoFileIds?: Array<string | BrandLogoFileEntry>;
  palette?: Array<string | BrandPaletteEntry>;
  fontFamilies?: string[];
  preferredFormats?: string[];
  customFonts?: BrandCustomFontInput[];
  introFileId?: string | null;
  outroFileId?: string | null;
  assets?: BrandAssetInput[];
  enforcement?: Record<string, any>;
}

export type BrandProfileInput = Omit<BrandProfileWrite, 'fontFamilies' | 'preferredFormats'> & {
  fontFamilies?: Array<string | { name?: string }>;
  preferredFormats?: Array<string | { name?: string }>;
};

const WRITE_FIELDS = [
  'name', 'instructions', 'language', 'platformInstructions', 'languageProfiles',
  'enabled', 'isDefault', 'slug', 'logoFileIds', 'palette', 'fontFamilies',
  'preferredFormats', 'customFonts', 'introFileId', 'outroFileId', 'assets', 'enforcement',
] as const;

export const pickBrandProfileWrite = (data: BrandProfileWrite): BrandProfileWrite => {
  const picked: BrandProfileWrite = {};
  for (const key of WRITE_FIELDS) {
    if (data[key] !== undefined) (picked as any)[key] = data[key];
  }
  return picked;
};

const VALID_FORMAT_IDS = new Set(
  CHANNEL_PRESETS.filter((preset) => preset.id !== 'custom').map((preset) => preset.id),
);
const COLOR_ROLES = new Set<string>(BRAND_COLOR_ROLES);
const LOGO_ROLES = new Set<string>(BRAND_LOGO_ROLES);

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

const readRole = <T extends string>(entry: Record<string, unknown>, roles: Set<string>): T | undefined =>
  typeof entry.role === 'string' && roles.has(entry.role) ? entry.role as T : undefined;

const writeRole = <T extends string>(entry: Record<string, unknown>, roles: Set<string>, label: string): T | undefined => {
  if (entry.role === undefined) return undefined;
  if (typeof entry.role !== 'string' || !roles.has(entry.role)) {
    throw new BadRequestException(`Unknown brand ${label} role: ${String(entry.role)}`);
  }
  return entry.role as T;
};

const normalizePalette = (value: unknown, strict = false) => {
  const palette: string[] = [];
  const stored: Array<string | BrandPaletteEntry> = [];
  const colorRoles: BrandColorRoleAssignment[] = [];
  if (!Array.isArray(value)) return { palette, stored, colorRoles };

  for (const entry of value) {
    const object = entry && typeof entry === 'object' ? entry as Record<string, unknown> : null;
    const hex = typeof entry === 'string' ? entry.trim() : typeof object?.hex === 'string' ? object.hex.trim() : '';
    if (!hex) continue;
    const role = object
      ? strict ? writeRole<BrandColorRole>(object, COLOR_ROLES, 'color') : readRole<BrandColorRole>(object, COLOR_ROLES)
      : undefined;
    const index = palette.length;
    palette.push(hex);
    if (role) {
      const name = typeof object?.name === 'string' && object.name.trim() ? object.name.trim() : undefined;
      stored.push({ ...(name ? { name } : {}), hex, role });
      colorRoles.push({ index, hex, role });
    } else {
      stored.push(hex);
    }
  }
  return { palette, stored, colorRoles };
};

const normalizeLogoFiles = (value: unknown, strict = false) => {
  const logoFileIds: string[] = [];
  const stored: Array<string | BrandLogoFileEntry> = [];
  const logoRoles: BrandLogoRoleAssignment[] = [];
  if (!Array.isArray(value)) return { logoFileIds, stored, logoRoles };

  for (const entry of value) {
    const object = entry && typeof entry === 'object' ? entry as Record<string, unknown> : null;
    const fileId = typeof entry === 'string' ? entry.trim() : typeof object?.fileId === 'string' ? object.fileId.trim() : '';
    if (!fileId) continue;
    const role = object
      ? strict ? writeRole<BrandLogoRole>(object, LOGO_ROLES, 'logo') : readRole<BrandLogoRole>(object, LOGO_ROLES)
      : undefined;
    logoFileIds.push(fileId);
    if (role) {
      stored.push({ fileId, role });
      logoRoles.push({ fileId, role });
    } else {
      stored.push(fileId);
    }
  }
  return { logoFileIds, stored, logoRoles };
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

export const normalizeBrandProfile = (brand: Record<string, any>): BrandKit => {
  const palette = normalizePalette(brand.palette);
  const logos = normalizeLogoFiles(brand.logoFileIds);
  return {
    ...brand,
    palette: palette.palette,
    ...(palette.colorRoles.length ? { colorRoles: palette.colorRoles } : {}),
    fontFamilies: normalizeStrings(brand.fontFamilies, 'name'),
    preferredFormats: normalizePreferredFormats(brand.preferredFormats),
    customFonts: Array.isArray(brand.customFonts) ? brand.customFonts : [],
    logoFileIds: logos.logoFileIds,
    ...(logos.logoRoles.length ? { logoRoles: logos.logoRoles } : {}),
    assets: Array.isArray(brand.assets) ? brand.assets : [],
  } as BrandKit;
};

export const normalizeBrandProfilePatch = (patch: BrandProfileInput): BrandProfileWrite => {
  const normalized = { ...patch } as BrandProfileWrite;
  if (patch.palette !== undefined) normalized.palette = normalizePalette(patch.palette, true).stored;
  if (patch.logoFileIds !== undefined) normalized.logoFileIds = normalizeLogoFiles(patch.logoFileIds, true).stored;
  if (patch.fontFamilies !== undefined) {
    normalized.fontFamilies = normalizeStrings(patch.fontFamilies, 'name');
  }
  if (patch.preferredFormats !== undefined) {
    normalized.preferredFormats = validatePreferredFormats(patch.preferredFormats);
  }
  return normalized;
};
