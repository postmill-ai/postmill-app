import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Organization } from '@prisma/client';
import {
  NormalizedPaymentEvent,
  PaymentsAddonSpec,
  PaymentsCapability,
  PaymentsPeriod,
  PaymentsPlanPrice,
  PaymentsTier,
  PaymentsUnsupportedOperationError,
  WebhookReceipt,
} from '@postmill-ai/provider-kernel';
import {
  BillingTier,
  SubscriptionService,
} from '@postmill-ai/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { OrganizationService } from '@postmill-ai/nestjs-libraries/database/prisma/organizations/organization.service';
import { makeId } from '@postmill-ai/nestjs-libraries/services/make.is';
import { BillingSubscribeDto } from '@postmill-ai/nestjs-libraries/dtos/billing/billing.subscribe.dto';
import {
  pricing,
  ADDONS,
  AddonType,
  AddonExtraColumn,
  addonPackSize,
  addonPriceCents,
} from '@postmill-ai/nestjs-libraries/database/prisma/subscriptions/pricing';
import { AuthService } from '@postmill-ai/helpers/auth/auth.service';
import { TrackService } from '@postmill-ai/nestjs-libraries/track/track.service';
import { UsersService } from '@postmill-ai/nestjs-libraries/database/prisma/users/users.service';
import { TrackEnum } from '@postmill-ai/nestjs-libraries/user/track.enum';
// layering: sanctioned leaf-read — PaymentEventRepository lives in the subscriptions
// domain, but SubscriptionService does not depend on PaymentsService, and these are
// narrow webhook idempotency/grace reads with no service-level cycle.
import { PaymentEventRepository } from '@postmill-ai/nestjs-libraries/database/prisma/subscriptions/payment-event.repository';
import { NotificationService } from '@postmill-ai/nestjs-libraries/database/prisma/notifications/notification.service';
import { AuditService } from '@postmill-ai/nestjs-libraries/database/prisma/audit/audit.service';
import { PaymentsConfigService } from './payments-config.service';
import { isWebhookVerificationError } from './payments.errors';

/** A `Subscription.provider` value that no kernel module answers to (lifetime codes, admin grants). */
export const MANUAL_PROVIDER = 'manual';

interface Binding {
  providerId: string;
  capability: PaymentsCapability;
  /** `Organization.paymentId` when it was issued by this provider, else null. */
  customerRef: string | null;
}

/**
 * Provider-agnostic billing orchestration — what `StripeService` used to be,
 * minus every vendor call. Resolves the provider an org is bound to, drives
 * the adapter through `PaymentsCapability`, and owns every database transition:
 * subscription rows, dunning grace, audit, purchase tracking, pending
 * downgrades, add-on quantities, webhook idempotency. `applyEvent()` is the
 * single sink for vendor state — webhooks, native receipt verification and
 * the expiry cron all end up there.
 */
@Injectable()
export class PaymentsService {
  private readonly _logger = new Logger(PaymentsService.name);
  // Dunning grace window (C2): how long after a payment failure we keep channels live
  // before the terminal cancellation teardown.
  private readonly GRACE_PERIOD_DAYS = 7;
  private static readonly TIER_RANK: Record<BillingTier, number> = {
    STARTER: 1,
    PRO: 2,
    TEAM: 3,
    AGENCY: 4,
  };

  constructor(
    private _subscriptionService: SubscriptionService,
    private _organizationService: OrganizationService,
    private _userService: UsersService,
    private _trackService: TrackService,
    // layering: sanctioned leaf-read — see import comment above.
    private _paymentEventRepository: PaymentEventRepository,
    private _notificationService: NotificationService,
    private _audit: AuditService,
    private _config: PaymentsConfigService
  ) {}

  // ---------------------------------------------------------------- resolution

