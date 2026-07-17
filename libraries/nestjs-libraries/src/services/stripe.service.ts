import Stripe from 'stripe';
import { Injectable, Logger } from '@nestjs/common';
import { Organization, User } from '@prisma/client';
import { BillingTier, SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { BillingSubscribeDto } from '@gitroom/nestjs-libraries/dtos/billing/billing.subscribe.dto';
import {
  pricing,
  ADDONS,
  addonPackSize,
} from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { TrackService } from '@gitroom/nestjs-libraries/track/track.service';
import { UsersService } from '@gitroom/nestjs-libraries/database/prisma/users/users.service';
import { TrackEnum } from '@gitroom/nestjs-libraries/user/track.enum';
// layering: sanctioned leaf-read — StripeEventRepository lives in the subscriptions
// domain, but SubscriptionService does not depend on StripeService, and these are
// narrow Stripe-webhook idempotency/grace reads with no service-level cycle.
import { StripeEventRepository } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/stripe-event.repository';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import { AuditService } from '@gitroom/nestjs-libraries/database/prisma/audit/audit.service';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_nothing');

@Injectable()
export class StripeService {
  private readonly _logger = new Logger(StripeService.name);
  // Dunning grace window (C2): how long after a payment failure we keep channels live
  // before the terminal subscription.deleted teardown.
  private readonly GRACE_PERIOD_DAYS = 7;
  constructor(
    private _subscriptionService: SubscriptionService,
    private _organizationService: OrganizationService,
    private _userService: UsersService,
    private _trackService: TrackService,
    // layering: sanctioned leaf-read — see import comment above.
    private _stripeEventRepository: StripeEventRepository,
    private _notificationService: NotificationService,
    private _audit: AuditService
  ) {}
  validateRequest(rawBody: Buffer, signature: string, endpointSecret: string) {
    return stripe.webhooks.constructEvent(rawBody, signature, endpointSecret);
  }

  // Idempotency (C1): Stripe redelivers events; check whether we've already processed
  // this event.id before running the subscription transition again.
  async isEventProcessed(id: string): Promise<boolean> {
    return this._stripeEventRepository.exists(id);
  }

  // Record a successfully processed Stripe event so redeliveries are ignored.
  async recordEvent(id: string, type: string): Promise<void> {
    return this._stripeEventRepository.record(id, type);
  }

  // F2(b): record a subscription state transition as a non-fatal audit event. Resolves
  // the org from the Stripe customer id; metadata carries only the new status (no secret).
  private async _auditSubscriptionChanged(customerId: string, status: string) {
    try {
      const org = await this._organizationService.getOrgByCustomerId(customerId);
      if (!org?.id) {
        return;
      }
      await this._audit.record({
        orgId: org.id,
        action: 'billing.subscription.changed',
        resource: 'subscription',
        metadata: { status },
      });
    } catch {
      /* non-fatal: auditing must never break webhook processing */
    }
  }

  async checkValidCard(
    event:
      | Stripe.CustomerSubscriptionCreatedEvent
      | Stripe.CustomerSubscriptionUpdatedEvent
  ) {
    if (event.data.object.status === 'incomplete') {
      return false;
    }

    const getOrgFromCustomer =
      await this._organizationService.getOrgByCustomerId(
        event.data.object.customer as string
      );

    if (!getOrgFromCustomer?.allowTrial) {
      return true;
    }

    this._logger.log('Checking card');

    const paymentMethods = await stripe.paymentMethods.list({
      customer: event.data.object.customer as string,
    });

    // find the last one created
    const latestMethod = paymentMethods.data.reduce(
      (prev, current) => {
        if (prev.created < current.created) {
          return current;
        }
        return prev;
      },
      { created: -100 } as Stripe.PaymentMethod
    );

    if (!latestMethod.id) {
      return false;
    }

    try {
      const paymentIntent = await stripe.paymentIntents.create({
        amount: 100,
        currency: 'usd',
        payment_method: latestMethod.id,
        customer: event.data.object.customer as string,
        off_session: true,
        capture_method: 'manual', // Authorize without capturing
        confirm: true, // Confirm the PaymentIntent
      });

      if (paymentIntent.status !== 'requires_capture') {
        this._logger.error('Cant charge');
        await stripe.paymentMethods.detach(paymentMethods.data[0].id);
        await stripe.subscriptions.cancel(event.data.object.id as string);
        return false;
      }

      await stripe.paymentIntents.cancel(paymentIntent.id as string);
      return true;
    } catch (err) {
      try {
        await stripe.paymentMethods.detach(paymentMethods.data[0].id);
        await stripe.subscriptions.cancel(event.data.object.id as string);
      } catch (err) {
        /*dont do anything*/
      }
      return false;
    }
  }

