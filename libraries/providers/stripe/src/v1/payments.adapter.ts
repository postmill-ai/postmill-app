import Stripe from 'stripe';
import { metadata as providerMetadata } from './metadata';
import {
  NormalizedPaymentEvent,
  NormalizedSubscriptionState,
  PaymentsAddonSpec,
  PaymentsCapability,
  PaymentsCapabilityFlags,
  PaymentsCharge,
  PaymentsCheckoutRequest,
  PaymentsCheckoutResult,
  PaymentsPeriod,
  PaymentsPlanChangeRequest,
  PaymentsPlanChangeResult,
  PaymentsPlanPrice,
  PaymentsPublicConfig,
  PaymentsSubscriptionStatus,
  PaymentsTier,
  PaymentsWebhookInput,
  PaymentsWebhookVerificationError,
  ProviderModule,
  WebhookReceipt,
  planUnitAmountCents,
} from '@postmill-ai/provider-kernel';

const SERVICE_TAG = 'postmill';

/**
 * Stripe payments adapter — the vendor-facing half of the former
 * `StripeService`. Every Stripe API call in the codebase lives here; the
 * database transitions (subscription rows, grace windows, audit, tracking)
 * live in the orchestrator, which drives this adapter through the
 * `PaymentsCapability` contract.
 *
 * Wire contract preserved from the monolith: subscription metadata keys
 * (`service`, `billing`, `period`, `uniqueId`, `userId`, `ud`, `addon`,
 * `pendingTier`, attribution fields), product lookup by name + price lookup by
 * interval/amount (prices are created on demand from the plan table), embedded
 * checkout in `ui_mode: 'custom'`.
 */
export class StripePaymentsAdapter implements PaymentsCapability {
  readonly name = 'stripe';
  readonly capabilities: PaymentsCapabilityFlags = {
    checkoutMode: 'embedded',
    portal: true,
    proration: true,
    addons: true,
    refunds: true,
    promoCodes: true,
    trials: true,
    cardCheck: true,
    chargesHistory: true,
    periodEndCancel: true,
    planChange: true,
  };
  // The first key is the enabling switch (billing master switch of old); the
  // others are validated at boot with a warning when missing.
  readonly requiredEnvKeys = ['STRIPE_PUBLISHABLE_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_SIGNING_KEY'];

  private _client: Stripe | null = null;

