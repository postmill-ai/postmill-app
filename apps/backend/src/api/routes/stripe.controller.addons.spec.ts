import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mutable singleton so tests can change Stripe responses while the module-level
// `stripe` instance inside StripeService points at the same object.
const mockStripe = {
  subscriptions: {
    list: vi.fn().mockResolvedValue({ data: [] }),
  },
};

vi.mock('stripe', () => {
  return {
    default: class MockStripe {
      subscriptions = mockStripe.subscriptions;
    },
  };
});

import { StripeController } from './stripe.controller';
import type { StripeService as StripeServiceType } from '@postmill-ai/nestjs-libraries/services/stripe.service';
import type { AddonType } from '@postmill-ai/nestjs-libraries/database/prisma/subscriptions/pricing';

// ---------------------------------------------------------------------------
// Add-on webhook tests: customer.subscription.updated with addon metadata
// routes to syncAddonQuantities, which writes the extra* column for each of
// the 8 add-on types (packs * pack size, 0 for types with no active sub).
// ---------------------------------------------------------------------------

const ZERO_QUANTITIES = {
  extraStorageGb: 0,
  extraVideoExports: 0,
  extraChannels: 0,
  extraTeamMembers: 0,
  extraPosts: 0,
  extraBrandKits: 0,
  extraWebhooks: 0,
  extraCompetitors: 0,
};

function addonEvent(type: AddonType, quantity: number) {
  return {
    id: 'evt_addon',
    type: 'customer.subscription.updated',
    data: {
      object: {
        customer: 'cus_1',
        metadata: { service: 'postmill', addon: type },
        items: { data: [{ quantity }] },
      },
    },
  };
}

function makeController() {
  const recorded = new Set<string>();
  const stripeService = {
    validateRequest: vi.fn(),
    syncAddonQuantities: vi.fn().mockResolvedValue({ ok: true }),
    createSubscription: vi.fn().mockResolvedValue({ ok: true }),
    updateSubscription: vi.fn().mockResolvedValue({ ok: true }),
    deleteSubscription: vi.fn().mockResolvedValue({ ok: true }),
    paymentSucceeded: vi.fn().mockResolvedValue({ ok: true }),
    paymentFailed: vi.fn().mockResolvedValue({ ok: true }),
    isEventProcessed: vi.fn(async (id: string) => recorded.has(id)),
    recordEvent: vi.fn(async (id: string) => {
      recorded.add(id);
    }),
  };

  const controller = new StripeController(stripeService as unknown as StripeServiceType);
  return { controller, stripeService, recorded };
}

function req(rawBody = Buffer.from('{}')) {
  return { rawBody, headers: { 'stripe-signature': 'sig' } } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockStripe.subscriptions.list.mockReset().mockResolvedValue({ data: [] });
  process.env.ADDON_STORAGE_GB_PER_PACK = '25';
  process.env.ADDON_VIDEO_EXPORTS_PER_PACK = '50';
  process.env.ADDON_CHANNELS_PER_PACK = '5';
});

describe('StripeController — add-on subscription webhooks', () => {
  it('routes storage addon updates to syncAddonQuantities', async () => {
    const { controller, stripeService } = makeController();
    const event = addonEvent('storage', 2);
    stripeService.validateRequest.mockReturnValue(event);

    await controller.stripe(req());

    expect(stripeService.syncAddonQuantities).toHaveBeenCalledTimes(1);
    expect(stripeService.syncAddonQuantities).toHaveBeenCalledWith('cus_1');
    expect(stripeService.updateSubscription).not.toHaveBeenCalled();
    expect(stripeService.recordEvent).toHaveBeenCalledWith('evt_addon', 'customer.subscription.updated');
  });

  it('routes video_exports addon updates to syncAddonQuantities', async () => {
    const { controller, stripeService } = makeController();
    const event = addonEvent('video_exports', 3);
    stripeService.validateRequest.mockReturnValue(event);

    await controller.stripe(req());

    expect(stripeService.syncAddonQuantities).toHaveBeenCalledTimes(1);
    expect(stripeService.syncAddonQuantities).toHaveBeenCalledWith('cus_1');
  });

  it('routes any of the 8 addon types (e.g. channels) to syncAddonQuantities', async () => {
    const { controller, stripeService } = makeController();
    const event = addonEvent('channels', 2);
    stripeService.validateRequest.mockReturnValue(event);

    await controller.stripe(req());

    expect(stripeService.syncAddonQuantities).toHaveBeenCalledTimes(1);
    expect(stripeService.syncAddonQuantities).toHaveBeenCalledWith('cus_1');
    expect(stripeService.updateSubscription).not.toHaveBeenCalled();
  });

  it('ignores addon events without postmill metadata', async () => {
    const { controller, stripeService } = makeController();
    stripeService.validateRequest.mockReturnValue({
      id: 'evt_other',
      type: 'customer.subscription.updated',
      data: {
        object: {
          customer: 'cus_1',
          metadata: { service: 'something-else', addon: 'storage' },
        },
      },
    });

    const result = await controller.stripe(req());

    expect(result).toEqual({ ok: true });
    expect(stripeService.syncAddonQuantities).not.toHaveBeenCalled();
    expect(stripeService.isEventProcessed).not.toHaveBeenCalled();
  });
});

