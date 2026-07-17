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

export type AddonType = 'storage' | 'video_exports';

export const ADDONS = {
  storage: {
    priceCents: 1900,
    productName: 'Postmill Extra Storage',
    packSizeEnv: 'ADDON_STORAGE_GB_PER_PACK',
    defaultPackSize: 25,
  },
  video_exports: {
    priceCents: 1900,
    productName: 'Postmill Extra Video Exports',
    packSizeEnv: 'ADDON_VIDEO_EXPORTS_PER_PACK',
    defaultPackSize: 50,
  },
} as const satisfies Record<
  AddonType,
  {
    priceCents: number;
    productName: string;
    packSizeEnv: string;
    defaultPackSize: number;
  }
>;

export function addonPackSize(type: AddonType): number {
  const { packSizeEnv, defaultPackSize } = ADDONS[type];
  return Number(process.env[packSizeEnv] || defaultPackSize);
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
