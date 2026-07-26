import { ADDONS, PlanInterface } from './pricing';

/**
 * Numeric PlanInterface limits a super-admin may override via
 * `Subscription.limitOverrides`. `analytics_retention_days` is deliberately
 * excluded (data-lifecycle decision, not a purchasable quota).
 */
export const OVERRIDABLE_LIMIT_KEYS = [
  'channel',
  'team_members',
  'posts_per_month',
  'brand_kits',
  'webhooks',
  'competitors',
  'storage_gb',
  'video_exports',
] as const;

export type OverridableLimitKey = (typeof OVERRIDABLE_LIMIT_KEYS)[number];

/** The Subscription columns that feed the effective-limits merge. */
export interface SubscriptionLimitColumns {
  totalChannels: number;
  extraStorageGb: number;
  extraVideoExports: number;
  extraChannels: number;
  extraTeamMembers: number;
  extraPosts: number;
  extraBrandKits: number;
  extraWebhooks: number;
  extraCompetitors: number;
  limitOverrides?: unknown;
}

/**
 * Single merge point for plan limits: base plan + add-on extras + manual
 * overrides. Pure — safe to call from permissions gates, storage quota,
 * channel-enable, and dashboard usage alike.
 *
 * Channels are special: `getPackageOptions` forces `options.channel` to -10
 * when a subscription exists (the persisted `totalChannels` column is the
 * real base), so the channel value is always rebuilt from the subscription.
 * Overrides win last and replace base+add-ons entirely.
 */
export function mergeEffectiveLimits(
  base: PlanInterface,
  subscription: SubscriptionLimitColumns | null | undefined
): PlanInterface {
  const options: PlanInterface = { ...base };

  if (subscription) {
    for (const type of Object.keys(ADDONS) as (keyof typeof ADDONS)[]) {
      const { column, limitKey } = ADDONS[type];
      if (limitKey === 'channel') {
        continue; // handled below — base.channel may be the -10 sentinel
      }
      options[limitKey] += Number(subscription[column] ?? 0);
    }
    options.channel =
      subscription.totalChannels + Number(subscription.extraChannels ?? 0);

    const overrides = subscription.limitOverrides;
    if (overrides && typeof overrides === 'object' && !Array.isArray(overrides)) {
      for (const key of OVERRIDABLE_LIMIT_KEYS) {
        const value = (overrides as Record<string, unknown>)[key];
        if (typeof value === 'number' && Number.isFinite(value)) {
          options[key] = value;
        }
      }
    }
  }

  return options;
}