  async createSubscription(event: Stripe.CustomerSubscriptionCreatedEvent) {
    const {
      uniqueId,
      billing,
      period,
    } = event.data.object.metadata as {
      billing: BillingTier;
      period: 'MONTHLY' | 'YEARLY';
      uniqueId: string;
    };

    try {
      const check = await this.checkValidCard(event);
      if (!check) {
        return { ok: false };
      }
    } catch (err) {
      return { ok: false };
    }

    await this._auditSubscriptionChanged(
      event.data.object.customer as string,
      event.data.object.status
    );

    return this._subscriptionService.createOrUpdateSubscription(
      event.data.object.status !== 'active',
      uniqueId,
      event.data.object.customer as string,
      pricing[billing].channel!,
      billing,
      period,
      event.data.object.cancel_at
    );
  }
  // Dunning (C2): a past-due subscription enters a grace window + notifies the org
  // instead of tearing down channels. The terminal `subscription.deleted` still downgrades.
  private async _enterGracePeriod(customerId: string, subscriptionId?: string) {
    if (!customerId) {
      return { ok: true };
    }

    // Webhook-ordering guard (F5/I2): Stripe events are unordered snapshots — a
    // delayed past_due `subscription.updated` processed AFTER the recovery
    // payment would otherwise open a fresh 7-day window (the cleared marker
    // fails the re-entry guard below) and downgrade a fully-paid customer when
    // it lapses. Enter grace only when the LIVE subscription is genuinely
    // past_due. Events without a subscription id (one-off invoices) can't be
    // verified, so they open no window.
    if (!subscriptionId) {
      this._logger.warn(
        `Skipping grace window for customer ${customerId}: no subscription id to verify live status`
      );
      return { ok: true };
    }
    try {
      const live = await stripe.subscriptions.retrieve(subscriptionId);
      if (live.status !== 'past_due') {
        return { ok: true };
      }
    } catch (err) {
      // Unverifiable — skip rather than risk a wrongful window; Stripe's
      // redelivery will retry the transition.
      this._logger.warn(
        `Could not verify live status of subscription ${subscriptionId}: ${
          (err as Error)?.message ?? String(err)
        }`
      );
      return { ok: true };
    }

    const now = new Date();
    const existing = await this._stripeEventRepository.getGracePeriod(customerId);
    // Already inside an unexpired grace window — keep it; don't re-notify or tear down.
    if (existing && existing.getTime() > now.getTime()) {
      return { ok: true, grace: true };
    }

    const until = new Date(
      now.getTime() + this.GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000
    );
    await this._stripeEventRepository.setGracePeriod(customerId, until);

    const org = await this._organizationService.getOrgByCustomerId(customerId);
    if (org?.id) {
      try {
        await this._notificationService.notify({
          orgId: org.id,
          category: 'budget',
          title: 'Payment failed — action needed',
          message: `We couldn't process your latest payment. Please update your billing details before ${until.toDateString()} to keep your channels active.`,
          link: (process.env.FRONTEND_URL || '') + '/billing',
        });
      } catch (err) {
        this._logger.warn(
          `Failed to send dunning notification for customer ${customerId}: ${
            (err as Error)?.message ?? String(err)
          }`
        );
      }
    }

    return { ok: true, grace: true };
  }

  async paymentFailed(event: Stripe.InvoicePaymentFailedEvent) {
    const subscriptionId =
      event.data.object.parent?.subscription_details?.subscription;
    return this._enterGracePeriod(
      event.data.object.customer as string,
      typeof subscriptionId === 'string' ? subscriptionId : subscriptionId?.id
    );
  }

  async updateSubscription(event: Stripe.CustomerSubscriptionUpdatedEvent) {
    // Past-due: grant grace + notify rather than re-running the tier transition/teardown.
    if (event.data.object.status === 'past_due') {
      return this._enterGracePeriod(
        event.data.object.customer as string,
        event.data.object.id
      );
    }

    const {
      uniqueId,
      billing,
      period,
    } = event.data.object.metadata as {
      billing: BillingTier;
      period: 'MONTHLY' | 'YEARLY';
      uniqueId: string;
    };

    const check = await this.checkValidCard(event);
    if (!check) {
      return { ok: false };
    }

    // Dunning recovery (F5/I1): clear the grace marker ONLY when the
    // subscription genuinely recovered. This branch catches every non-past_due
    // status — clearing on `unpaid`/`canceled` would null the marker on a
    // dunning-exhausted sub and the entitlement gate would then never lapse it
    // (permanent paid access). Placed after checkValidCard: an invalid card
    // cancels the sub and must not clear anything.
    if (
      event.data.object.status === 'active' ||
      event.data.object.status === 'trialing'
    ) {
      await this._stripeEventRepository.setGracePeriod(
        event.data.object.customer as string,
        null
      );
    }

    await this._auditSubscriptionChanged(
      event.data.object.customer as string,
      event.data.object.status
    );

    return this._subscriptionService.createOrUpdateSubscription(
      event.data.object.status !== 'active',
      uniqueId,
      event.data.object.customer as string,
      pricing[billing].channel!,
      billing,
      period,
      event.data.object.cancel_at
    );
  }

  async deleteSubscription(event: Stripe.CustomerSubscriptionDeletedEvent) {
    await this._subscriptionService.deleteSubscription(
      event.data.object.customer as string
    );
    await this._auditSubscriptionChanged(
      event.data.object.customer as string,
      'deleted'
    );
  }

  async createOrGetCustomer(organization: Organization) {
    if (organization.paymentId) {
      return organization.paymentId;
    }

    const users = await this._organizationService.getTeam(organization.id);
    const email = users!.users[0].user.email;
    const customer = await stripe.customers.create({
      email: email.indexOf('@') > -1 ? email : `${email}@postiz.com`,
      name: organization.name,
    });
    await this._subscriptionService.updateCustomerId(
      organization.id,
      customer.id
    );
    return customer.id;
  }

