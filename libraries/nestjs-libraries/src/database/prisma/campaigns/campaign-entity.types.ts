import { CampaignEntityType } from '@prisma/client';

// Frontend-friendly slugs used in URLs/selector props ↔ the Prisma enum.
export const ENTITY_SLUG_TO_ENUM: Record<string, CampaignEntityType> = {
  post: 'POST',
  channel: 'INTEGRATION',
  vpn: 'ORG_VPN_CONFIG',
  llm: 'AI_ORG_PROVIDER_CONFIG',
  brand: 'AI_BRAND_PROFILE',
  storage: 'STORAGE_PROVIDER_CONFIG',
  file: 'FILE',
  set: 'SETS',
  signature: 'SIGNATURES',
};

export const ENTITY_ENUM_TO_SLUG: Record<CampaignEntityType, string> = Object.entries(
  ENTITY_SLUG_TO_ENUM
).reduce((acc, [slug, en]) => ({ ...acc, [en]: slug }), {} as Record<CampaignEntityType, string>);

export const ENTITY_SLUGS = Object.keys(ENTITY_SLUG_TO_ENUM);

export function slugToEnum(slug: string): CampaignEntityType | undefined {
  return ENTITY_SLUG_TO_ENUM[slug];
}

export interface ResolvedItem {
  id: string;
  name: string;
  icon?: string; // a provider identifier or image path the UI can render
  subtitle?: string;
}

export interface ResolvedCampaignItem extends ResolvedItem {
  entityType: string; // slug
  taggedAt?: Date;
}
