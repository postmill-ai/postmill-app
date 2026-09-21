/**
 * Payments domain — platform-level subscription billing (Stripe, PayPal, the
 * Apple App Store, Google Play, …). Unlike BYOK domains a payments provider is
 * enabled by operator `.env` keys, never per org; `PAYMENTS_PROVIDER` picks
 * the default provider for web checkout.
 *
 * Division of labour:
 * - The **adapter** talks to the vendor only. It creates checkouts, mutates
 *   vendor subscriptions, verifies webhooks/receipts and translates vendor
 *   events into `NormalizedPaymentEvent`s. It never sees the database.
 * - The **orchestrator** (`PaymentsService` in nestjs-libraries) owns every
 *   `Subscription`/`Organization` transition, idempotency, dunning grace,
 *   audit and purchase tracking. `applyEvent()` is the single sink.
 *
 * `checkoutMode` splits providers into two families:
 * - `hosted` / `embedded` — the web app starts the purchase (`createCheckout`).
 * - `native` — a mobile app buys through the store; the server only verifies
 *   the purchase (`verifyPurchase`) and consumes store notifications.
 */

export type PaymentsCheckoutMode = 'hosted' | 'embedded' | 'native';

/** Mirrors `SubscriptionTier` / `pricing.ts` — a nestjs-libraries spec asserts lockstep. */
export type PaymentsTier = 'STARTER' | 'PRO' | 'TEAM' | 'AGENCY';
export type PaymentsPeriod = 'MONTHLY' | 'YEARLY';
export type PaymentsSubscriptionStatus =
  | 'active'
  | 'trialing'
  | 'incomplete'
  | 'past_due'
  | 'canceled';

export interface PaymentsCapabilityFlags {
  checkoutMode: PaymentsCheckoutMode;
  /** `manageUrl` — a vendor-hosted place to change card / see invoices (or the store's subscription page). */
  portal: boolean;
  /** `previewProration` — the vendor can quote the immediate charge of a plan change. */
  proration: boolean;
  /** `upsertAddon` / `cancelAddon` / `listAddonQuantities`. */
  addons: boolean;
  /** `listCharges` + `refund`. */
  refunds: boolean;
  /** `checkDiscount` / `applyDiscount` (auto-apply coupon on checkout). */
  promoCodes: boolean;
  /** The vendor runs the free trial (`allowTrial` honoured on checkout; `finishTrial` for web). */
  trials: boolean;
  /** `verifyPaymentMethod` — an authorise-and-void card check on trial subscriptions. */
  cardCheck: boolean;
  /** `listCharges`. */
  chargesHistory: boolean;
  /**
   * `setCancelAtPeriodEnd(ref, true)` keeps the vendor subscription alive until
   * the period end and can be undone. When false the adapter cancels at the
   * vendor immediately and returns the period end as `cancelAt`; the
   * orchestrator keeps the `Subscription` row until then.
   */
  periodEndCancel: boolean;
  /** `changePlan` — the web app can move an existing subscription between tiers. */
  planChange: boolean;
}

/** Browser-safe view of a configured provider. Never carries a secret. */
export interface PaymentsPublicConfig {
  providerId: string;
  checkoutMode: PaymentsCheckoutMode;
  /** Publishable key / client id the checkout UI needs (Stripe publishable key, PayPal client id). */
  publicKey?: string;
  capabilities: PaymentsCapabilityFlags;
}

export interface NormalizedSubscriptionState {
  tier: PaymentsTier;
  period: PaymentsPeriod;
  status: PaymentsSubscriptionStatus;
  /** App-generated purchase id (`Subscription.identifier`), echoed back by the vendor. */
  identifier: string;
  /** Vendor subscription reference: `sub_…`, `I-…`, originalTransactionId, purchaseToken. */
  providerSubscriptionRef: string;
  isTrialing: boolean;
  /** Set when the subscription is scheduled to end (period-end cancel, store auto-renew off). */
  cancelAt?: Date | null;
  /** A downgrade the vendor will apply at the next renewal. */
  pendingTier?: PaymentsTier | null;
  /** Store-side entitlement expiry, when the vendor exposes it. */
  expiresAt?: Date | null;
}