  async getPackages() {
    // On instances without Stripe configured, the client is built with the placeholder
    // 'sk_nothing' key (see top of file), so any Stripe call returns 401 "Invalid API Key".
    // That 401 propagated to the Billing page and the frontend force-logs-out on *any* 401
    // (layout.context.tsx -> /auth/logout) — so simply opening Billing logged the user out of
    // the whole app. Short-circuit to empty packages, and never let a Stripe error become a 401.
    if (!process.env.STRIPE_SECRET_KEY) {
      return {};
    }

    // Prices are created dynamically from pricing.ts; the catalog is always the
    // current Postmill plan model.
    const plans = Object.entries(pricing).map(([name, plan]) => ({
      name,
      month: plan.month_price,
      year: plan.year_price,
    }));

    return {
      month: plans.map((p) => ({ name: p.name, recurring: 'month', price: p.month })),
      year: plans.map((p) => ({ name: p.name, recurring: 'year', price: p.year })),
    };
  }

  private static readonly TIER_RANK: Record<BillingTier, number> = {
    STARTER: 1,
    PRO: 2,
    TEAM: 3,
    AGENCY: 4,
  };

  private async _getBaseSubscription(customer: string) {
    const subs = (
      await stripe.subscriptions.list({
        customer,
        status: 'all',
        expand: ['data.items.data.price'],
      })
    ).data.filter(
      (f) =>
        f.status === 'active' ||
        f.status === 'trialing'
    );
    return subs.find((s) => !s.metadata?.addon);
  }

  private async _getAddonSubscriptions(customer: string) {
    const subs = (
      await stripe.subscriptions.list({
        customer,
        status: 'all',
      })
    ).data.filter(
      (f) =>
        f.status === 'active' ||
        f.status === 'trialing'
    );
    return subs.filter((s) => s.metadata?.addon);
  }

  private async _getOrCreatePrice(tier: BillingTier, period: 'MONTHLY' | 'YEARLY') {
    const priceData = pricing[tier];
    const allProducts = await stripe.products.list({ active: true });
    const findProduct =
      allProducts.data.find(
        (product) => product.name.toUpperCase() === tier.toUpperCase()
      ) ||
      (await stripe.products.create({
        active: true,
        name: tier,
        metadata: { service: 'postmill' },
      }));

    const pricesList = await stripe.prices.list({
      active: true,
      product: findProduct!.id,
    });

    return (
      pricesList.data.find(
        (p) =>
          p?.recurring?.interval?.toLowerCase() ===
            (period === 'MONTHLY' ? 'month' : 'year') &&
          p?.unit_amount ===
            (period === 'MONTHLY' ? priceData.month_price : priceData.year_price) *
              100
      ) ||
      (await stripe.prices.create({
        active: true,
        product: findProduct!.id,
        currency: 'usd',
        nickname: `${tier} ${period}`,
        unit_amount:
          (period === 'MONTHLY'
            ? priceData.month_price
            : priceData.year_price) * 100,
        recurring: {
          interval: period === 'MONTHLY' ? 'month' : 'year',
        },
        metadata: { service: 'postmill', tier },
      }))
    );
  }

  async changePlan(organizationId: string, userId: string, tier: BillingTier) {
    const currentSubscription =
      await this._subscriptionService.getSubscription(organizationId);
    const currentTier = currentSubscription?.subscriptionTier || 'STARTER';
    if (currentTier === tier) {
      return { ok: true };
    }

    const isUpgrade =
      StripeService.TIER_RANK[tier] > StripeService.TIER_RANK[currentTier];

    if (isUpgrade) {
      await this._subscriptionService.clearPendingTier(organizationId);
      const period = currentSubscription?.period || 'MONTHLY';
      return this.subscribe(
        makeId(10),
        organizationId,
        userId,
        { billing: tier, period } as BillingSubscribeDto,
        false
      );
    }

    // Downgrade: set pendingTier and update Stripe price so the next invoice
    // uses the lower-tier price. Limits stay on the current tier until renewal.
    const org = await this._organizationService.getOrgById(organizationId);
    const customer = await this.createOrGetCustomer(org!);
    const baseSub = await this._getBaseSubscription(customer);
    if (!baseSub) {
      throw new Error('No active base subscription to downgrade');
    }

    const period =
      (baseSub.items.data[0]?.price?.recurring?.interval === 'year'
        ? 'YEARLY'
        : 'MONTHLY') as 'MONTHLY' | 'YEARLY';
    const newPrice = await this._getOrCreatePrice(tier, period);

    // Preserve the existing identifier and keep `billing` as the current tier so
    // the next `customer.subscription.updated` webhook does not prune limits
    // before the renewal. The new Stripe price still ensures the next invoice
    // uses the lower-tier price.
    const uniqueId = baseSub.metadata?.uniqueId || makeId(10);
    await stripe.subscriptions.update(baseSub.id, {
      cancel_at_period_end: false,
      proration_behavior: 'none',
      items: [
        {
          id: baseSub.items.data[0].id,
          price: newPrice.id,
          quantity: 1,
        },
      ],
      metadata: {
        ...(baseSub.metadata || {}),
        service: 'postmill',
        billing: currentTier,
        period,
        uniqueId,
        pendingTier: tier,
      },
    });

    await this._subscriptionService.setPendingTier(organizationId, tier);
    return { pendingTier: tier };
  }