  private get stripe(): Stripe {
    if (!this._client) {
      this._client = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_nothing', {
        // Pinned deliberately: dahlia (the SDK default from v21 on) renamed the
        // Checkout ui_mode enum and dropped 'custom', which the embedded
        // checkout relies on. Move to dahlia only with that flow migrated —
        // never silently via an SDK bump.
        apiVersion: '2025-09-30.clover' as Stripe.LatestApiVersion,
      });
    }
    return this._client;
  }

  isConfigured(): boolean {
    return !!process.env.STRIPE_PUBLISHABLE_KEY;
  }

  publicConfig(): PaymentsPublicConfig {
    return {
      providerId: this.name,
      checkoutMode: this.capabilities.checkoutMode,
      publicKey: process.env.STRIPE_PUBLISHABLE_KEY,
      capabilities: this.capabilities,
    };
  }

  // ---------------------------------------------------------------- webhooks

  async receiveWebhook(input: PaymentsWebhookInput): Promise<WebhookReceipt> {
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(
        input.rawBody,
        input.headers['stripe-signature'] || '',
        process.env.STRIPE_SIGNING_KEY || '',
      );
    } catch (err) {
      throw new PaymentsWebhookVerificationError((err as Error)?.message);
    }

    const object: any = event.data?.object ?? {};
    const metadata: Record<string, string> = object.metadata || {};
    const isInvoiceEvent =
      event.type === 'invoice.payment_succeeded' || event.type === 'invoice.payment_failed';

    // Maybe it comes from another app on the same Stripe account — ignore and
    // don't even ledger it (invoice events carry no metadata and always pass).
    if (metadata.service !== SERVICE_TAG && !isInvoiceEvent) {
      return { eventId: event.id, eventType: event.type, events: [], skipRecord: true };
    }

    const events: NormalizedPaymentEvent[] = [];
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const customerRef = sub.customer as string;
        if (metadata.addon) {
          events.push({ type: 'addons.changed', customerRef });
          break;
        }
        if (event.type === 'customer.subscription.deleted') {
          events.push({ type: 'subscription.canceled', customerRef });
          break;
        }
        if (sub.status === 'past_due') {
          events.push({ type: 'subscription.past_due', customerRef, providerSubscriptionRef: sub.id });
          break;
        }
        events.push({
          type: event.type === 'customer.subscription.created' ? 'subscription.activated' : 'subscription.updated',
          customerRef,
          state: this._toState(sub),
          requiresCardCheck: true,
        });
        break;
      }
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        const subscriptionId = this._invoiceSubscriptionId(invoice);
        if (!subscriptionId) {
          break;
        }
        const sub = await this.stripe.subscriptions.retrieve(subscriptionId);
        events.push({
          type: 'payment.succeeded',
          customerRef: sub.customer as string,
          amountCents: invoice.amount_paid,
          currency: invoice.currency,
          isAddon: !!sub.metadata?.addon,
          providerSubscriptionRef: sub.id,
          subscriptionStatus: this._toStatus(sub.status),
          userIdHint: sub.metadata?.userId,
          trackingRef: sub.metadata?.ud,
        });
        break;
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        events.push({
          type: 'payment.failed',
          customerRef: invoice.customer as string,
          providerSubscriptionRef: this._invoiceSubscriptionId(invoice),
        });
        break;
      }
      default:
        break;
    }

    return { eventId: event.id, eventType: event.type, events };
  }

  private _invoiceSubscriptionId(invoice: Stripe.Invoice): string | undefined {
    const ref = (invoice as any).parent?.subscription_details?.subscription;
    if (!ref) {
      return undefined;
    }
    return typeof ref === 'string' ? ref : ref.id;
  }

  private _toStatus(status: Stripe.Subscription.Status): PaymentsSubscriptionStatus {
    switch (status) {
      case 'active':
        return 'active';
      case 'trialing':
        return 'trialing';
      case 'past_due':
        return 'past_due';
      case 'incomplete':
      case 'incomplete_expired':
        return 'incomplete';
      default:
        return 'canceled';
    }
  }

  private _toState(sub: Stripe.Subscription): NormalizedSubscriptionState {
    const md = sub.metadata || {};
    return {
      tier: md.billing as PaymentsTier,
      period: md.period as PaymentsPeriod,
      status: this._toStatus(sub.status),
      identifier: md.uniqueId,
      providerSubscriptionRef: sub.id,
      // Historical semantics: anything but `active` is treated as trialing.
      isTrialing: sub.status !== 'active',
      cancelAt: sub.cancel_at ? new Date(sub.cancel_at * 1000) : null,
      pendingTier: (md.pendingTier as PaymentsTier) || null,
    };
  }

  // ---------------------------------------------------------------- customers

  async ensureCustomer(input: {
    orgId: string;
    orgName: string;
    email: string;
    existingRef: string | null;
  }): Promise<string | null> {
    if (input.existingRef) {
      return input.existingRef;
    }
    const customer = await this.stripe.customers.create({
      email: this._email(input.email),
      name: input.orgName,
    });
    return customer.id;
  }

  private _email(email: string): string {
    return email.indexOf('@') > -1 ? email : `${email}@postmill.ai`;
  }

  // ---------------------------------------------------------------- catalog

  private async _getOrCreateProduct(name: string, extraMetadata: Record<string, string> = {}) {
    const allProducts = await this.stripe.products.list({ active: true });
    return (
      allProducts.data.find((p) => p.name.toUpperCase() === name.toUpperCase()) ||
      (await this.stripe.products.create({
        active: true,
        name,
        metadata: { service: SERVICE_TAG, ...extraMetadata },
      }))
    );
  }

  private async _getOrCreatePrice(plan: PaymentsPlanPrice, period: PaymentsPeriod) {
    const product = await this._getOrCreateProduct(plan.tier);
    const interval = period === 'MONTHLY' ? 'month' : 'year';
    const unitAmount = planUnitAmountCents(plan, period);
    const prices = await this.stripe.prices.list({ active: true, product: product.id });
    return (
      prices.data.find(
        (p) => p?.recurring?.interval?.toLowerCase() === interval && p?.unit_amount === unitAmount,
      ) ||
      (await this.stripe.prices.create({
        active: true,
        product: product.id,
        currency: plan.currency,
        nickname: `${plan.tier} ${period}`,
        unit_amount: unitAmount,
        recurring: { interval },
        metadata: { service: SERVICE_TAG, tier: plan.tier },
      }))
    );
  }

  private async _getOrCreateAddonPrice(addon: PaymentsAddonSpec) {
    const product = await this._getOrCreateProduct(addon.productName, { addon: addon.type });
    const prices = await this.stripe.prices.list({ active: true, product: product.id });
    return (
      prices.data.find(
        (p) => p.recurring?.interval === 'month' && p.unit_amount === addon.unitAmountCents,
      ) ||
      (await this.stripe.prices.create({
        active: true,
        product: product.id,
        currency: addon.currency,
        nickname: `${addon.productName} monthly`,
        unit_amount: addon.unitAmountCents,
        recurring: { interval: 'month' },
        metadata: { service: SERVICE_TAG, addon: addon.type },
      }))
    );
  }

  private async _activeSubscriptions(customer: string, expandPrice = false) {
    const list = await this.stripe.subscriptions.list({
      customer,
      status: 'all',
      ...(expandPrice ? { expand: ['data.items.data.price'] } : {}),
    });
    return list.data.filter((f) => f.status === 'active' || f.status === 'trialing');
  }

  private async _getBaseSubscription(customer: string) {
    return (await this._activeSubscriptions(customer, true)).find((s) => !s.metadata?.addon);
  }

  private async _getAddonSubscriptions(customer: string) {
    return (await this._activeSubscriptions(customer)).filter((s) => s.metadata?.addon);
  }

  // ---------------------------------------------------------------- checkout

  async createCheckout(request: PaymentsCheckoutRequest): Promise<PaymentsCheckoutResult> {
    const price = await this._getOrCreatePrice(request.plan, request.period);
    const customer = request.customerRef!;
    const { dub, datafast_session_id, datafast_visitor_id } = request.metadata;

    // Same keys the monolith wrote: service + the subscribe body (billing, period,
    // utm, dub, datafast_*) + userId + the app purchase id + tracking cookie.
    const subscriptionMetadata = {
      service: SERVICE_TAG,
      ...request.metadata,
      billing: request.plan.tier,
      period: request.period,
      userId: request.userId,
      uniqueId: request.identifier,
      ud: request.trackingRef ?? '',
    };
    const dubMetadata = dub ? { dubCustomerExternalId: request.userId, dubClickId: dub } : undefined;

    if (request.mode === 'embedded') {
      try {
        await this.stripe.customers.update(customer, {
          email: this._email(request.email),
          ...(dubMetadata ? { metadata: dubMetadata } : {}),
        });
      } catch (err) {
        /* best effort — a stale customer record must not block checkout */
      }

      // Auto-apply promotion codes only for monthly plans.
      const autoApplyCoupon =
        request.period === 'MONTHLY' ? await this._findAutoApplyPromotionCode() : null;

      const { client_secret } = await this.stripe.checkout.sessions.create({
        ui_mode: 'custom',
        customer,
        return_url: request.returnUrls.success,
        mode: 'subscription',
        subscription_data: {
          ...(request.allowTrial ? { trial_period_days: 30 } : {}),
          metadata: subscriptionMetadata,
        },
        ...(datafast_session_id && datafast_visitor_id
          ? { metadata: { datafast_visitor_id, datafast_session_id } }
          : {}),
        allow_promotion_codes: request.period === 'MONTHLY',
        line_items: [{ price: price.id, quantity: 1 }],
      });

      return {
        kind: 'client_secret',
        clientSecret: client_secret!,
        ...(autoApplyCoupon ? { autoApplyCoupon } : {}),
      };
    }

    if (dubMetadata) {
      await this.stripe.customers.update(customer, { metadata: dubMetadata });
    }
    const { url } = await this.stripe.checkout.sessions.create({
      customer,
      cancel_url: request.returnUrls.cancel,
      success_url: request.returnUrls.success,
      mode: 'subscription',
      subscription_data: {
        ...(request.allowTrial ? { trial_period_days: 30 } : {}),
        metadata: subscriptionMetadata,
      },
      allow_promotion_codes: request.period === 'MONTHLY',
      line_items: [{ price: price.id, quantity: 1 }],
    });
    return { kind: 'redirect', url: url! };
  }

  /**
   * Find an active promotion code with autoapply: true metadata.
   * Only returns codes that are active and not expired; the code string (not
   * the id) is what the embedded checkout applies client-side.
   */
  private async _findAutoApplyPromotionCode(): Promise<string | null> {
    try {
      const promotionCodes = await this.stripe.promotionCodes.list({ active: true, limit: 100 });
      const now = Math.floor(Date.now() / 1000);
      for (const promoCode of promotionCodes.data) {
        const coupon =
          typeof promoCode.promotion.coupon === 'string' ? null : promoCode.promotion.coupon;
        const autoApply = Object.assign({}, promoCode.metadata, coupon?.metadata)?.autoapply;
        if (autoApply !== 'true') continue;
        if (promoCode.expires_at && promoCode.expires_at < now) continue;
        if (coupon?.redeem_by && coupon.redeem_by < now) continue;
        if (promoCode.max_redemptions && promoCode.times_redeemed >= promoCode.max_redemptions) continue;
        return promoCode.code;
      }
      return null;
    } catch {
      return null;
    }
  }

  async changePlan(request: PaymentsPlanChangeRequest): Promise<PaymentsPlanChangeResult> {
    const customer = request.customerRef;

    if (request.direction === 'upgrade') {
      const price = await this._getOrCreatePrice(request.plan, request.period);
      const current = await this._activeSubscriptions(customer);
      try {
        await this.stripe.subscriptions.update(current[0].id, {
          cancel_at_period_end: false,
          metadata: {
            service: SERVICE_TAG,
            billing: request.plan.tier,
            period: request.period,
            ...request.metadata,
            userId: request.userId,
            id: request.identifier,
            ud: request.identifier,
          },
          proration_behavior: 'always_invoice',
          items: [{ id: current[0].items.data[0].id, price: price.id, quantity: 1 }],
        });
        return { kind: 'applied' };
      } catch (err) {
        const url = await this.manageUrl(customer, request.metadata.returnUrl || '');
        return { kind: 'portal', url };
      }
    }

    // Downgrade: swap the price now (no proration) and tag the pending tier so
    // the next `customer.subscription.updated` keeps the current entitlements
    // until the renewal invoice applies the lower tier.
    const baseSub = await this._getBaseSubscription(customer);
    if (!baseSub) {
      throw new Error('No active base subscription to downgrade');
    }
    const period: PaymentsPeriod =
      baseSub.items.data[0]?.price?.recurring?.interval === 'year' ? 'YEARLY' : 'MONTHLY';
    const newPrice = await this._getOrCreatePrice(request.plan, period);
    const uniqueId = baseSub.metadata?.uniqueId || request.identifier;
    await this.stripe.subscriptions.update(baseSub.id, {
      cancel_at_period_end: false,
      proration_behavior: 'none',
      items: [{ id: baseSub.items.data[0].id, price: newPrice.id, quantity: 1 }],
      metadata: {
        ...(baseSub.metadata || {}),
        service: SERVICE_TAG,
        billing: request.currentTier,
        period,
        uniqueId,
        pendingTier: request.plan.tier,
      },
    });
    return { kind: 'pending', tier: request.plan.tier };
  }

  async commitPendingTier(
    customerRef: string,
    tier: PaymentsTier,
    providerSubscriptionRef?: string,
  ): Promise<void> {
    const sub = providerSubscriptionRef
      ? await this.stripe.subscriptions.retrieve(providerSubscriptionRef)
      : await this._getBaseSubscription(customerRef);
    if (!sub) {
      return;
    }
    await this.stripe.subscriptions.update(sub.id, {
      metadata: { ...sub.metadata, billing: tier },
    });
  }

  async previewProration(input: {
    customerRef: string;
    plan: PaymentsPlanPrice;
    period: PaymentsPeriod;
  }): Promise<{ amountCents: number }> {
    const price = await this._getOrCreatePrice(input.plan, input.period);
    const current = await this._activeSubscriptions(input.customerRef);
    try {
      const preview = await this.stripe.invoices.createPreview({
        customer: input.customerRef,
        subscription: current?.[0]?.id,
        subscription_details: {
          proration_behavior: 'create_prorations',
          billing_cycle_anchor: 'now',
          items: [{ id: current?.[0]?.items?.data?.[0]?.id, price: price.id, quantity: 1 }],
          proration_date: Math.floor(Date.now() / 1000),
        },
      });
      return { amountCents: preview?.amount_remaining ?? 0 };
    } catch {
      return { amountCents: 0 };
    }
  }

  async setCancelAtPeriodEnd(customerRef: string, cancel: boolean | 'toggle') {
    const baseSub = await this._getBaseSubscription(customerRef);
    const addonSubs = await this._getAddonSubscriptions(customerRef);
    if (!baseSub) {
      throw new Error('No active subscription found');
    }
    const wantCancel = cancel === 'toggle' ? !baseSub.cancel_at_period_end : cancel;

    if (!wantCancel) {
      const { cancel_at } = await this.stripe.subscriptions.update(baseSub.id, {
        cancel_at_period_end: false,
        metadata: { service: SERVICE_TAG },
      });
      await Promise.all(
        addonSubs.map((s) =>
          s.cancel_at_period_end
            ? this.stripe.subscriptions.update(s.id, { cancel_at_period_end: false })
            : Promise.resolve(),
        ),
      );
      return {
        cancelAt: cancel_at ? new Date(cancel_at * 1000) : null,
        cancelAtPeriodEnd: false,
        canceledNow: false,
      };
    }

    // A failed latest payment means there is nothing to keep alive — cancel now.
    const latestInvoice = baseSub.latest_invoice as Stripe.Invoice | null;
    const hasFailedPayment =
      baseSub.status === 'past_due' ||
      latestInvoice?.status === 'open' ||
      latestInvoice?.status === 'uncollectible';
    if (hasFailedPayment) {
      await this.stripe.subscriptions.cancel(baseSub.id);
      await Promise.all(addonSubs.map((s) => this.stripe.subscriptions.cancel(s.id)));
      return { cancelAt: new Date(), cancelAtPeriodEnd: false, canceledNow: true };
    }

    const { cancel_at } = await this.stripe.subscriptions.update(baseSub.id, {
      cancel_at_period_end: true,
      metadata: { service: SERVICE_TAG },
    });
    await Promise.all(
      addonSubs.map((s) => this.stripe.subscriptions.update(s.id, { cancel_at_period_end: true })),
    );
    return {
      cancelAt: cancel_at ? new Date(cancel_at * 1000) : null,
      cancelAtPeriodEnd: true,
      canceledNow: false,
    };
  }

  async cancelNow(customerRef: string): Promise<void> {
    const subscriptions = (
      await this.stripe.subscriptions.list({ customer: customerRef, status: 'all' })
    ).data.filter((f) => f.status !== 'canceled');
    if (!subscriptions.length) {
      throw new Error('No active subscription found');
    }
    await this.stripe.subscriptions.cancel(subscriptions[0].id);
  }

  async finishTrial(customerRef: string): Promise<void> {
    const trialing = (
      await this.stripe.subscriptions.list({ customer: customerRef })
    ).data.filter((f) => f.status === 'trialing');
    await this.stripe.subscriptions.update(trialing[0].id, { trial_end: 'now' });
  }

  async checkDiscount(customerRef: string): Promise<boolean> {
    if (!process.env.STRIPE_DISCOUNT_ID) {
      return false;
    }
    const charges = await this.stripe.charges.list({ customer: customerRef, limit: 1 });
    if (!charges.data.filter((f) => f.amount > 1000).length) {
      return false;
    }
    const current = (
      await this.stripe.subscriptions.list({
        customer: customerRef,
        status: 'all',
        expand: ['data.discounts'],
      })
    ).data.find((f) => f.status === 'active' || f.status === 'trialing');
    if (!current) {
      return false;
    }
    if (current.items.data[0]?.price.recurring?.interval === 'year' || current.discounts.length) {
      return false;
    }
    return true;
  }

  async applyDiscount(customerRef: string): Promise<boolean> {
    // The monolith forgot to await this check, so it was always truthy.
    if (!(await this.checkDiscount(customerRef))) {
      return false;
    }
    const current = (
      await this.stripe.subscriptions.list({
        customer: customerRef,
        status: 'all',
        expand: ['data.discounts'],
      })
    ).data.find((f) => f.status === 'active' || f.status === 'trialing');
    await this.stripe.subscriptions.update(current!.id, {
      discounts: [{ coupon: process.env.STRIPE_DISCOUNT_ID! }],
    });
    return true;
  }

  async manageUrl(customerRef: string | null, returnUrl: string): Promise<string> {
    const session = await this.stripe.billingPortal.sessions.create({
      customer: customerRef!,
      return_url: returnUrl,
    });
    return session.url;
  }

  // ---------------------------------------------------------------- add-ons

  async upsertAddon(customerRef: string, addon: PaymentsAddonSpec, packs: number): Promise<void> {
    const quantity = Math.max(1, Math.floor(packs));
    const existing = (await this._getAddonSubscriptions(customerRef)).find(
      (s) => s.metadata?.addon === addon.type,
    );
    if (existing) {
      await this.stripe.subscriptions.update(existing.id, {
        cancel_at_period_end: false,
        items: [{ id: existing.items.data[0].id, quantity }],
        metadata: { service: SERVICE_TAG, addon: addon.type },
      });
      return;
    }
    const price = await this._getOrCreateAddonPrice(addon);
    await this.stripe.subscriptions.create({
      customer: customerRef,
      items: [{ price: price.id, quantity }],
      metadata: { service: SERVICE_TAG, addon: addon.type },
    });
  }

  async cancelAddon(customerRef: string, type: string): Promise<void> {
    const existing = (await this._getAddonSubscriptions(customerRef)).find(
      (s) => s.metadata?.addon === type,
    );
    if (!existing) {
      return;
    }
    await this.stripe.subscriptions.update(existing.id, {
      cancel_at_period_end: true,
      metadata: { service: SERVICE_TAG, addon: type },
    });
  }

  async listAddonQuantities(customerRef: string): Promise<Record<string, number>> {
    const quantities: Record<string, number> = {};
    for (const sub of await this._getAddonSubscriptions(customerRef)) {
      const type = sub.metadata?.addon;
      if (!type) continue;
      quantities[type] = (quantities[type] || 0) + (sub.items.data[0]?.quantity ?? 1);
    }
    return quantities;
  }

  // ---------------------------------------------------------------- charges

  async listCharges(customerRef: string): Promise<PaymentsCharge[]> {
    const charges = await this.stripe.charges.list({ customer: customerRef, limit: 100 });
    const succeeded = charges.data.filter((f) => f.status === 'succeeded');

    const invoicePdfMap: Record<string, string> = {};
    for (const charge of succeeded) {
      const invoiceId = (charge as any).invoice;
      if (!invoiceId || typeof invoiceId !== 'string') continue;
      try {
        const inv = await this.stripe.invoices.retrieve(invoiceId);
        if (inv.invoice_pdf) {
          invoicePdfMap[invoiceId] = inv.invoice_pdf;
        }
      } catch {
        // ignore if invoice can't be fetched
      }
    }

    return succeeded.map((charge) => ({
      id: charge.id,
      amountCents: charge.amount,
      currency: charge.currency,
      createdAt: new Date(charge.created * 1000),
      refunded: charge.refunded,
      amountRefundedCents: charge.amount_refunded,
      description: charge.description,
      receiptUrl: charge.receipt_url || null,
      invoicePdfUrl: invoicePdfMap[(charge as any).invoice as string] || null,
    }));
  }

  async refund(customerRef: string, chargeIds: string[]) {
    const refunded: string[] = [];
    const failed: string[] = [];
    for (const chargeId of chargeIds) {
      try {
        await this.stripe.refunds.create({ charge: chargeId });
        refunded.push(chargeId);
      } catch {
        failed.push(chargeId);
      }
    }
    return { refunded, failed };
  }

  // ---------------------------------------------------------------- orchestrator hooks

  /**
   * Authorise $1 on the latest payment method and void it. On failure the
   * method is detached and the subscription cancelled at Stripe, so a trial
   * cannot start on a card that will never charge.
   */
  async verifyPaymentMethod(input: {
    customerRef: string;
    providerSubscriptionRef: string;
  }): Promise<boolean> {
    const paymentMethods = await this.stripe.paymentMethods.list({ customer: input.customerRef });
    const latestMethod = paymentMethods.data.reduce(
      (prev, current) => (prev.created < current.created ? current : prev),
      { created: -100 } as Stripe.PaymentMethod,
    );
    if (!latestMethod.id) {
      return false;
    }
    const detachAndCancel = async () => {
      try {
        await this.stripe.paymentMethods.detach(paymentMethods.data[0].id);
        await this.stripe.subscriptions.cancel(input.providerSubscriptionRef);
      } catch {
        /* nothing more to do */
      }
    };
    try {
      const paymentIntent = await this.stripe.paymentIntents.create({
        amount: 100,
        currency: 'usd',
        payment_method: latestMethod.id,
        customer: input.customerRef,
        off_session: true,
        capture_method: 'manual',
        confirm: true,
      });
      if (paymentIntent.status !== 'requires_capture') {
        await detachAndCancel();
        return false;
      }
      await this.stripe.paymentIntents.cancel(paymentIntent.id);
      return true;
    } catch {
      await detachAndCancel();
      return false;
    }
  }

  async fetchSubscriptionState(input: {
    customerRef: string;
    providerSubscriptionRef?: string;
  }): Promise<NormalizedSubscriptionState | null> {
    const sub = input.providerSubscriptionRef
      ? await this.stripe.subscriptions.retrieve(input.providerSubscriptionRef)
      : await this._getBaseSubscription(input.customerRef);
    return sub ? this._toState(sub) : null;
  }

  async checkoutStatus(input: {
    customerRef: string | null;
    identifier: string;
  }): Promise<'pending' | 'canceled' | 'unknown'> {
    if (!input.customerRef) {
      return 'unknown';
    }
    const subs = await this.stripe.subscriptions.list({ customer: input.customerRef, status: 'all' });
    if (subs.data.length === 0) {
      return 'unknown';
    }
    return subs.data.find((p) => p.metadata.uniqueId === input.identifier)?.canceled_at
      ? 'canceled'
      : 'pending';
  }
}

const _meta = new StripePaymentsAdapter();

export const stripePaymentsModule: ProviderModule<any, any> = {
  metadata: providerMetadata,
  manifest: {
    domain: 'payments',
    providerId: _meta.name,
    version: 'v1',
    displayName: 'Stripe',
    status: 'active',
    credentialFields: [],
    capabilities: _meta.capabilities,
    platformConnect: 'env',
    docsUrl: 'https://docs.stripe.com/billing/subscriptions/overview',
    webhookInstructions:
      'Stripe Dashboard → Developers → Webhooks → add `https://<backend>/payments/webhooks/stripe` for customer.subscription.created/updated/deleted and invoice.payment_succeeded/payment_failed; paste the signing secret into STRIPE_SIGNING_KEY.',
  },
  create: () => new StripePaymentsAdapter(),
};