describe('StripeService — syncAddonQuantities', () => {
  it('writes extraStorageGb = 2 * ADDON_STORAGE_GB_PER_PACK', async () => {
    const { StripeService } = await import(
      '@postmill-ai/nestjs-libraries/services/stripe.service'
    );

    mockStripe.subscriptions.list.mockResolvedValue({
      data: [
        {
          status: 'active',
          metadata: { addon: 'storage' },
          items: { data: [{ quantity: 2 }] },
        },
      ],
    });

    const subscriptionService = {
      updateAddonQuantities: vi.fn().mockResolvedValue({ count: 1 }),
    };
    const organizationService = {
      getOrgByCustomerId: vi.fn().mockResolvedValue({ id: 'org-1' }),
    };

    const service = new StripeService(
      subscriptionService as any,
      organizationService as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );

    await service.syncAddonQuantities('cus_1');

    expect(subscriptionService.updateAddonQuantities).toHaveBeenCalledWith('org-1', {
      ...ZERO_QUANTITIES,
      extraStorageGb: 50,
    });
  });

  it('writes extraVideoExports = 3 * ADDON_VIDEO_EXPORTS_PER_PACK', async () => {
    const { StripeService } = await import(
      '@postmill-ai/nestjs-libraries/services/stripe.service'
    );

    mockStripe.subscriptions.list.mockResolvedValue({
      data: [
        {
          status: 'active',
          metadata: { addon: 'video_exports' },
          items: { data: [{ quantity: 3 }] },
        },
      ],
    });

    const subscriptionService = {
      updateAddonQuantities: vi.fn().mockResolvedValue({ count: 1 }),
    };
    const organizationService = {
      getOrgByCustomerId: vi.fn().mockResolvedValue({ id: 'org-1' }),
    };

    const service = new StripeService(
      subscriptionService as any,
      organizationService as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );

    await service.syncAddonQuantities('cus_1');

    expect(subscriptionService.updateAddonQuantities).toHaveBeenCalledWith('org-1', {
      ...ZERO_QUANTITIES,
      extraVideoExports: 150,
    });
  });

  it('aggregates quantities across multiple addon subscriptions', async () => {
    const { StripeService } = await import(
      '@postmill-ai/nestjs-libraries/services/stripe.service'
    );

    mockStripe.subscriptions.list.mockResolvedValue({
      data: [
        {
          status: 'active',
          metadata: { addon: 'storage' },
          items: { data: [{ quantity: 1 }] },
        },
        {
          status: 'trialing',
          metadata: { addon: 'storage' },
          items: { data: [{ quantity: 1 }] },
        },
        {
          status: 'active',
          metadata: { addon: 'video_exports' },
          items: { data: [{ quantity: 2 }] },
        },
      ],
    });

    const subscriptionService = {
      updateAddonQuantities: vi.fn().mockResolvedValue({ count: 1 }),
    };
    const organizationService = {
      getOrgByCustomerId: vi.fn().mockResolvedValue({ id: 'org-1' }),
    };

    const service = new StripeService(
      subscriptionService as any,
      organizationService as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );

    await service.syncAddonQuantities('cus_1');

    expect(subscriptionService.updateAddonQuantities).toHaveBeenCalledWith('org-1', {
      ...ZERO_QUANTITIES,
      extraStorageGb: 50,
      extraVideoExports: 100,
    });
  });

  it('writes the correct columns for a multi-type customer (storage + channels)', async () => {
    const { StripeService } = await import(
      '@postmill-ai/nestjs-libraries/services/stripe.service'
    );

    mockStripe.subscriptions.list.mockResolvedValue({
      data: [
        {
          status: 'active',
          metadata: { addon: 'storage' },
          items: { data: [{ quantity: 2 }] },
        },
        {
          status: 'active',
          metadata: { addon: 'channels' },
          items: { data: [{ quantity: 3 }] },
        },
      ],
    });

    const subscriptionService = {
      updateAddonQuantities: vi.fn().mockResolvedValue({ count: 1 }),
    };
    const organizationService = {
      getOrgByCustomerId: vi.fn().mockResolvedValue({ id: 'org-1' }),
    };

    const service = new StripeService(
      subscriptionService as any,
      organizationService as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );

    await service.syncAddonQuantities('cus_1');

    expect(subscriptionService.updateAddonQuantities).toHaveBeenCalledWith('org-1', {
      ...ZERO_QUANTITIES,
      extraStorageGb: 50,
      extraChannels: 15,
    });
  });

  it('returns early when the customer has no org', async () => {
    const { StripeService } = await import(
      '@postmill-ai/nestjs-libraries/services/stripe.service'
    );

    const subscriptionService = {
      updateAddonQuantities: vi.fn(),
    };
    const organizationService = {
      getOrgByCustomerId: vi.fn().mockResolvedValue(null),
    };

    const service = new StripeService(
      subscriptionService as any,
      organizationService as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );

    const result = await service.syncAddonQuantities('cus_no_org');

    expect(result).toEqual({ ok: true });
    expect(subscriptionService.updateAddonQuantities).not.toHaveBeenCalled();
  });
});