  async createOrUpdateAddon(
    organizationId: string,
    type: 'storage' | 'video_exports',
    packs: number
  ) {
    const org = await this._organizationService.getOrgById(organizationId);
    const customer = await this.createOrGetCustomer(org!);

    const existingAddons = await this._getAddonSubscriptions(customer);
    const existing = existingAddons.find((s) => s.metadata?.addon === type);

    if (existing) {
      await stripe.subscriptions.update(existing.id, {
        cancel_at_period_end: false,
        items: [
          {
            id: existing.items.data[0].id,
            quantity: Math.max(1, Math.floor(packs)),
          },
        ],
        metadata: { service: 'postmill', addon: type },
      });
    } else {
      const allProducts = await stripe.products.list({ active: true });
      const productName = ADDONS[type].productName;
      const findProduct =
        allProducts.data.find((p) => p.name === productName) ||
        (await stripe.products.create({
          active: true,
          name: productName,
          metadata: { service: 'postmill', addon: type },
        }));

      const pricesList = await stripe.prices.list({
        active: true,
        product: findProduct.id,
      });
      const findPrice =
        pricesList.data.find(
          (p) =>
            p.recurring?.interval === 'month' &&
            p.unit_amount === ADDONS[type].priceCents
        ) ||
        (await stripe.prices.create({
          active: true,
          product: findProduct.id,
          currency: 'usd',
          nickname: `${productName} monthly`,
          unit_amount: ADDONS[type].priceCents,
          recurring: { interval: 'month' },
          metadata: { service: 'postmill', addon: type },
        }));

      await stripe.subscriptions.create({
        customer,
        items: [{ price: findPrice.id, quantity: Math.max(1, Math.floor(packs)) }],
        metadata: { service: 'postmill', addon: type },
      });
    }

    // Write-through so the purchased capacity reflects immediately instead of waiting
    // for the customer.subscription webhook (which stays the reconciler). Recomputes
    // from Stripe's active add-on subs — idempotent.
    await this.syncAddonQuantities(customer);
    return { ok: true };
  }

  async cancelAddon(organizationId: string, type: 'storage' | 'video_exports') {
    const org = await this._organizationService.getOrgById(organizationId);
    const customer = await this.createOrGetCustomer(org!);
    const existingAddons = await this._getAddonSubscriptions(customer);
    const existing = existingAddons.find((s) => s.metadata?.addon === type);
    if (!existing) {
      return { ok: true };
    }
    await stripe.subscriptions.update(existing.id, {
      cancel_at_period_end: true,
      metadata: { service: 'postmill', addon: type },
    });
    // Cancel is period-end: the add-on stays active (and its capacity retained) until
    // then, so this recompute is a no-op today but keeps DB ↔ Stripe consistent.
    await this.syncAddonQuantities(customer);
    return { ok: true };
  }

  async syncAddonQuantities(customerId: string) {
    const org = await this._organizationService.getOrgByCustomerId(customerId);
    if (!org?.id) {
      return { ok: true };
    }

    const addonSubs = await this._getAddonSubscriptions(customerId);
    const quantities: Record<string, number> = {};
    for (const sub of addonSubs) {
      const type = sub.metadata?.addon;
      if (!type) continue;
      const qty = sub.items.data[0]?.quantity ?? 1;
      quantities[type] = (quantities[type] || 0) + qty;
    }

    const extraStorageGb =
      (quantities['storage'] || 0) * addonPackSize('storage');
    const extraVideoExports =
      (quantities['video_exports'] || 0) * addonPackSize('video_exports');

    await this._subscriptionService.updateAddonQuantities(org.id, {
      extraStorageGb,
      extraVideoExports,
    });

    return { ok: true };
  }

  async prorate(organizationId: string, body: BillingSubscribeDto) {
    const org = await this._organizationService.getOrgById(organizationId);
    const customer = await this.createOrGetCustomer(org!);
    const priceData = pricing[body.billing];
    const allProducts = await stripe.products.list({
      active: true,
      expand: ['data.prices'],
    });

    const findProduct =
      allProducts.data.find(
        (product) => product.name.toUpperCase() === body.billing.toUpperCase()
      ) ||
      (await stripe.products.create({
        active: true,
        name: body.billing,
      }));

    const pricesList = await stripe.prices.list({
      active: true,
      product: findProduct!.id,
    });

    const findPrice =
      pricesList.data.find(
        (p) =>
          p?.recurring?.interval?.toLowerCase() ===
            (body.period === 'MONTHLY' ? 'month' : 'year') &&
          p?.nickname === body.billing + ' ' + body.period &&
          p?.unit_amount ===
            (body.period === 'MONTHLY'
              ? priceData.month_price
              : priceData.year_price) *
              100
      ) ||
      (await stripe.prices.create({
        active: true,
        product: findProduct!.id,
        currency: 'usd',
        nickname: body.billing + ' ' + body.period,
        unit_amount:
          (body.period === 'MONTHLY'
            ? priceData.month_price
            : priceData.year_price) * 100,
        recurring: {
          interval: body.period === 'MONTHLY' ? 'month' : 'year',
        },
      }));

    const proration_date = Math.floor(Date.now() / 1000);

    const currentUserSubscription = {
      data: (
        await stripe.subscriptions.list({
          customer,
          status: 'all',
        })
      ).data.filter((f) => f.status === 'active' || f.status === 'trialing'),
    };

    try {
      const price = await stripe.invoices.createPreview({
        customer,
        subscription: currentUserSubscription?.data?.[0]?.id,
        subscription_details: {
          proration_behavior: 'create_prorations',
          billing_cycle_anchor: 'now',
          items: [
            {
              id: currentUserSubscription?.data?.[0]?.items?.data?.[0]?.id,
              price: findPrice?.id!,
              quantity: 1,
            },
          ],
          proration_date: proration_date,
        },
      });

      return {
        price: price?.amount_remaining ? price?.amount_remaining / 100 : 0,
      };
    } catch (err) {
      return { price: 0 };
    }
  }