  /**
   * The provider that bills this org: the active subscription's provider, else
   * the provider the org's customer ref belongs to, else the deployment's web
   * default. `manual` rows (lifetime/admin) fall through to the default.
   */
  async resolveOrgProvider(org: Organization): Promise<Binding | null> {
    const subscription = await this._subscriptionService.getSubscription(org.id);
    const candidates = [subscription?.provider, org.paymentProvider, this._config.defaultWebProvider()];
    for (const id of candidates) {
      if (!id || id === MANUAL_PROVIDER) continue;
      const capability = this._config.tryResolve(id);
      if (capability) {
        return {
          providerId: id,
          capability,
          customerRef: org.paymentProvider === id ? org.paymentId : null,
        };
      }
    }
    return null;
  }

  private async _bind(org: Organization): Promise<Binding> {
    const binding = await this.resolveOrgProvider(org);
    if (!binding) {
      throw new BadRequestException('No payment provider is configured');
    }
    return binding;
  }

  private _require<K extends keyof PaymentsCapability>(
    binding: Binding,
    method: K
  ): NonNullable<PaymentsCapability[K]> {
    const fn = binding.capability[method];
    if (typeof fn !== 'function') {
      throw new PaymentsUnsupportedOperationError(binding.providerId, String(method));
    }
    return fn.bind(binding.capability) as NonNullable<PaymentsCapability[K]>;
  }

  private _plan(tier: BillingTier): PaymentsPlanPrice {
    return {
      tier,
      monthlyCents: pricing[tier].month_price * 100,
      yearlyCents: pricing[tier].year_price * 100,
      currency: 'usd',
    };
  }

  private _addon(type: AddonType): PaymentsAddonSpec {
    return {
      type,
      productName: ADDONS[type].productName,
      unitAmountCents: addonPriceCents(type),
      currency: 'usd',
    };
  }

  private async _org(organizationId: string): Promise<Organization> {
    const org = await this._organizationService.getOrgById(organizationId);
    if (!org) {
      throw new BadRequestException('Organization not found');
    }
    return org as Organization;
  }

  /** Customer ref for a web provider, creating the vendor customer on first use and binding the org to it. */
  private async _ensureCustomer(org: Organization, binding: Binding): Promise<string | null> {
    if (binding.customerRef) {
      return binding.customerRef;
    }
    const ensure = binding.capability.ensureCustomer;
    if (!ensure) {
      return null;
    }
    const team = await this._organizationService.getTeam(org.id);
    const email = team!.users[0].user.email;
    const ref = await ensure.call(binding.capability, {
      orgId: org.id,
      orgName: org.name,
      email,
      existingRef: null,
    });
    if (ref) {
      await this._subscriptionService.updateCustomerId(org.id, ref, binding.providerId);
      binding.customerRef = ref;
    }
    return ref;
  }

  private _requireCustomer(binding: Binding): string {
    if (!binding.customerRef) {
      throw new BadRequestException('No payment customer found for this organization');
    }
    return binding.customerRef;
  }

  // ---------------------------------------------------------------- read surface

  /** Browser-safe deployment + org billing configuration for the billing UI. */
  async getConfig(org: Organization) {
    const deployment = this._config.publicConfig();
    const binding = await this.resolveOrgProvider(org);
    let manageUrl: string | null = null;
    if (binding?.capability.capabilities.portal && binding.capability.manageUrl) {
      try {
        manageUrl = await binding.capability.manageUrl(
          binding.customerRef,
          (process.env.FRONTEND_URL || '') + '/billing'
        );
      } catch {
        manageUrl = null;
      }
    }
    return {
      ...deployment,
      org: binding
        ? {
            provider: binding.providerId,
            checkoutMode: binding.capability.capabilities.checkoutMode,
            capabilities: binding.capability.capabilities,
            manageUrl,
          }
        : null,
    };
  }

