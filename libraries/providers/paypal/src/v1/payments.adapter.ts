import { metadata as providerMetadata } from './metadata';
import {
  NormalizedPaymentEvent,
  NormalizedSubscriptionState,
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
  PaymentsTier,
  PaymentsUnsupportedOperationError,
  PaymentsWebhookInput,
  PaymentsWebhookVerificationError,
  ProviderModule,
  ProviderRuntimeContext,
  SafeFetchPort,
  WebhookReceipt,
  planUnitAmountCents,
} from '@postmill-ai/provider-kernel';

const LIVE_BASE = 'https://api-m.paypal.com';
const SANDBOX_BASE = 'https://api-m.sandbox.paypal.com';
const TIERS: PaymentsTier[] = ['STARTER', 'PRO', 'TEAM', 'AGENCY'];
const PERIODS: PaymentsPeriod[] = ['MONTHLY', 'YEARLY'];
const TRIAL_DAYS = 30;

interface PaypalLink {
  rel: string;
  href: string;
}

interface PaypalSubscription {
  id: string;
  status: string;
  plan_id: string;
  custom_id?: string;
  status_update_time?: string;
  start_time?: string;
  billing_info?: {
    next_billing_time?: string;
    cycle_executions?: Array<{ tenure_type?: string; cycles_remaining?: number; cycles_completed?: number }>;
  };
  links?: PaypalLink[];
}

/** A vendor call that did not complete — retryable, never "not ours". */
class PaypalApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'PaypalApiError';
  }
}

/**
 * PayPal payments adapter — hosted checkout through the PayPal Subscriptions
 * API (Catalog Products → Billing Plans → Subscriptions) over plain REST.
 *
 * What PayPal does differently, and how the flags reflect it:
 * - No customer object: the subscription id (`I-…`) is the org's customer ref
 *   and the org id rides `custom_id` (`<orgId>|<identifier>`) so the first
 *   ACTIVATED webhook can bind the org (`orgIdHint`).
 * - No period-end cancel (`periodEndCancel: false`): cancelling is immediate
 *   at PayPal; the adapter returns the next billing time as `cancelAt` and the
 *   orchestrator keeps access until then.
 * - No portal, no proration preview (PayPal prorates plan revisions itself),
 *   no promo codes, no add-ons in v1.
 * - Webhook verification is PayPal's own `verify-webhook-signature` API — the
 *   only outbound URLs are PayPal's, never the attacker-influenced `cert_url`.
 * - Webhooks can lag the approval redirect by minutes; `pullSubscription`
 *   lets the post-checkout poll reconcile from the `subscription_id` PayPal
 *   appends to the return URL.
 */
export class PaypalPaymentsAdapter implements PaymentsCapability {
  readonly name = 'paypal';
  readonly capabilities: PaymentsCapabilityFlags = {
    checkoutMode: 'hosted',
    portal: false,
    proration: false,
    addons: false,
    refunds: true,
    promoCodes: false,
    trials: true,
    cardCheck: false,
    chargesHistory: true,
    periodEndCancel: false,
    planChange: true,
  };
  readonly requiredEnvKeys = ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_WEBHOOK_ID'];

  private _token: { value: string; expiresAt: number } | null = null;
  /** plan name → id and the reverse, both memoised per process. */
  private readonly _planIds = new Map<string, string>();
  private readonly _planNames = new Map<string, string>();
  private readonly _productIds = new Map<string, string>();

  constructor(private readonly _fetch: SafeFetchPort) {}

  private get base(): string {
    return (process.env.PAYPAL_ENV || 'live').toLowerCase() === 'sandbox' ? SANDBOX_BASE : LIVE_BASE;
  }

  isConfigured(): boolean {
    return !!process.env.PAYPAL_CLIENT_ID;
  }

  publicConfig(): PaymentsPublicConfig {
    return {
      providerId: this.name,
      checkoutMode: this.capabilities.checkoutMode,
      publicKey: process.env.PAYPAL_CLIENT_ID,
      capabilities: this.capabilities,
    };
  }

  // ---------------------------------------------------------------- REST plumbing