  async getCustomerSubscriptions(organizationId: string) {
    const org = (await this._organizationService.getOrgById(organizationId))!;
    const customer = org.paymentId;
    return stripe.subscriptions.list({
      customer: customer!,
      status: 'all',
    });
  }

  async setToCancel(organizationId: string) {
    const id = makeId(10);
    const org = await this._organizationService.getOrgById(organizationId);
    const customer = await this.createOrGetCustomer(org!);
    const baseSub = await this._getBaseSubscription(customer);
    const addonSubs = await this._getAddonSubscriptions(customer);

    if (!baseSub) {
      throw new Error('No active subscription found');
    }

    // If the user is toggling back (un-cancelling), just remove the cancel
    if (baseSub.cancel_at_period_end) {
      const { cancel_at } = await stripe.subscriptions.update(baseSub.id, {
        cancel_at_period_end: false,
        metadata: { service: 'postmill', id },
      });
      // Also resume any add-ons that were set to cancel
      await Promise.all(
        addonSubs.map((s) =>
          s.cancel_at_period_end
            ? stripe.subscriptions.update(s.id, { cancel_at_period_end: false })
            : Promise.resolve()
        )
      );

      return {
        id,
        cancel_at: cancel_at ? new Date(cancel_at * 1000) : undefined,
      };
    }

    // Check if the latest invoice has a failed payment
    const latestInvoice = baseSub.latest_invoice as Stripe.Invoice | null;
    const hasFailedPayment =
      baseSub.status === 'past_due' ||
      latestInvoice?.status === 'open' ||
      latestInvoice?.status === 'uncollectible';

    if (hasFailedPayment) {
      // Payment already failed — cancel immediately and delete subscription
      await stripe.subscriptions.cancel(baseSub.id);
      await Promise.all(addonSubs.map((s) => stripe.subscriptions.cancel(s.id)));
      await this._subscriptionService.deleteSubscription(customer);

      return {
        id,
        cancel_at: new Date(),
      };
    }

    // Payment succeeded — cancel base and all add-ons at end of billing period
    const { cancel_at } = await stripe.subscriptions.update(baseSub.id, {
      cancel_at_period_end: true,
      metadata: { service: 'postmill', id },
    });
    await Promise.all(
      addonSubs.map((s) =>
        stripe.subscriptions.update(s.id, { cancel_at_period_end: true })
      )
    );

    return {
      id,
      cancel_at: cancel_at ? new Date(cancel_at * 1000) : undefined,
    };
  }

  async getCustomerByOrganizationId(organizationId: string) {
    const org = (await this._organizationService.getOrgById(organizationId))!;
    return org.paymentId;
  }

  async createBillingPortalLink(customer: string) {
    return stripe.billingPortal.sessions.create({
      customer,
      return_url: process.env['FRONTEND_URL'] + '/billing',
    });
  }

  /**
   * Find an active promotion code with autoapply: true metadata
   * Only returns codes that are active and not expired
   * Returns the promotion code string (not the ID) for frontend auto-apply
   */
  private async findAutoApplyPromotionCode(): Promise<string | null> {
    try {
      const promotionCodes = await stripe.promotionCodes.list({
        active: true,
        limit: 100,
      });

      const now = Math.floor(Date.now() / 1000);

      for (const promoCode of promotionCodes.data) {
        const coupon =
          typeof promoCode.promotion.coupon === 'string'
            ? null
            : promoCode.promotion.coupon;

        // Check if it has autoapply metadata set to true (check both promo and coupon metadata)
        const autoApply = Object.assign(
          {},
          promoCode.metadata,
          coupon?.metadata
        )?.autoapply;
        if (autoApply !== 'true') continue;

        // Check if the promotion code has expired
        if (promoCode.expires_at && promoCode.expires_at < now) continue;

        // Check if the coupon has expired (redeem_by)
        if (coupon?.redeem_by && coupon.redeem_by < now) continue;

        // Check if max redemptions reached
        if (
          promoCode.max_redemptions &&
          promoCode.times_redeemed >= promoCode.max_redemptions
        )
          continue;

        // Found a valid auto-apply promotion code - return the code string for frontend
        return promoCode.code;
      }

      return null;
    } catch (err) {
      this._logger.error(
        `Error finding auto-apply promotion code: ${
          (err as Error)?.message ?? String(err)
        }`
      );
      return null;
    }
  }

