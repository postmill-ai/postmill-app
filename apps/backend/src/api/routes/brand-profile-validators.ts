import { ValidateBy } from 'class-validator';
import {
  BRAND_COLOR_ROLES,
  BRAND_LOGO_ROLES,
} from '@postmill-ai/nestjs-libraries/brands/brand-kit';

const isObject = (entry: unknown): entry is Record<string, unknown> =>
  !!entry && typeof entry === 'object' && !Array.isArray(entry);

const hasOnlyKeys = (entry: Record<string, unknown>, keys: string[]) =>
  Object.keys(entry).every((key) => keys.includes(key));

const validString = (value: unknown) => value === undefined || typeof value === 'string';

const isPalette = (value: unknown) => Array.isArray(value) && value.every((entry) =>
  typeof entry === 'string' || (
    isObject(entry) &&
    hasOnlyKeys(entry, ['name', 'hex', 'role']) &&
    validString(entry.name) &&
    validString(entry.hex) &&
    (entry.role === undefined || BRAND_COLOR_ROLES.includes(entry.role as typeof BRAND_COLOR_ROLES[number]))
  )
);

const isLogoFiles = (value: unknown) => Array.isArray(value) && value.every((entry) =>
  typeof entry === 'string' || (
    isObject(entry) &&
    hasOnlyKeys(entry, ['fileId', 'role']) &&
    typeof entry.fileId === 'string' &&
    (entry.role === undefined || BRAND_LOGO_ROLES.includes(entry.role as typeof BRAND_LOGO_ROLES[number]))
  )
);

export const IsBrandPalette = () => ValidateBy({
  name: 'isBrandPalette',
  validator: {
    validate: isPalette,
    defaultMessage: () => 'palette must contain color strings or valid named color-role entries',
  },
});

export const IsBrandLogoFileIds = () => ValidateBy({
  name: 'isBrandLogoFileIds',
  validator: {
    validate: isLogoFiles,
    defaultMessage: () => 'logoFileIds must contain file ID strings or valid logo-role entries',
  },
});