interface NormalizedEventBase {
  /**
   * Vendor customer/account reference the org is bound to (`Organization.paymentId`):
   * Stripe customer id, PayPal subscription id, Apple originalTransactionId,
   * Google purchaseToken. For Google this is the NEW token after a plan change
   * (`linkedPurchaseToken`) — the orchestrator re-points the org.
   */
  customerRef: string;
  /**
   * Org id the vendor echoed back (Apple `appAccountToken`, Google
   * `obfuscatedExternalAccountId`, PayPal `custom_id`). Used to bind an org on
   * first activation when no `customerRef` is known yet. Trusted only after the
   * adapter verified the vendor signature.
   */
  orgIdHint?: string;
}

export type NormalizedPaymentEvent =
  | (NormalizedEventBase & {
      type: 'subscription.activated' | 'subscription.updated';
      state: NormalizedSubscriptionState;
      /** Ask the orchestrator to run `verifyPaymentMethod` when the org is on a trial. */
      requiresCardCheck?: boolean;
    })
  | (NormalizedEventBase & {
      type: 'subscription.past_due';
      providerSubscriptionRef?: string;
    })
  | (NormalizedEventBase & { type: 'subscription.canceled' })
  | (NormalizedEventBase & {
      type: 'payment.succeeded';
      /** Omitted when the vendor does not expose the amount (Google RTDN); the orchestrator falls back to `pricing`. */
      amountCents?: number;
      currency: string;
      isAddon: boolean;
      providerSubscriptionRef?: string;
      /** `metadata.userId` — attributes the purchase to a user for conversion tracking. */
      userIdHint?: string;
      /** `metadata.ud` — the tracking cookie captured at checkout. */
      trackingRef?: string;
    })
  | (NormalizedEventBase & {
      type: 'payment.failed';
      providerSubscriptionRef?: string;
    })
  | (NormalizedEventBase & { type: 'addons.changed' });

export interface WebhookReceipt {
  /** Vendor event id — recorded for idempotency (Stripe `evt_…`, PayPal `WH-…`, Apple notificationUUID, Pub/Sub messageId). */
  eventId: string;
  eventType: string;
  /** Empty ⇒ nothing to apply; the event is still recorded and acknowledged. */
  events: NormalizedPaymentEvent[];
  /** Body the webhook controller must return verbatim (defaults to `{ ok: true }`). */
  ackBody?: unknown;
}

/** Signature / token verification failed — the controller answers 401. */
export class PaymentsWebhookVerificationError extends Error {
  constructor(message = 'Webhook verification failed') {
    super(message);
    this.name = 'PaymentsWebhookVerificationError';
  }
}

/** The bound provider cannot do this (e.g. un-cancel on PayPal) — the controller answers 400. */
export class PaymentsUnsupportedOperationError extends Error {
  constructor(
    public readonly provider: string,
    public readonly operation: string,
    message?: string,
  ) {
    super(message ?? `${provider} does not support ${operation}`);
    this.name = 'PaymentsUnsupportedOperationError';
  }
}

export interface PaymentsCheckoutRequest {
  /** Existing vendor customer ref, or null on first purchase. */
  customerRef: string | null;
  orgId: string;
  userId: string;
  email: string;
  tier: PaymentsTier;
  period: PaymentsPeriod;
  allowTrial: boolean;
  /** App-generated purchase id; the vendor must echo it back (`NormalizedSubscriptionState.identifier`). */
  identifier: string;
  trackingRef?: string;
  /** Free-form attribution the adapter forwards as vendor metadata (utm, dub, datafast…). */
  metadata: Record<string, string>;
  returnUrls: { success: string; cancel: string };
  /** `'embedded'` asks for a client-side checkout when the provider supports it. */
  mode: 'embedded' | 'hosted';
}

export type PaymentsCheckoutResult =
  | { kind: 'redirect'; url: string }
  | { kind: 'client_secret'; clientSecret: string; autoApplyCoupon?: string }
  | { kind: 'applied' }
  | { kind: 'portal'; url: string };

export interface PaymentsPlanChangeRequest {
  customerRef: string;
  currentTier: PaymentsTier;
  targetTier: PaymentsTier;
  period: PaymentsPeriod;
  direction: 'upgrade' | 'downgrade';
  identifier: string;
  userId: string;
  metadata: Record<string, string>;
}