  private async createEmbeddedCheckout(
    ud: string,
    uniqueId: string,
    customer: string,
    body: BillingSubscribeDto,
    price: string,
    userId: string,
    allowTrial: boolean
  ) {
    const user = await this._userService.getUserById(userId);

    try {
      await stripe.customers.update(customer, {
        email: user.email.indexOf('@') > -1 ? user.email : `${user.email}@postiz.com`,
        ...(body.dub
          ? {
              metadata: {
                dubCustomerExternalId: userId,
                dubClickId: body.dub,
              },
            }
          : {}),
      });
    } catch (err) {}

    // Check for auto-apply promotion code (only for monthly plans)
    let autoApplyPromoCode: string | null = null;
    if (body.period === 'MONTHLY') {
      autoApplyPromoCode = await this.findAutoApplyPromotionCode();
    }

    const isUtm = body.utm ? `&utm_source=${body.utm}` : '';
    const { client_secret } = await stripe.checkout.sessions.create({
      ui_mode: 'custom',
      customer,
      return_url:
        process.env['FRONTEND_URL'] +
        `/posts?onboarding=true&check=${uniqueId}${isUtm}`,
      mode: 'subscription',
      subscription_data: {
        ...(allowTrial ? { trial_period_days: 30 } : {}),
        metadata: {
          service: 'postmill',
          ...body,
          userId,
          uniqueId,
          ud,
        },
      },
      ...(body.datafast_session_id && body.datafast_visitor_id
        ? {
            metadata: {
              datafast_visitor_id: body.datafast_visitor_id,
              datafast_session_id: body.datafast_session_id,
            },
          }
        : {}),
      allow_promotion_codes: body.period === 'MONTHLY',
      line_items: [
        {
          price,
          quantity: 1,
        },
      ],
    });

    // Return auto-apply promo code for frontend to apply
    return {
      client_secret,
      ...(autoApplyPromoCode ? { auto_apply_coupon: autoApplyPromoCode } : {}),
    };
  }

  private async createCheckoutSession(
    ud: string,
    uniqueId: string,
    customer: string,
    body: BillingSubscribeDto,
    price: string,
    userId: string,
    allowTrial: boolean
  ) {
    const isUtm = body.utm ? `&utm_source=${body.utm}` : '';

    if (body.dub) {
      await stripe.customers.update(customer, {
        metadata: {
          dubCustomerExternalId: userId,
          dubClickId: body.dub,
        },
      });
    }

    const { url } = await stripe.checkout.sessions.create({
      customer,
      cancel_url: process.env['FRONTEND_URL'] + `/billing?cancel=true${isUtm}`,
      success_url:
        process.env['FRONTEND_URL'] +
        `/posts?onboarding=true&check=${uniqueId}${isUtm}`,
      mode: 'subscription',
      subscription_data: {
        ...(allowTrial ? { trial_period_days: 30 } : {}),
        metadata: {
          service: 'postmill',
          ...body,
          userId,
          uniqueId,
          ud,
        },
      },
      allow_promotion_codes: body.period === 'MONTHLY',
      line_items: [
        {
          price,
          quantity: 1,
        },
      ],
    });

    return { url };
  }

  async finishTrial(paymentId: string) {
    const list = (
      await stripe.subscriptions.list({
        customer: paymentId,
      })
    ).data.filter((f) => f.status === 'trialing');

    return stripe.subscriptions.update(list[0].id, {
      trial_end: 'now',
    });
  }

  async checkDiscount(customer: string) {
    if (!process.env.STRIPE_DISCOUNT_ID) {
      return false;
    }

    const list = await stripe.charges.list({
      customer,
      limit: 1,
    });

    if (!list.data.filter((f) => f.amount > 1000).length) {
      return false;
    }

    const currentUserSubscription = {
      data: (
        await stripe.subscriptions.list({
          customer,
          status: 'all',
          expand: ['data.discounts'],
        })
      ).data.find((f) => f.status === 'active' || f.status === 'trialing'),
    };

    if (!currentUserSubscription) {
      return false;
    }

    if (
      currentUserSubscription.data?.items.data[0]?.price.recurring?.interval ===
        'year' ||
      currentUserSubscription.data?.discounts.length
    ) {
      return false;
    }

    return true;
  }

  async applyDiscount(customer: string) {
    const check = this.checkDiscount(customer);
    if (!check) {
      return false;
    }

    const currentUserSubscription = {
      data: (
        await stripe.subscriptions.list({
          customer,
          status: 'all',
          expand: ['data.discounts'],
        })
      ).data.find((f) => f.status === 'active' || f.status === 'trialing'),
    };

    await stripe.subscriptions.update(currentUserSubscription.data.id, {
      discounts: [
        {
          coupon: process.env.STRIPE_DISCOUNT_ID!,
        },
      ],
    });

    return true;
  }

