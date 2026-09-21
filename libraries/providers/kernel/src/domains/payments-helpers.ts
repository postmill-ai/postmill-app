import { PaymentsPeriod, PaymentsTier } from './payments';

const PERIOD_SUFFIX: Record<PaymentsPeriod, string> = {
  MONTHLY: 'monthly',
  YEARLY: 'yearly',
};

/**
 * Store product id convention shared by the App Store and Google Play adapters:
 * `<prefix>.<tier>.<monthly|yearly>` → `postmill.pro.monthly`. Operators
 * override the prefix per store (`PAYMENTS_APPLE_PRODUCT_PREFIX`,
 * `PAYMENTS_GOOGLE_PRODUCT_PREFIX`); the tier/period suffix is fixed so the
 * server can map a product back to `pricing.ts` without a lookup table.
 */
export function storeProductId(
  prefix: string,
  tier: PaymentsTier,
  period: PaymentsPeriod,
): string {
  return `${prefix}.${tier.toLowerCase()}.${PERIOD_SUFFIX[period]}`;
}

export function parseStoreProductId(
  prefix: string,
  productId: string,
): { tier: PaymentsTier; period: PaymentsPeriod } | null {
  if (!productId.startsWith(`${prefix}.`)) {
    return null;
  }
  const rest = productId.slice(prefix.length + 1).split('.');
  if (rest.length !== 2) {
    return null;
  }
  const tier = rest[0].toUpperCase() as PaymentsTier;
  const period = (Object.keys(PERIOD_SUFFIX) as PaymentsPeriod[]).find(
    (p) => PERIOD_SUFFIX[p] === rest[1],
  );
  if (!['STARTER', 'PRO', 'TEAM', 'AGENCY'].includes(tier) || !period) {
    return null;
  }
  return { tier, period };
}