  getPackages() {
    // Self-hosted instances have no provider: return an empty catalog rather
    // than letting a vendor 401 bubble up (the frontend force-logs-out on 401).
    if (!this._config.billingEnabled()) {
      return {};
    }
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

  /** 2 = the subscription landed, 1 = the vendor reports it abandoned, 0 = keep polling. */
  async checkSubscription(org: Organization, identifier: string, providerRef?: string) {
    if (await this._subscriptionService.checkSubscription(org.id, identifier)) {
      return 2;
    }
    const binding = await this.resolveOrgProvider(org);
    if (!binding) {
      return 0;
    }
    // Providers whose webhooks lag the redirect can hand us the state directly.
    if (providerRef && binding.capability.pullSubscription) {
      try {
        const events = await binding.capability.pullSubscription(providerRef);
        for (const event of events) {
          await this.applyEvent(binding.providerId, event, binding.capability);
        }
        if (events.length && (await this._subscriptionService.checkSubscription(org.id, identifier))) {
          return 2;
        }
      } catch (err) {
        this._logger.warn(`pullSubscription(${providerRef}) failed: ${(err as Error)?.message ?? err}`);
      }
    }
    if (!binding.capability.checkoutStatus) {
      return 0;
    }
    const status = await binding.capability.checkoutStatus({
      customerRef: binding.customerRef,
      identifier,
      providerRef,
    });
    return status === 'canceled' ? 1 : 0;
  }

  // ---------------------------------------------------------------- checkout + plan

  /**
   * `/billing/embedded` and `/billing/subscribe`. First purchase → vendor
   * checkout; an org that already has a subscription row → in-place upgrade.
   * Response shapes are the historical wire contract.
   */
  async startCheckout(
    mode: 'embedded' | 'hosted',
    trackingRef: string | undefined,
    organizationId: string,
    userId: string,
    body: BillingSubscribeDto,
    allowTrial: boolean
  ) {
    const org = await this._org(organizationId);
    const binding = await this._bind(org);
    const identifier = makeId(10);
    const { billing, period, ...attribution } = body;
    const metadata = Object.fromEntries(
      Object.entries(attribution).filter(([, v]) => typeof v === 'string' && v !== '')
    ) as Record<string, string>;

    const current = await this._subscriptionService.getSubscription(organizationId);
    if (current && !current.isLifetime) {
      const customerRef = await this._ensureCustomer(org, binding);
      const result = await this._require(binding, 'changePlan')({
        customerRef: customerRef!,
        currentTier: current.subscriptionTier,
        plan: this._plan(billing),
        period,
        direction: 'upgrade',
        identifier,
        userId,
        metadata: { ...metadata, returnUrl: (process.env.FRONTEND_URL || '') + '/billing' },
      });
      return this._planChangeResponse(result, identifier);
    }

    const customerRef = await this._ensureCustomer(org, binding);
    const utm = body.utm ? `&utm_source=${body.utm}` : '';
    const user = await this._userService.getUserById(userId);
    const checkout = await this._require(binding, 'createCheckout')({
      customerRef,
      orgId: org.id,
      userId,
      email: user?.email || '',
      plan: this._plan(billing),
      period,
      allowTrial,
      identifier,
      trackingRef,
      metadata,
      returnUrls: {
        success: (process.env.FRONTEND_URL || '') + `/posts?onboarding=true&check=${identifier}${utm}`,
        cancel: (process.env.FRONTEND_URL || '') + `/billing?cancel=true${utm}`,
      },
      mode: mode === 'embedded' && binding.capability.capabilities.checkoutMode === 'embedded' ? 'embedded' : 'hosted',
    });
    switch (checkout.kind) {
      case 'client_secret':
        return {
          client_secret: checkout.clientSecret,
          ...(checkout.autoApplyCoupon ? { auto_apply_coupon: checkout.autoApplyCoupon } : {}),
        };
      case 'redirect':
        return { url: checkout.url };
      case 'portal':
        return { portal: checkout.url };
      default:
        return { id: identifier };
    }
  }

  private _planChangeResponse(
    result: Awaited<ReturnType<NonNullable<PaymentsCapability['changePlan']>>>,
    identifier: string
  ) {
    switch (result.kind) {
      case 'redirect':
        return { url: result.url };
      case 'portal':
        return { portal: result.url };
      case 'pending':
        return { pendingTier: result.tier };
      default:
        return { id: identifier };
    }
  }

  async changePlan(organizationId: string, userId: string, tier: BillingTier) {
    const current = await this._subscriptionService.getSubscription(organizationId);
    const currentTier = current?.subscriptionTier || 'STARTER';
    if (currentTier === tier) {
      return { ok: true };
    }
    const isUpgrade = PaymentsService.TIER_RANK[tier] > PaymentsService.TIER_RANK[currentTier];
    if (isUpgrade) {
      await this._subscriptionService.clearPendingTier(organizationId);
      return this.startCheckout(
        'hosted',
        makeId(10),
        organizationId,
        userId,
        { billing: tier, period: (current?.period as PaymentsPeriod) || 'MONTHLY' } as BillingSubscribeDto,
        false
      );
    }

    // Downgrade: the vendor swaps the price for the next invoice; limits stay on
    // the current tier until `payment.succeeded` applies the pending tier.
    const org = await this._org(organizationId);
    const binding = await this._bind(org);
    const customerRef = await this._ensureCustomer(org, binding);
    const result = await this._require(binding, 'changePlan')({
      customerRef: customerRef!,
      currentTier,
      plan: this._plan(tier),
      period: (current?.period as PaymentsPeriod) || 'MONTHLY',
      direction: 'downgrade',
      identifier: makeId(10),
      userId,
      metadata: {},
    });
    if (result.kind === 'pending') {
      await this._subscriptionService.setPendingTier(organizationId, result.tier);
      return { pendingTier: result.tier };
    }
    return this._planChangeResponse(result, makeId(10));
  }

  async prorate(organizationId: string, body: BillingSubscribeDto) {
    const org = await this._org(organizationId);
    const binding = await this._bind(org);
    if (!binding.capability.previewProration) {
      return { price: 0 };
    }
    const customerRef = await this._ensureCustomer(org, binding);
    const { amountCents } = await binding.capability.previewProration({
      customerRef: customerRef!,
      plan: this._plan(body.billing),
      period: body.period,
    });
    return { price: amountCents ? amountCents / 100 : 0 };
  }

  // ---------------------------------------------------------------- lifecycle

  /** `/billing/cancel` — toggles the period-end cancel (or resumes). */
  async setToCancel(organizationId: string) {
    const id = makeId(10);
    const org = await this._org(organizationId);
    const binding = await this._bind(org);
    const customerRef = await this._ensureCustomer(org, binding);
    const result = await this._require(binding, 'setCancelAtPeriodEnd')(customerRef!, 'toggle');
    if (result.canceledNow) {
      // The vendor already tore it down (payment had failed) — drop our row too.
      await this._subscriptionService.deleteSubscription(customerRef!);
      return { id, cancel_at: new Date() };
    }
    if (!binding.capability.capabilities.periodEndCancel) {
      // The vendor cancelled immediately but access runs to the period end: keep
      // the row with `cancelAt` so the expiry cron tears it down later.
      await this._subscriptionService.setCancelAt(organizationId, result.cancelAt);
    }
    return { id, cancel_at: result.cancelAt ?? undefined };
  }

  /** `/billing/cancel-subscription` — immediate teardown. */
  async cancelSubscription(organizationId: string) {
    const org = await this._org(organizationId);
    const binding = await this._bind(org);
    const customerRef = this._requireCustomer(binding);
    await this._require(binding, 'cancelNow')(customerRef);
    await this._subscriptionService.deleteSubscription(customerRef);
    return { cancelled: true };
  }

  async finishTrial(org: Organization) {
    const binding = await this._bind(org);
    await this._require(binding, 'finishTrial')(this._requireCustomer(binding));
  }

  async checkDiscount(org: Organization): Promise<boolean> {
    const binding = await this.resolveOrgProvider(org);
    if (!binding?.capability.checkDiscount || !binding.customerRef) {
      return false;
    }
    return binding.capability.checkDiscount(binding.customerRef);
  }

  async applyDiscount(org: Organization): Promise<boolean> {
    const binding = await this.resolveOrgProvider(org);
    if (!binding?.capability.applyDiscount || !binding.customerRef) {
      return false;
    }
    return binding.capability.applyDiscount(binding.customerRef);
  }

  async portalUrl(organizationId: string) {
    const org = await this._org(organizationId);
    const binding = await this._bind(org);
    const url = await this._require(binding, 'manageUrl')(
      binding.customerRef,
      (process.env.FRONTEND_URL || '') + '/billing'
    );
    return { portal: url };
  }

  async getCharges(organizationId: string) {
    const org = await this._org(organizationId);
    const binding = await this.resolveOrgProvider(org);
    if (!binding?.customerRef || !binding.capability.listCharges) {
      return [];
    }
    // Historical wire shape (Stripe charge fields) kept for the admin app.
    return (await binding.capability.listCharges(binding.customerRef)).map((c) => ({
      id: c.id,
      amount: c.amountCents,
      currency: c.currency,
      created: Math.floor(c.createdAt.getTime() / 1000),
      status: 'succeeded',
      refunded: c.refunded,
      amount_refunded: c.amountRefundedCents,
      description: c.description ?? null,
      receipt_url: c.receiptUrl ?? null,
      invoice: null,
      invoice_pdf: c.invoicePdfUrl ?? null,
    }));
  }

  async refundCharges(organizationId: string, chargeIds: string[]) {
    const org = await this._org(organizationId);
    const binding = await this._bind(org);
    return this._require(binding, 'refund')(this._requireCustomer(binding), chargeIds);
  }

  async lifetimeDeal(organizationId: string, code: string) {
    const current = await this._subscriptionService.getSubscriptionByOrganizationId(organizationId);
    if (current && !current?.isLifetime) {
      throw new Error('You already have a non lifetime subscription');
    }
    try {
      const testCode = AuthService.fixedDecryption(code);
      if (await this._subscriptionService.getCode(testCode)) {
        return { success: false };
      }
      const nextPackage: BillingTier = 'AGENCY';
      await this._subscriptionService.createOrUpdateSubscription(
        false,
        makeId(10),
        organizationId,
        pricing[nextPackage].channel,
        nextPackage,
        'MONTHLY',
        null,
        testCode,
        organizationId,
        MANUAL_PROVIDER
      );
      return { success: true };
    } catch (err) {
      this._logger.warn((err as Error)?.message ?? String(err));
      return { success: false };
    }
  }

  // ---------------------------------------------------------------- add-ons

  async createOrUpdateAddon(organizationId: string, type: AddonType, packs: number) {
    const org = await this._org(organizationId);
    // Lifetime orgs have no base vendor subscription for add-on items to ride on.
    const subscription = await this._subscriptionService.getSubscription(organizationId);
    if (subscription?.isLifetime) {
      throw new BadRequestException('Add-ons are not available for lifetime organizations');
    }
    const binding = await this._bind(org);
    const customerRef = await this._ensureCustomer(org, binding);
    await this._require(binding, 'upsertAddon')(customerRef!, this._addon(type), packs);
    // Write-through so the purchased capacity reflects immediately; the vendor
    // webhook stays the reconciler. Idempotent.
    await this.syncAddonQuantities(binding.providerId, customerRef!, binding.capability);
    return { ok: true };
  }

  async cancelAddon(organizationId: string, type: AddonType) {
    const org = await this._org(organizationId);
    const binding = await this._bind(org);
    const customerRef = await this._ensureCustomer(org, binding);
    await this._require(binding, 'cancelAddon')(customerRef!, type);
    await this.syncAddonQuantities(binding.providerId, customerRef!, binding.capability);
    return { ok: true };
  }

  async syncAddonQuantities(providerId: string, customerRef: string, capability?: PaymentsCapability) {
    const org = await this._organizationService.getOrgByCustomerId(customerRef, providerId);
    if (!org?.id) {
      return { ok: true };
    }
    const cap = capability ?? this._config.resolve(providerId);
    if (!cap.listAddonQuantities) {
      return { ok: true };
    }
    const quantities = await cap.listAddonQuantities(customerRef);
    const payload: Partial<Record<AddonExtraColumn, number>> = {};
    for (const type of Object.keys(ADDONS) as AddonType[]) {
      payload[ADDONS[type].column] = (quantities[type] || 0) * addonPackSize(type);
    }
    await this._subscriptionService.updateAddonQuantities(org.id, payload);
    return { ok: true };
  }

  // ---------------------------------------------------------------- native purchases

  /** A store purchase handed over by the mobile app: verify with the store, then apply. */
  async verifyNativePurchase(org: Organization, providerId: string, payload: unknown) {
    const capability = this._config.resolve(providerId);
    if (capability.capabilities.checkoutMode !== 'native' || !capability.verifyPurchase) {
      throw new PaymentsUnsupportedOperationError(providerId, 'verifyPurchase');
    }
    let events: NormalizedPaymentEvent[];
    try {
      events = await capability.verifyPurchase({ orgId: org.id, payload });
    } catch (err) {
      // A receipt the store rejects is the client's problem (400) — never a 401,
      // which the frontend treats as a dead session.
      if (isWebhookVerificationError(err)) {
        throw new BadRequestException((err as Error).message);
      }
      throw err;
    }
    for (const event of events) {
      await this.applyEvent(providerId, event, capability);
    }
    const subscription = await this._subscriptionService.getSubscription(org.id);
    return { ok: !!subscription, tier: subscription?.subscriptionTier ?? null };
  }

  // ---------------------------------------------------------------- webhooks

  /**
   * Verify → translate → idempotency check → apply → record. Errors while
   * applying stay unrecorded so the vendor's redelivery retries the transition.
   */
  async handleWebhook(
    providerId: string,
    rawBody: Buffer,
    headers: Record<string, string | undefined>,
    query: Record<string, string>
  ) {
    const capability = this._config.resolve(providerId);
    let receipt: WebhookReceipt;
    try {
      receipt = await capability.receiveWebhook({ rawBody, headers, query });
    } catch (err) {
      if (isWebhookVerificationError(err)) {
        throw new UnauthorizedException((err as Error).message);
      }
      throw new BadRequestException((err as Error)?.message ?? 'Malformed webhook');
    }

    const ack = receipt.ackBody ?? { ok: true };
    if (receipt.skipRecord) {
      return ack;
    }
    // Idempotency (C1): vendors redeliver; an event id we already processed must
    // not re-run the transition.
    if (await this._paymentEventRepository.exists(receipt.eventId)) {
      return ack;
    }
    try {
      let result: unknown = ack;
      for (const event of receipt.events) {
        result = await this.applyEvent(providerId, event, capability);
      }
      // Record only after successful processing so a thrown error stays retryable.
      await this._paymentEventRepository.record(receipt.eventId, receipt.eventType, providerId);
      return receipt.ackBody ?? result ?? ack;
    } catch (e) {
      throw new HttpException(e as any, 500);
    }
  }

  /** The single sink for vendor state. Returns the historical `{ ok }` shapes. */
  async applyEvent(providerId: string, event: NormalizedPaymentEvent, capability?: PaymentsCapability) {
    const cap = capability ?? this._config.resolve(providerId);
    const org = await this._resolveEventOrg(providerId, event);

    switch (event.type) {
      case 'subscription.activated':
      case 'subscription.updated': {
        if (!org) {
          return { ok: false };
        }
        const state = event.state;
        if (state.status === 'incomplete') {
          return { ok: false };
        }
        if (event.requiresCardCheck && org.allowTrial && cap.capabilities.cardCheck && cap.verifyPaymentMethod) {
          let valid = false;
          try {
            valid = await cap.verifyPaymentMethod({
              customerRef: event.customerRef,
              providerSubscriptionRef: state.providerSubscriptionRef,
            });
          } catch {
            valid = false;
          }
          if (!valid) {
            return { ok: false };
          }
        }
        // Dunning recovery (F5/I1): clear the grace marker ONLY on a genuine
        // recovery — never on unpaid/canceled, which would grant permanent access.
        if (
          event.type === 'subscription.updated' &&
          (state.status === 'active' || state.status === 'trialing')
        ) {
          await this._paymentEventRepository.setGracePeriod(event.customerRef, providerId, null);
        }
        await this._auditSubscriptionChanged(org.id, state.status);
        const result = await this._subscriptionService.createOrUpdateSubscription(
          state.isTrialing,
          state.identifier,
          event.customerRef,
          pricing[state.tier].channel!,
          state.tier,
          state.period,
          state.cancelAt ? Math.floor(state.cancelAt.getTime() / 1000) : null,
          undefined,
          org.id,
          providerId
        );
        if (state.pendingTier && state.pendingTier !== state.tier) {
          await this._subscriptionService.setPendingTier(org.id, state.pendingTier);
        }
        return result;
      }
      case 'subscription.past_due':
      case 'payment.failed':
        return this._enterGracePeriod(providerId, cap, event.customerRef, event.providerSubscriptionRef);
      case 'subscription.canceled': {
        await this._subscriptionService.deleteSubscription(event.customerRef);
        if (org) {
          await this._auditSubscriptionChanged(org.id, 'deleted');
        }
        return { ok: true };
      }
      case 'payment.succeeded': {
        // Add-on invoices have no purchase attribution and no pending tier.
        if (event.isAddon) {
          return { ok: true };
        }
        if (event.subscriptionStatus === 'active' || event.subscriptionStatus === 'trialing') {
          await this._paymentEventRepository.setGracePeriod(event.customerRef, providerId, null);
        }
        const dbSub = org ? await this._subscriptionService.getSubscription(org.id) : null;
        if (event.userIdHint) {
          const user = await this._userService.getUserById(event.userIdHint);
          if (user && user.ip && user.agent) {
            const amountCents =
              event.amountCents ??
              (dbSub ? this._planAmount(dbSub.subscriptionTier, dbSub.period as PaymentsPeriod) : 0);
            this._trackService.track(event.trackingRef || '', user.ip, user.agent, TrackEnum.Purchase, {
              value: amountCents / 100,
            });
          }
        }
        // Apply a scheduled downgrade now that the period has been paid for and
        // the new price is in effect.
        if (org && dbSub?.pendingTier) {
          await this._subscriptionService.modifySubscriptionByOrg(
            org.id,
            pricing[dbSub.pendingTier].channel,
            dbSub.pendingTier
          );
          await this._subscriptionService.clearPendingTier(org.id);
          await cap.commitPendingTier?.(event.customerRef, dbSub.pendingTier, event.providerSubscriptionRef);
        }
        return { ok: true };
      }
      case 'addons.changed':
        return this.syncAddonQuantities(providerId, event.customerRef, cap);
      default:
        return { ok: true };
    }
  }

  private _planAmount(tier: BillingTier, period: PaymentsPeriod): number {
    return period === 'YEARLY' ? pricing[tier].year_price * 100 : pricing[tier].month_price * 100;
  }

  /**
   * Which org a vendor event belongs to. By customer ref first; else by the org
   * id the vendor echoed back (store purchases, PayPal's first activation,
   * Google token rotation) — which then binds the org to this ref. A hint can
   * never steal an org that another provider is actively billing.
   */
  private async _resolveEventOrg(providerId: string, event: NormalizedPaymentEvent) {
    const byRef = await this._organizationService.getOrgByCustomerId(event.customerRef, providerId);
    if (byRef || !event.orgIdHint) {
      return byRef;
    }
    const hinted = await this._organizationService.getOrgById(event.orgIdHint);
    if (!hinted) {
      return null;
    }
    const subscription = await this._subscriptionService.getSubscription(hinted.id);
    if (subscription && subscription.provider !== providerId && subscription.provider !== MANUAL_PROVIDER) {
      this._logger.warn(
        `Ignoring ${providerId} event for org ${hinted.id}: it is billed by ${subscription.provider}`
      );
      return null;
    }
    await this._subscriptionService.updateCustomerId(hinted.id, event.customerRef, providerId);
    return { ...hinted, paymentId: event.customerRef, paymentProvider: providerId } as Organization;
  }

  // Dunning (C2): a past-due subscription enters a grace window + notifies the org
  // instead of tearing down channels. The terminal cancellation still downgrades.
  private async _enterGracePeriod(
    providerId: string,
    cap: PaymentsCapability,
    customerRef: string,
    providerSubscriptionRef?: string
  ) {
    if (!customerRef) {
      return { ok: true };
    }
    // Webhook-ordering guard (F5/I2): vendor events are unordered snapshots — a
    // delayed past_due processed AFTER the recovery payment would otherwise open
    // a fresh window and downgrade a fully-paid customer when it lapses. Enter
    // grace only when the LIVE subscription is genuinely past_due.
    if (cap.fetchSubscriptionState) {
      if (!providerSubscriptionRef) {
        this._logger.warn(
          `Skipping grace window for customer ${customerRef}: no subscription ref to verify live status`
        );
        return { ok: true };
      }
      try {
        const live = await cap.fetchSubscriptionState({ customerRef, providerSubscriptionRef });
        if (!live || live.status !== 'past_due') {
          return { ok: true };
        }
      } catch (err) {
        // Unverifiable — skip rather than risk a wrongful window; redelivery retries.
        this._logger.warn(
          `Could not verify live status of subscription ${providerSubscriptionRef}: ${
            (err as Error)?.message ?? String(err)
          }`
        );
        return { ok: true };
      }
    }

    const now = new Date();
    const existing = await this._paymentEventRepository.getGracePeriod(customerRef, providerId);
    // Already inside an unexpired grace window — keep it; don't re-notify or tear down.
    if (existing && existing.getTime() > now.getTime()) {
      return { ok: true, grace: true };
    }
    const until = new Date(now.getTime() + this.GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);
    await this._paymentEventRepository.setGracePeriod(customerRef, providerId, until);

    const org = await this._organizationService.getOrgByCustomerId(customerRef, providerId);
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
          `Failed to send dunning notification for customer ${customerRef}: ${
            (err as Error)?.message ?? String(err)
          }`
        );
      }
    }
    return { ok: true, grace: true };
  }

  // F2(b): record a subscription state transition as a non-fatal audit event.
  private async _auditSubscriptionChanged(orgId: string, status: string) {
    try {
      await this._audit.record({
        orgId,
        action: 'billing.subscription.changed',
        resource: 'subscription',
        metadata: { status },
      });
    } catch {
      /* non-fatal: auditing must never break webhook processing */
    }
  }

  // ---------------------------------------------------------------- expiry cron

  /**
   * Tear down subscriptions whose scheduled end has passed. Required for
   * providers without period-end cancel (PayPal cancels at the vendor at once
   * and we keep the row until `cancelAt`); a missed-webhook safety net for the
   * rest. Stripe rows are only logged for now — its `subscription.deleted`
   * webhook is the authoritative teardown.
   */
  async expireCanceledSubscriptions(now = new Date()) {
    const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const expired = await this._subscriptionService.findExpiredCancellations(cutoff);
    let torn = 0;
    for (const sub of expired) {
      const org = sub.organization;
      if (!org?.paymentId || sub.provider === MANUAL_PROVIDER) {
        continue;
      }
      if (sub.provider === 'stripe') {
        this._logger.warn(
          `Subscription ${sub.id} (stripe) has cancelAt ${sub.cancelAt?.toISOString()} in the past but no teardown webhook arrived`
        );
        continue;
      }
      const eventId = `expiry:${sub.id}:${sub.cancelAt?.getTime()}`;
      if (await this._paymentEventRepository.exists(eventId)) {
        continue;
      }
      await this.applyEvent(sub.provider, {
        type: 'subscription.canceled',
        customerRef: org.paymentId,
        orgIdHint: org.id,
      });
      await this._paymentEventRepository.record(eventId, 'subscription.expired', sub.provider);
      torn += 1;
    }
    return { checked: expired.length, tornDown: torn };
  }
}