  async checkSubscription(organizationId: string, subscriptionId: string) {
    const orgValue = await this._subscriptionService.checkSubscription(
      organizationId,
      subscriptionId
    );

    if (orgValue) {
      return 2;
    }

    const getCustomerSubscriptions = await this.getCustomerSubscriptions(
      organizationId
    );
    if (getCustomerSubscriptions.data.length === 0) {
      return 0;
    }

    if (
      getCustomerSubscriptions.data.find(
        (p) => p.metadata.uniqueId === subscriptionId
      )?.canceled_at
    ) {
      return 1;
    }

    return 0;
  }

  async embedded(
    uniqueId: string,
    organizationId: string,
    userId: string,
    body: BillingSubscribeDto,
    allowTrial: boolean
  ) {
    const id = makeId(10);
    const priceData = pricing[body.billing];
    const org = await this._organizationService.getOrgById(organizationId);
    const customer = await this.createOrGetCustomer(org!);
    const allProducts = await stripe.products.list({
      active: true,
      expand: ['data.prices'],
    });

    const findProduct =
      allProducts.data.find(
        (product) => product.name.toUpperCase() === body.billing.toUpperCase()
      ) ||
      (await stripe.products.create({
        active: true,
        name: body.billing,
      }));

    const pricesList = await stripe.prices.list({
      active: true,
      product: findProduct!.id,
    });

    const findPrice =
      pricesList.data.find(
        (p) =>
          p?.recurring?.interval?.toLowerCase() ===
            (body.period === 'MONTHLY' ? 'month' : 'year') &&
          p?.unit_amount ===
            (body.period === 'MONTHLY'
              ? priceData.month_price
              : priceData.year_price) *
              100
      ) ||
      (await stripe.prices.create({
        active: true,
        product: findProduct!.id,
        currency: 'usd',
        nickname: body.billing + ' ' + body.period,
        unit_amount:
          (body.period === 'MONTHLY'
            ? priceData.month_price
            : priceData.year_price) * 100,
        recurring: {
          interval: body.period === 'MONTHLY' ? 'month' : 'year',
        },
      }));

    return this.createEmbeddedCheckout(
      uniqueId,
      id,
      customer,
      body,
      findPrice!.id,
      userId,
      allowTrial
    );
  }

  async subscribe(
    uniqueId: string,
    organizationId: string,
    userId: string,
    body: BillingSubscribeDto,
    allowTrial: boolean
  ) {
    const id = makeId(10);
    const priceData = pricing[body.billing];
    const org = await this._organizationService.getOrgById(organizationId);
    const customer = await this.createOrGetCustomer(org!);
    const allProducts = await stripe.products.list({
      active: true,
      expand: ['data.prices'],
    });

    const findProduct =
      allProducts.data.find(
        (product) => product.name.toUpperCase() === body.billing.toUpperCase()
      ) ||
      (await stripe.products.create({
        active: true,
        name: body.billing,
      }));

    const pricesList = await stripe.prices.list({
      active: true,
      product: findProduct!.id,
    });

    const findPrice =
      pricesList.data.find(
        (p) =>
          p?.recurring?.interval?.toLowerCase() ===
            (body.period === 'MONTHLY' ? 'month' : 'year') &&
          p?.unit_amount ===
            (body.period === 'MONTHLY'
              ? priceData.month_price
              : priceData.year_price) *
              100
      ) ||
      (await stripe.prices.create({
        active: true,
        product: findProduct!.id,
        currency: 'usd',
        nickname: body.billing + ' ' + body.period,
        unit_amount:
          (body.period === 'MONTHLY'
            ? priceData.month_price
            : priceData.year_price) * 100,
        recurring: {
          interval: body.period === 'MONTHLY' ? 'month' : 'year',
        },
      }));

    const getCurrentSubscriptions =
      await this._subscriptionService.getSubscription(organizationId);

    if (!getCurrentSubscriptions) {
      return this.createCheckoutSession(
        uniqueId,
        id,
        customer,
        body,
        findPrice!.id,
        userId,
        allowTrial
      );
    }

    const currentUserSubscription = {
      data: (
        await stripe.subscriptions.list({
          customer,
          status: 'all',
        })
      ).data.filter((f) => f.status === 'active' || f.status === 'trialing'),
    };

    try {
      await stripe.subscriptions.update(currentUserSubscription.data[0].id, {
        cancel_at_period_end: false,
        metadata: {
          service: 'postmill',
          ...body,
          userId,
          id,
          ud: uniqueId,
        },
        proration_behavior: 'always_invoice',
        items: [
          {
            id: currentUserSubscription.data[0].items.data[0].id,
            price: findPrice!.id,
            quantity: 1,
          },
        ],
      });

      return { id };
    } catch (err) {
      const { url } = await this.createBillingPortalLink(customer);
      return {
        portal: url,
      };
    }
  }

