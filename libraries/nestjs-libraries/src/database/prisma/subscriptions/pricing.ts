export interface PlanInterface {
  current: 'STARTER' | 'PRO' | 'TEAM' | 'AGENCY';
  month_price: number;
  year_price: number;
  channel: number;
  posts_per_month: number;
  team_members: number;
  brand_kits: number;
  campaigns: boolean;
  api: boolean;
  mcp: boolean;
  webhooks: number;
  competitors: number;
  analytics_retention_days: number;
  video_exports: number;
  storage_gb: number;
  byo_storage: boolean;
  priority: boolean;
}

export interface PricingInterface {
  [key: string]: PlanInterface;
}

export const SELF_HOST_PLAN = 'AGENCY';

export type AddonType =
  | 'storage'
  | 'video_exports'
  | 'channels'
  | 'team_seats'
  | 'posts'
  | 'brand_kits'
  | 'webhooks'
  | 'competitors';

/** Subscription `extra*` column holding the purchased amount for an add-on. */
export type AddonExtraColumn =
  | 'extraStorageGb'
  | 'extraVideoExports'
  | 'extraChannels'
  | 'extraTeamMembers'
  | 'extraPosts'
  | 'extraBrandKits'
  | 'extraWebhooks'
  | 'extraCompetitors';

/** Numeric PlanInterface limit an add-on raises. */
export type AddonLimitKey =
  | 'storage_gb'
  | 'video_exports'
  | 'channel'
  | 'team_members'
  | 'posts_per_month'
  | 'brand_kits'
  | 'webhooks'
  | 'competitors';

export interface AddonDefinition {
  column: AddonExtraColumn;
  limitKey: AddonLimitKey;
  productName: string;
  packSizeEnv: string;
  defaultPackSize: number;
  priceCentsEnv: string;
  defaultPriceCents: number;
}

export const ADDONS = {
  storage: {
    column: 'extraStorageGb',
    limitKey: 'storage_gb',
    productName: 'Postmill Extra Storage',
    packSizeEnv: 'ADDON_STORAGE_GB_PER_PACK',
    defaultPackSize: 25,
    priceCentsEnv: 'ADDON_STORAGE_PRICE_CENTS',
    defaultPriceCents: 1900,
  },
  video_exports: {
    column: 'extraVideoExports',
    limitKey: 'video_exports',
    productName: 'Postmill Extra Video Exports',
    packSizeEnv: 'ADDON_VIDEO_EXPORTS_PER_PACK',
    defaultPackSize: 50,
    priceCentsEnv: 'ADDON_VIDEO_EXPORTS_PRICE_CENTS',
    defaultPriceCents: 1900,
  },
  channels: {
    column: 'extraChannels',
    limitKey: 'channel',
    productName: 'Postmill Extra Channels',
    packSizeEnv: 'ADDON_CHANNELS_PER_PACK',
    defaultPackSize: 5,
    priceCentsEnv: 'ADDON_CHANNELS_PRICE_CENTS',
    defaultPriceCents: 1900,
  },
  team_seats: {
    column: 'extraTeamMembers',
    limitKey: 'team_members',
    productName: 'Postmill Extra Team Seats',
    packSizeEnv: 'ADDON_TEAM_SEATS_PER_PACK',
    defaultPackSize: 5,
    priceCentsEnv: 'ADDON_TEAM_SEATS_PRICE_CENTS',
    defaultPriceCents: 1500,
  },
  posts: {
    column: 'extraPosts',
    limitKey: 'posts_per_month',
    productName: 'Postmill Extra Posts',
    packSizeEnv: 'ADDON_POSTS_PER_PACK',
    defaultPackSize: 500,
    priceCentsEnv: 'ADDON_POSTS_PRICE_CENTS',
    defaultPriceCents: 900,
  },
  brand_kits: {
    column: 'extraBrandKits',
    limitKey: 'brand_kits',
    productName: 'Postmill Extra Brand Kits',
    packSizeEnv: 'ADDON_BRAND_KITS_PER_PACK',
    defaultPackSize: 5,
    priceCentsEnv: 'ADDON_BRAND_KITS_PRICE_CENTS',
    defaultPriceCents: 900,
  },
  webhooks: {
    column: 'extraWebhooks',
    limitKey: 'webhooks',
    productName: 'Postmill Extra Webhooks',
    packSizeEnv: 'ADDON_WEBHOOKS_PER_PACK',
    defaultPackSize: 10,
    priceCentsEnv: 'ADDON_WEBHOOKS_PRICE_CENTS',
    defaultPriceCents: 900,
  },
  competitors: {
    column: 'extraCompetitors',
    limitKey: 'competitors',
    productName: 'Postmill Extra Competitors',
    packSizeEnv: 'ADDON_COMPETITORS_PER_PACK',
    defaultPackSize: 10,
    priceCentsEnv: 'ADDON_COMPETITORS_PRICE_CENTS',
    defaultPriceCents: 900,
  },
} as const satisfies Record<AddonType, AddonDefinition>;

export function addonPackSize(type: AddonType): number {
  const { packSizeEnv, defaultPackSize } = ADDONS[type];
  const parsed = Number(process.env[packSizeEnv]);
  // Unset (NaN), zero, negative, or garbage env → documented default, never
  // NaN/0 propagating into limit math.
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultPackSize;
}

/**
 * Server-side only: in a browser bundle dynamic `process.env` reads are not
 * inlined, so this silently returns the default. Frontend must use the
 * statically-referenced NEXT_PUBLIC_ADDON_* mirrors instead.
 */
export function addonPriceCents(type: AddonType): number {
  const { priceCentsEnv, defaultPriceCents } = ADDONS[type];
  const parsed = Number(process.env[priceCentsEnv]);
  // Same guard — a $0 or NaN Stripe price must never be created.
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultPriceCents;
}

export const pricing: PricingInterface = {
  STARTER: {
    current: 'STARTER',
    month_price: 9,
    year_price: 90,
    channel: 3,
    posts_per_month: 100,
    team_members: 1,
    brand_kits: 0,
    campaigns: false,
    api: false,
    mcp: false,
    webhooks: 1,
    competitors: 1,
    analytics_retention_days: 180,
    video_exports: 15,
    storage_gb: 1,
    byo_storage: false,
    priority: false,
  },
  PRO: {
    current: 'PRO',
    month_price: 29,
    year_price: 290,
    channel: 10,
    posts_per_month: 1000000,
    team_members: 3,
    brand_kits: 2,
    campaigns: true,
    api: true,
    mcp: true,
    webhooks: 5,
    competitors: 5,
    analytics_retention_days: 548,
    video_exports: 60,
    storage_gb: 5,
    byo_storage: false,
    priority: false,
  },
  TEAM: {
    current: 'TEAM',
    month_price: 99,
    year_price: 990,
    channel: 30,
    posts_per_month: 1000000,
    team_members: 10,
    brand_kits: 10,
    campaigns: true,
    api: true,
    mcp: true,
    webhooks: 20,
    competitors: 20,
    analytics_retention_days: 548,
    video_exports: 200,
    storage_gb: 20,
    byo_storage: true,
    priority: false,
  },
  AGENCY: {
    current: 'AGENCY',
    month_price: 249,
    year_price: 2490,
    channel: 100,
    posts_per_month: 1000000,
    team_members: 25,
    brand_kits: 1000000,
    campaigns: true,
    api: true,
    mcp: true,
    webhooks: 1000000,
    competitors: 50,
    analytics_retention_days: 548,
    video_exports: 600,
    storage_gb: 100,
    byo_storage: true,
    priority: true,
  },
};