export type PaymentsPlanChangeResult =
  | { kind: 'applied' }
  | { kind: 'pending'; tier: PaymentsTier }
  | { kind: 'redirect'; url: string }
  | { kind: 'portal'; url: string };

export interface PaymentsCharge {
  id: string;
  amountCents: number;
  currency: string;
  createdAt: Date;
  refunded: boolean;
  amountRefundedCents: number;
  description?: string | null;
  receiptUrl?: string | null;
  invoicePdfUrl?: string | null;
}

export interface PaymentsWebhookInput {
  rawBody: Buffer;
  headers: Record<string, string | undefined>;
  query: Record<string, string>;
}

export interface PaymentsCapability {
  name: string;
  capabilities: PaymentsCapabilityFlags;
  /** Every env key the adapter reads; the first one is the "enabled" switch. */
  requiredEnvKeys: string[];
  isConfigured(): boolean;
  publicConfig(): PaymentsPublicConfig;

  /** Verify and translate a vendor webhook. Throws `PaymentsWebhookVerificationError` on a bad signature. */
  receiveWebhook(input: PaymentsWebhookInput): Promise<WebhookReceipt>;

  // ---- web checkout (hosted / embedded) ----
  /** Return the vendor customer ref to bind the org to, or null when the vendor has no customer object. */
  ensureCustomer?(input: {
    orgId: string;
    orgName: string;
    email: string;
    existingRef: string | null;
  }): Promise<string | null>;
  createCheckout?(request: PaymentsCheckoutRequest): Promise<PaymentsCheckoutResult>;
  changePlan?(request: PaymentsPlanChangeRequest): Promise<PaymentsPlanChangeResult>;
  /** Called once a pending downgrade has been applied locally, so vendor metadata agrees. */
  commitPendingTier?(customerRef: string, tier: PaymentsTier): Promise<void>;
  previewProration?(input: {
    customerRef: string;
    tier: PaymentsTier;
    period: PaymentsPeriod;
  }): Promise<{ amountCents: number }>;
  setCancelAtPeriodEnd?(
    customerRef: string,
    cancel: boolean,
  ): Promise<{ cancelAt: Date | null; canceledNow: boolean }>;
  cancelNow?(customerRef: string): Promise<void>;
  finishTrial?(customerRef: string): Promise<void>;
  checkDiscount?(customerRef: string): Promise<boolean>;
  applyDiscount?(customerRef: string): Promise<boolean>;
  manageUrl?(customerRef: string | null, returnUrl: string): Promise<string>;

  // ---- add-ons ----
  upsertAddon?(customerRef: string, type: string, packs: number): Promise<void>;
  cancelAddon?(customerRef: string, type: string): Promise<void>;
  /** Packs per add-on type (keys are `ADDONS` keys); absent types mean 0. */
  listAddonQuantities?(customerRef: string): Promise<Record<string, number>>;

  // ---- charges ----
  listCharges?(customerRef: string): Promise<PaymentsCharge[]>;
  refund?(
    customerRef: string,
    chargeIds: string[],
  ): Promise<{ refunded: string[]; failed: string[] }>;

  // ---- orchestrator hooks ----
  /** Authorise-and-void card check; false ⇒ the adapter already cancelled the vendor subscription. */
  verifyPaymentMethod?(input: {
    customerRef: string;
    providerSubscriptionRef: string;
  }): Promise<boolean>;
  /** Live vendor state, used to guard dunning transitions against out-of-order webhooks. */
  fetchSubscriptionState?(input: {
    customerRef: string;
    providerSubscriptionRef?: string;
  }): Promise<NormalizedSubscriptionState | null>;
  /** Post-checkout poll: has the purchase identified by `identifier` been abandoned? */
  checkoutStatus?(input: {
    customerRef: string | null;
    identifier: string;
    providerRef?: string;
  }): Promise<'pending' | 'canceled' | 'unknown'>;
  /** Pull the current vendor state as events (for providers whose webhooks lag the redirect). */
  pullSubscription?(providerRef: string): Promise<NormalizedPaymentEvent[]>;

  // ---- native (store) purchases ----
  /** Verify a store purchase handed over by the mobile app and translate it into events. */
  verifyPurchase?(input: { orgId: string; payload: unknown }): Promise<NormalizedPaymentEvent[]>;
}
