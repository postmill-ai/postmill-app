import { z } from 'zod';

/**
 * Runtime schemas for the JSON columns on AIBrandProfile.
 * Kept in lockstep with schema.prisma defaults and the controller DTO.
 */

export const PlatformInstructionsSchema = z.record(z.string()).default({});

export const LanguageProfileSchema = z.object({
  instructions: z.string().optional(),
  overrides: z.record(z.string()).optional(),
});

export const LanguageProfilesSchema = z.record(LanguageProfileSchema).default({});

export const LogoFileIdsSchema = z.array(z.string()).default([]);

export const PaletteEntrySchema = z.object({
  name: z.string().optional(),
  hex: z.string().optional(),
});

export const PaletteSchema = z.array(PaletteEntrySchema).default([]);

export const FontFamilySchema = z.object({
  name: z.string().optional(),
  fallback: z.string().optional(),
});

export const FontFamiliesSchema = z.array(FontFamilySchema).default([]);

export const CustomFontSchema = z.object({
  fileId: z.string(),
  family: z.string().optional(),
});

export const CustomFontsSchema = z.array(CustomFontSchema).default([]);

export const EnforcementRuleSchema = z.object({
  type: z.string().optional(),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
});

export const EnforcementSchema = z.record(z.union([z.string(), z.boolean(), z.array(EnforcementRuleSchema)])).default({});

export const BrandAssetSchema = z.object({
  fileId: z.string(),
  url: z.string().optional(),
  caption: z.string().optional(),
});

export const BrandAssetsSchema = z.array(BrandAssetSchema).default([]);

export const UpsertBrandProfileDataSchema = z.object({
  instructions: z.string().optional(),
  language: z.string().optional(),
  enabled: z.boolean().optional(),
  name: z.string().optional(),
  slug: z.string().optional(),
  platformInstructions: PlatformInstructionsSchema.optional(),
  languageProfiles: LanguageProfilesSchema.optional(),
  logoFileIds: LogoFileIdsSchema.optional(),
  palette: PaletteSchema.optional(),
  fontFamilies: FontFamiliesSchema.optional(),
  customFonts: CustomFontsSchema.optional(),
  enforcement: EnforcementSchema.optional(),
  assets: BrandAssetsSchema.optional(),
});

export type UpsertBrandProfileData = z.infer<typeof UpsertBrandProfileDataSchema>;

/**
 * Validate and coerce the raw brand-profile payload.
 * Throws a ZodError on invalid JSON shapes.
 */
export function validateBrandProfileData(data: unknown): UpsertBrandProfileData {
  return UpsertBrandProfileDataSchema.parse(data);
}