  async paymentSucceeded(event: Stripe.InvoicePaymentSucceededEvent) {
    // get subscription from payment
    const subscriptionId =
      event.data.object.parent?.subscription_details?.subscription;
    if (!subscriptionId) {
      return { ok: true };
    }
    const subscription = await stripe.subscriptions.retrieve(
      typeof subscriptionId === 'string' ? subscriptionId : subscriptionId.id
    );

    // Add-on invoices have no purchase attribution and no pending tier.
    if (!subscription.metadata?.addon) {
      // Dunning recovery (F5): a paid plan-invoice means the subscription
      // recovered — clear the grace marker, but only when the live status
      // confirms it (never on unpaid/canceled).
      if (
        subscription.status === 'active' ||
        subscription.status === 'trialing'
      ) {
        await this._stripeEventRepository.setGracePeriod(
          subscription.customer as string,
          null
        );
      }

      const { userId, ud } = subscription.metadata;
      const user = await this._userService.getUserById(userId);
      if (user && user.ip && user.agent) {
        this._trackService.track(ud, user.ip, user.agent, TrackEnum.Purchase, {
          value: event.data.object.amount_paid / 100,
        });
      }

      // Apply a scheduled downgrade now that the current billing period has
      // been paid for and the new price is in effect.
      const org = await this._organizationService.getOrgByCustomerId(
        subscription.customer as string
      );
      if (org?.id) {
        const dbSub = await this._subscriptionService.getSubscription(org.id);
        if (dbSub?.pendingTier) {
          await this._subscriptionService.modifySubscriptionByOrg(
            org.id,
            pricing[dbSub.pendingTier].channel,
            dbSub.pendingTier
          );
          await this._subscriptionService.clearPendingTier(org.id);
          // Sync Stripe with the applied downgrade. `changePlan` deliberately left
          // metadata.billing = the pre-downgrade tier so the immediate subscription.updated
          // wouldn't prune early; now that it's applied, rewrite it so a later
          // customer.subscription.updated (which re-derives the tier from metadata.billing)
          // doesn't revert to the old tier.
          await stripe.subscriptions.update(
            typeof subscriptionId === 'string' ? subscriptionId : subscriptionId.id,
            { metadata: { ...subscription.metadata, billing: dbSub.pendingTier } }
          );
        }
      }
    }

    return { ok: true };
  }

  async getCharges(organizationId: string) {
    const org = await this._organizationService.getOrgById(organizationId);
    if (!org?.paymentId) {
      return [];
    }

    const charges = await stripe.charges.list({
      customer: org.paymentId,
      limit: 100,
    });

    const chargeList = charges.data
      .filter((f) => f.status === 'succeeded')
      .map((charge) => ({
        id: charge.id,
        amount: charge.amount,
        currency: charge.currency,
        created: charge.created,
        status: charge.status,
        refunded: charge.refunded,
        amount_refunded: charge.amount_refunded,
        description: charge.description,
        receipt_url: charge.receipt_url || null,
        invoice: (charge as any).invoice || null,
      }));

    const invoiceIds = chargeList
      .map((c) => c.invoice)
      .filter((id): id is string => !!id && typeof id === 'string');

    const invoicePdfMap: Record<string, string> = {};
    for (const invoiceId of invoiceIds) {
      try {
        const inv = await stripe.invoices.retrieve(invoiceId);
        if (inv.invoice_pdf) {
          invoicePdfMap[invoiceId] = inv.invoice_pdf;
        }
      } catch {
        // ignore if invoice can't be fetched
      }
    }

    return chargeList.map((charge) => ({
      ...charge,
      invoice_pdf:
        charge.invoice && invoicePdfMap[charge.invoice as string]
          ? invoicePdfMap[charge.invoice as string]
          : null,
    }));
  }

  async refundCharges(organizationId: string, chargeIds: string[]) {
    const org = await this._organizationService.getOrgById(organizationId);
    if (!org?.paymentId) {
      throw new Error('No payment customer found for this organization');
    }

    const refunded: string[] = [];
    const failed: string[] = [];

    for (const chargeId of chargeIds) {
      try {
        await stripe.refunds.create({ charge: chargeId });
        refunded.push(chargeId);
      } catch (err) {
        failed.push(chargeId);
      }
    }

    return { refunded, failed };
  }

  async cancelSubscription(organizationId: string) {
    const org = await this._organizationService.getOrgById(organizationId);
    if (!org?.paymentId) {
      throw new Error('No payment customer found for this organization');
    }

    const customer = org.paymentId;

    const subscriptions = (
      await stripe.subscriptions.list({
        customer,
        status: 'all',
      })
    ).data.filter((f) => f.status !== 'canceled');

    if (!subscriptions.length) {
      throw new Error('No active subscription found');
    }

    await stripe.subscriptions.cancel(subscriptions[0].id);
    await this._subscriptionService.deleteSubscription(customer);

    return { cancelled: true };
  }

  async lifetimeDeal(organizationId: string, code: string) {
    const getCurrentSubscription =
      await this._subscriptionService.getSubscriptionByOrganizationId(
        organizationId
      );
    if (getCurrentSubscription && !getCurrentSubscription?.isLifetime) {
      throw new Error('You already have a non lifetime subscription');
    }

    try {
      const testCode = AuthService.fixedDecryption(code);
      const findCode = await this._subscriptionService.getCode(testCode);
      if (findCode) {
        return {
          success: false,
        };
      }

      const nextPackage: BillingTier = 'AGENCY';
      const findPricing = pricing[nextPackage];

      await this._subscriptionService.createOrUpdateSubscription(
        false,
        makeId(10),
        organizationId,
        findPricing.channel,
        nextPackage,
        'MONTHLY',
        null,
        testCode,
        organizationId
      );
      return {
        success: true,
      };
    } catch (err) {
      this._logger.warn((err as Error)?.message ?? String(err));
      return {
        success: false,
      };
    }
  }
}
