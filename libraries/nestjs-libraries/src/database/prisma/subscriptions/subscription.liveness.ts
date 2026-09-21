/** Slack after `cancelAt` before a row counts as lapsed — the same day the expiry cron waits. */
export const CANCEL_AT_SLACK_MS = 24 * 60 * 60 * 1000;

export interface SubscriptionLivenessColumns {
  gracePeriodEnd?: Date | null;
  cancelAt?: Date | null;
  deletedAt?: Date | null;
}

/**
 * A subscription row still entitles its org: it exists, is not soft-deleted, its
 * dunning grace window (if any) has not lapsed, and its scheduled end (if any) is
 * not more than a day in the past. A period-end-cancelled row is live until then.
 * Mirrors `PermissionsService.getPackageOptions` (grace) and
 * `PaymentsService.expireCanceledSubscriptions` (cancelAt); never asks the vendor.
 */
export function isSubscriptionLive(
  sub: SubscriptionLivenessColumns | null | undefined,
  now: Date = new Date()
): boolean {
  if (!sub || sub.deletedAt) return false;
  if (sub.gracePeriodEnd && sub.gracePeriodEnd.getTime() < now.getTime()) return false;
  if (sub.cancelAt && sub.cancelAt.getTime() + CANCEL_AT_SLACK_MS < now.getTime()) return false;
  return true;
}
