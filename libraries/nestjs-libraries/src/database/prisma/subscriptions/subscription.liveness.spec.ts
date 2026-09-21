import { describe, it, expect } from 'vitest';
import { CANCEL_AT_SLACK_MS, isSubscriptionLive } from './subscription.liveness';

const now = new Date('2026-09-21T12:00:00Z');
const ago = (ms: number) => new Date(now.getTime() - ms);
const ahead = (ms: number) => new Date(now.getTime() + ms);
const HOUR = 3600 * 1000;

describe('isSubscriptionLive', () => {
  it('is false for a missing or soft-deleted row', () => {
    expect(isSubscriptionLive(null, now)).toBe(false);
    expect(isSubscriptionLive(undefined, now)).toBe(false);
    expect(isSubscriptionLive({ deletedAt: ago(HOUR) }, now)).toBe(false);
  });

  it('is true for a plain row and for grace / cancelAt still in the future', () => {
    expect(isSubscriptionLive({}, now)).toBe(true);
    expect(isSubscriptionLive({ gracePeriodEnd: ahead(HOUR) }, now)).toBe(true);
    expect(isSubscriptionLive({ cancelAt: ahead(HOUR) }, now)).toBe(true);
  });

  it('is false once the dunning grace window lapsed', () => {
    expect(isSubscriptionLive({ gracePeriodEnd: ago(1) }, now)).toBe(false);
  });

  it('keeps a period-end-cancelled row live for one day of slack, then lapses it', () => {
    expect(isSubscriptionLive({ cancelAt: ago(CANCEL_AT_SLACK_MS - HOUR) }, now)).toBe(true);
    expect(isSubscriptionLive({ cancelAt: ago(2 * CANCEL_AT_SLACK_MS) }, now)).toBe(false);
  });
});