  private async _accessToken(): Promise<string> {
    if (this._token && this._token.expiresAt > Date.now()) {
      return this._token.value;
    }
    const basic = Buffer.from(
      `${process.env.PAYPAL_CLIENT_ID || ''}:${process.env.PAYPAL_CLIENT_SECRET || ''}`,
    ).toString('base64');
    const res = await this._fetch(`${this.base}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) {
      throw new Error(`PayPal token request failed: ${res.status}`);
    }
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this._token = {
      value: body.access_token,
      expiresAt: Date.now() + Math.max(0, body.expires_in - 60) * 1000,
    };
    return body.access_token;
  }

  private async _api<T>(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
    retried = false,
  ): Promise<T> {
    const token = await this._accessToken();
    const res = await this._fetch(`${this.base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...extraHeaders,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (res.status === 401 && !retried) {
      // A cached token PayPal no longer honours — refresh once and retry.
      this._token = null;
      return this._api<T>(method, path, body, extraHeaders, true);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new PaypalApiError(`PayPal ${method} ${path} failed: ${res.status} ${text}`.trim(), res.status);
    }
    if (res.status === 204) {
      return undefined as T;
    }
    return (await res.json()) as T;
  }

  // ---------------------------------------------------------------- catalog

  private _productName(tier: PaymentsTier): string {
    return `Postmill ${tier}`;
  }

  /**
   * Plan names carry the amount + currency: a `pricing.ts` change therefore
   * creates a fresh plan for new subscribers (existing subscriptions keep the
   * old plan and price — the same grandfathering rule as Stripe).
   */
  private _planName(plan: PaymentsPlanPrice, period: PaymentsPeriod, trial: boolean): string {
    const amount = (planUnitAmountCents(plan, period) / 100).toFixed(2);
    return `Postmill ${plan.tier} ${period} ${amount} ${plan.currency.toUpperCase()}${trial ? ' TRIAL' : ''}`;
  }

  /** Walk every page of a PayPal list endpoint (they page at 20 by default). */
  private async _listAll<T>(path: string, key: string): Promise<T[]> {
    const items: T[] = [];
    for (let page = 1; page <= 50; page += 1) {
      const res = await this._api<Record<string, unknown> & { total_pages?: number }>(
        'GET',
        `${path}${path.includes('?') ? '&' : '?'}page_size=20&page=${page}&total_required=true`,
      );
      items.push(...((res[key] as T[]) || []));
      if (!res.total_pages || page >= res.total_pages) {
        break;
      }
    }
    return items;
  }

  private async _getOrCreateProduct(tier: PaymentsTier): Promise<string> {
    const name = this._productName(tier);
    const cached = this._productIds.get(name);
    if (cached) {
      return cached;
    }
    const products = await this._listAll<{ id: string; name: string }>('/v1/catalogs/products', 'products');
    let product = products.find((p) => p.name === name);
    if (!product) {
      product = await this._api<{ id: string; name: string }>(
        'POST',
        '/v1/catalogs/products',
        { name, type: 'SERVICE', category: 'SOFTWARE' },
        { 'PayPal-Request-Id': `product-${tier}` },
      );
    }
    this._productIds.set(name, product.id);
    return product.id;
  }

  private async _getOrCreatePlan(
    plan: PaymentsPlanPrice,
    period: PaymentsPeriod,
    trial: boolean,
  ): Promise<string> {
    const name = this._planName(plan, period, trial);
    const cached = this._planIds.get(name);
    if (cached) {
      return cached;
    }
    const productId = await this._getOrCreateProduct(plan.tier);
    const plans = await this._listAll<{ id: string; name: string }>(
      `/v1/billing/plans?product_id=${encodeURIComponent(productId)}`,
      'plans',
    );
    let found = plans.find((p) => p.name === name);
    if (!found) {
      const amount = (planUnitAmountCents(plan, period) / 100).toFixed(2);
      const cycles: unknown[] = [];
      if (trial) {
        cycles.push({
          tenure_type: 'TRIAL',
          sequence: 1,
          total_cycles: 1,
          frequency: { interval_unit: 'DAY', interval_count: TRIAL_DAYS },
          pricing_scheme: { fixed_price: { value: '0', currency_code: plan.currency.toUpperCase() } },
        });
      }
      cycles.push({
        tenure_type: 'REGULAR',
        sequence: trial ? 2 : 1,
        total_cycles: 0,
        frequency: { interval_unit: period === 'MONTHLY' ? 'MONTH' : 'YEAR', interval_count: 1 },
        pricing_scheme: { fixed_price: { value: amount, currency_code: plan.currency.toUpperCase() } },
      });
      found = await this._api<{ id: string; name: string }>(
        'POST',
        '/v1/billing/plans',
        {
          product_id: productId,
          name,
          status: 'ACTIVE',
          billing_cycles: cycles,
          payment_preferences: { auto_bill_outstanding: true, payment_failure_threshold: 3 },
        },
        { 'PayPal-Request-Id': `plan-${plan.tier}-${period}-${trial ? 'trial' : 'paid'}-${amount}` },
      );
    }
    this._planIds.set(name, found.id);
    this._planNames.set(found.id, name);
    return found.id;
  }

  /**
   * Reverse-map a plan id to tier/period, fetching the plan on a cache miss.
   * A failed fetch throws (the webhook answers 500 and PayPal redelivers);
   * only a plan that is genuinely not a Postmill plan yields null.
   */
  private async _planTier(planId: string): Promise<{ tier: PaymentsTier; period: PaymentsPeriod } | null> {
    let name = this._planNames.get(planId);
    if (!name) {
      const plan = await this._api<{ id: string; name: string }>('GET', `/v1/billing/plans/${planId}`);
      name = plan.name;
      this._planNames.set(planId, name);
    }
    const m = /^Postmill (\w+) (MONTHLY|YEARLY)/.exec(name);
    if (!m || !TIERS.includes(m[1] as PaymentsTier) || !PERIODS.includes(m[2] as PaymentsPeriod)) {
      return null;
    }
    return { tier: m[1] as PaymentsTier, period: m[2] as PaymentsPeriod };
  }

  // ---------------------------------------------------------------- checkout

  async ensureCustomer(input: { existingRef: string | null }): Promise<string | null> {
    // PayPal has no customer object; the subscription id becomes the ref on activation.
    return input.existingRef;
  }

  async createCheckout(request: PaymentsCheckoutRequest): Promise<PaymentsCheckoutResult> {
    const planId = await this._getOrCreatePlan(request.plan, request.period, request.allowTrial);
    const sub = await this._api<PaypalSubscription>(
      'POST',
      '/v1/billing/subscriptions',
      {
        plan_id: planId,
        custom_id: `${request.orgId}|${request.identifier}`,
        ...(request.email ? { subscriber: { email_address: request.email } } : {}),
        application_context: {
          brand_name: process.env.PAYPAL_BRAND_NAME || 'Postmill',
          user_action: 'SUBSCRIBE_NOW',
          return_url: request.returnUrls.success,
          cancel_url: request.returnUrls.cancel,
        },
      },
      { 'PayPal-Request-Id': `sub-${request.identifier}` },
    );
    const approve = sub.links?.find((l) => l.rel === 'approve')?.href;
    if (!approve) {
      throw new Error('PayPal did not return an approval link');
    }
    return { kind: 'redirect', url: approve };
  }

  async changePlan(request: PaymentsPlanChangeRequest): Promise<PaymentsPlanChangeResult> {
    const planId = await this._getOrCreatePlan(request.plan, request.period, false);
    const revised = await this._api<{ links?: PaypalLink[] }>(
      'POST',
      `/v1/billing/subscriptions/${request.customerRef}/revise`,
      {
        plan_id: planId,
        application_context: {
          brand_name: process.env.PAYPAL_BRAND_NAME || 'Postmill',
          return_url: request.metadata.returnUrl || '',
          cancel_url: request.metadata.returnUrl || '',
        },
      },
    );
    const approve = revised.links?.find((l) => l.rel === 'approve')?.href;
    if (approve) {
      return { kind: 'redirect', url: approve };
    }
    // PayPal applies a revision at the next cycle; a downgrade therefore stays
    // pending until the renewal payment lands.
    return request.direction === 'downgrade'
      ? { kind: 'pending', tier: request.plan.tier }
      : { kind: 'applied' };
  }

  async setCancelAtPeriodEnd(customerRef: string, cancel: boolean | 'toggle') {
    const live = await this._api<PaypalSubscription>('GET', `/v1/billing/subscriptions/${customerRef}`);
    const alreadyCancelled = live.status === 'CANCELLED' || live.status === 'EXPIRED';
    if (cancel === false || (cancel === 'toggle' && alreadyCancelled)) {
      throw new PaymentsUnsupportedOperationError(
        this.name,
        'resume',
        'PayPal cannot resume a cancelled subscription — subscribe again instead',
      );
    }
    const cancelAt = live.billing_info?.next_billing_time
      ? new Date(live.billing_info.next_billing_time)
      : null;
    if (live.status === 'ACTIVE' && !cancelAt) {
      // Cancelling now would stop billing with no end date for the expiry cron
      // to act on — paid access forever. Refuse rather than cancel blind.
      throw new Error(`PayPal subscription ${customerRef} has no next_billing_time; cannot schedule its end`);
    }
    if (!alreadyCancelled) {
      await this._api('POST', `/v1/billing/subscriptions/${customerRef}/cancel`, {
        reason: 'Cancelled from Postmill',
      });
    }
    // A subscription that never became ACTIVE (approval pending, suspended with
    // nothing paid through) has nothing to keep alive.
    if (live.status !== 'ACTIVE' || !cancelAt) {
      return { cancelAt: new Date(), cancelAtPeriodEnd: false, canceledNow: true };
    }
    return { cancelAt, cancelAtPeriodEnd: false, canceledNow: false };
  }

  /** Live vendor state — the orchestrator's dunning guard reads this before opening a grace window. */
  async fetchSubscriptionState(input: { customerRef: string }): Promise<NormalizedSubscriptionState | null> {
    const live = await this._api<PaypalSubscription>('GET', `/v1/billing/subscriptions/${input.customerRef}`);
    return this._toState(live);
  }

  async cancelNow(customerRef: string): Promise<void> {
    await this._api('POST', `/v1/billing/subscriptions/${customerRef}/cancel`, {
      reason: 'Cancelled from Postmill',
    });
  }

  async finishTrial(_customerRef: string): Promise<void> {
    // A PayPal trial cycle cannot be shortened after approval.
    throw new PaymentsUnsupportedOperationError(this.name, 'finishTrial');
  }

  async checkoutStatus(input: {
    customerRef: string | null;
    identifier: string;
    providerRef?: string;
  }): Promise<'pending' | 'canceled' | 'unknown'> {
    const ref = input.providerRef || input.customerRef;
    if (!ref) {
      return 'unknown';
    }
    try {
      const live = await this._api<PaypalSubscription>('GET', `/v1/billing/subscriptions/${ref}`);
      if (live.status === 'CANCELLED' || live.status === 'EXPIRED') {
        return 'canceled';
      }
      return 'pending';
    } catch {
      return 'unknown';
    }
  }

  /** The post-checkout poll hands us PayPal's `subscription_id`; ACTIVE ⇒ activate now. */
  async pullSubscription(providerRef: string): Promise<NormalizedPaymentEvent[]> {
    const live = await this._api<PaypalSubscription>('GET', `/v1/billing/subscriptions/${providerRef}`);
    if (live.status !== 'ACTIVE') {
      return [];
    }
    const state = await this._toState(live);
    return state ? [{ type: 'subscription.activated', ...this._activationRefs(live), state }] : [];
  }

  // ---------------------------------------------------------------- charges

  async listCharges(customerRef: string): Promise<PaymentsCharge[]> {
    const live = await this._api<PaypalSubscription>('GET', `/v1/billing/subscriptions/${customerRef}`);
    const start = live.start_time || new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString();
    const end = new Date().toISOString();
    const res = await this._api<{
      transactions?: Array<{
        id: string;
        status: string;
        time: string;
        amount_with_breakdown?: { gross_amount?: { value: string; currency_code: string } };
      }>;
    }>(
      'GET',
      `/v1/billing/subscriptions/${customerRef}/transactions?start_time=${encodeURIComponent(start)}&end_time=${encodeURIComponent(end)}`,
    );
    return (res.transactions || [])
      .filter((t) => t.status === 'COMPLETED' || t.status === 'PARTIALLY_REFUNDED' || t.status === 'REFUNDED')
      .map((t) => ({
        id: t.id,
        amountCents: Math.round(Number(t.amount_with_breakdown?.gross_amount?.value || 0) * 100),
        currency: (t.amount_with_breakdown?.gross_amount?.currency_code || 'USD').toLowerCase(),
        createdAt: new Date(t.time),
        refunded: t.status === 'REFUNDED' || t.status === 'PARTIALLY_REFUNDED',
        amountRefundedCents: 0,
        description: null,
        receiptUrl: null,
        invoicePdfUrl: null,
      }));
  }

  async refund(_customerRef: string, chargeIds: string[]) {
    const refunded: string[] = [];
    const failed: string[] = [];
    for (const id of chargeIds) {
      try {
        // Subscription payments surface as v1 sales; newer accounts return v2 captures.
        try {
          await this._api('POST', `/v1/payments/sale/${id}/refund`, {});
        } catch {
          await this._api('POST', `/v2/payments/captures/${id}/refund`, {});
        }
        refunded.push(id);
      } catch {
        failed.push(id);
      }
    }
    return { refunded, failed };
  }

  // ---------------------------------------------------------------- webhooks

  async receiveWebhook(input: PaymentsWebhookInput): Promise<WebhookReceipt> {
    const h = (name: string) => input.headers[name] || input.headers[name.toLowerCase()] || '';
    let event: {
      id: string;
      event_type: string;
      resource?: any;
    };
    try {
      event = JSON.parse(input.rawBody.toString('utf8'));
    } catch {
      throw new PaymentsWebhookVerificationError('Malformed PayPal webhook body');
    }

    let verification: { verification_status?: string };
    try {
      verification = await this._api('POST', '/v1/notifications/verify-webhook-signature', {
        auth_algo: h('paypal-auth-algo'),
        cert_url: h('paypal-cert-url'),
        transmission_id: h('paypal-transmission-id'),
        transmission_sig: h('paypal-transmission-sig'),
        transmission_time: h('paypal-transmission-time'),
        webhook_id: process.env.PAYPAL_WEBHOOK_ID || '',
        // Must be the payload exactly as delivered — PayPal re-hashes it.
        webhook_event: event,
      });
    } catch (err) {
      // The verification API itself failed — not a forgery verdict. Let the
      // webhook answer 500 so PayPal redelivers once PayPal is back.
      throw new Error(`PayPal webhook verification call failed: ${(err as Error)?.message ?? err}`);
    }
    if (verification?.verification_status !== 'SUCCESS') {
      throw new PaymentsWebhookVerificationError('PayPal webhook signature verification failed');
    }

    const events = await this._translate(event.event_type, event.resource || {});
    return { eventId: event.id, eventType: event.event_type, events };
  }

  /** Activation refs carry the org hint from `custom_id`; every other event resolves by ref alone. */
  private _activationRefs(sub: PaypalSubscription): { customerRef: string; orgIdHint?: string } {
    const orgIdHint = sub.custom_id?.split('|')[0] || undefined;
    return { customerRef: sub.id, ...(orgIdHint ? { orgIdHint } : {}) };
  }

  private _refs(sub: PaypalSubscription): { customerRef: string } {
    return { customerRef: sub.id };
  }

  private async _toState(sub: PaypalSubscription): Promise<NormalizedSubscriptionState | null> {
    const plan = await this._planTier(sub.plan_id);
    if (!plan) {
      return null;
    }
    const identifier = sub.custom_id?.split('|')[1] || sub.id;
    const status = this._toStatus(sub.status);
    const cancelAt =
      sub.status === 'CANCELLED' && sub.billing_info?.next_billing_time
        ? new Date(sub.billing_info.next_billing_time)
        : null;
    const isTrialing = !!sub.billing_info?.cycle_executions?.some(
      (c) => c.tenure_type === 'TRIAL' && (c.cycles_remaining ?? 0) > 0,
    );
    return {
      tier: plan.tier,
      period: plan.period,
      status,
      identifier,
      providerSubscriptionRef: sub.id,
      isTrialing,
      cancelAt,
      pendingTier: null,
    };
  }

  private _toStatus(status: string): NormalizedSubscriptionState['status'] {
    switch (status) {
      case 'ACTIVE':
        return 'active';
      case 'SUSPENDED':
        return 'past_due';
      case 'APPROVAL_PENDING':
      case 'APPROVED':
        return 'incomplete';
      default:
        return 'canceled';
    }
  }

  private async _translate(type: string, resource: any): Promise<NormalizedPaymentEvent[]> {
    switch (type) {
      case 'BILLING.SUBSCRIPTION.ACTIVATED':
      case 'BILLING.SUBSCRIPTION.RE-ACTIVATED':
      case 'BILLING.SUBSCRIPTION.UPDATED': {
        const sub = resource as PaypalSubscription;
        const state = await this._toState(sub);
        if (!state) {
          return [];
        }
        return [
          type === 'BILLING.SUBSCRIPTION.UPDATED'
            ? { type: 'subscription.updated', ...this._refs(sub), state }
            : { type: 'subscription.activated', ...this._activationRefs(sub), state },
        ];
      }
      case 'BILLING.SUBSCRIPTION.SUSPENDED': {
        const sub = resource as PaypalSubscription;
        return [{ type: 'subscription.past_due', ...this._refs(sub), providerSubscriptionRef: sub.id }];
      }
      case 'BILLING.SUBSCRIPTION.CANCELLED': {
        // The webhook payload may omit billing_info; the live subscription is
        // authoritative for the paid-through date (a missing one here would
        // tear a paid user down immediately).
        const sub = await this._api<PaypalSubscription>(
          'GET',
          `/v1/billing/subscriptions/${(resource as PaypalSubscription).id}`,
        );
        const until = sub.billing_info?.next_billing_time ? new Date(sub.billing_info.next_billing_time) : null;
        if (!until || until.getTime() <= Date.now()) {
          return [{ type: 'subscription.canceled', ...this._refs(sub) }];
        }
        // Access runs to the paid-through date; the expiry cron ends it.
        const state = await this._toState(sub);
        if (!state) {
          return [{ type: 'subscription.canceled', ...this._refs(sub) }];
        }
        return [
          {
            type: 'subscription.updated',
            ...this._refs(sub),
            state: { ...state, status: 'active', cancelAt: until },
          },
        ];
      }
      case 'BILLING.SUBSCRIPTION.EXPIRED': {
        const sub = resource as PaypalSubscription;
        return [{ type: 'subscription.canceled', ...this._refs(sub) }];
      }
      case 'BILLING.SUBSCRIPTION.PAYMENT.FAILED': {
        const sub = resource as PaypalSubscription;
        return [{ type: 'payment.failed', ...this._refs(sub), providerSubscriptionRef: sub.id }];
      }
      case 'PAYMENT.SALE.COMPLETED': {
        const subId: string | undefined = resource.billing_agreement_id;
        if (!subId) {
          return [];
        }
        // No amount ⇒ omit it: the orchestrator then skips conversion tracking
        // rather than recording a $0 purchase.
        const total = Number(resource.amount?.total);
        return [
          {
            type: 'payment.succeeded',
            customerRef: subId,
            ...(resource.amount?.total !== undefined && Number.isFinite(total)
              ? { amountCents: Math.round(total * 100) }
              : {}),
            currency: (resource.amount?.currency || 'USD').toLowerCase(),
            isAddon: false,
            providerSubscriptionRef: subId,
            subscriptionStatus: 'active',
          },
        ];
      }
      default:
        return [];
    }
  }
}

const _meta = new PaypalPaymentsAdapter((async () => {
  throw new Error('metadata instance');
}) as unknown as SafeFetchPort);

export const paypalPaymentsModule: ProviderModule<any, any> = {
  metadata: providerMetadata,
  manifest: {
    domain: 'payments',
    providerId: _meta.name,
    version: 'v1',
    displayName: 'PayPal',
    status: 'active',
    credentialFields: [],
    capabilities: _meta.capabilities,
    platformConnect: 'env',
    docsUrl: 'https://developer.paypal.com/docs/subscriptions/',
    webhookInstructions:
      'developer.paypal.com → My Apps & Credentials → your app → Webhooks → add `https://<backend>/payments/webhooks/paypal` for BILLING.SUBSCRIPTION.* and PAYMENT.SALE.COMPLETED; paste the Webhook ID into PAYPAL_WEBHOOK_ID.',
  },
  create: (ctx: ProviderRuntimeContext) => new PaypalPaymentsAdapter(ctx.fetch),
};
