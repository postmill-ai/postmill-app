import { createHash } from 'node:crypto';
import {
  AppStoreServerAPIClient,
  Environment,
  SignedDataVerifier,
  Status,
  VerificationStatus,
} from '@apple/app-store-server-library';
import type {
  JWSRenewalInfoDecodedPayload,
  JWSTransactionDecodedPayload,
  ResponseBodyV2DecodedPayload,
} from '@apple/app-store-server-library';
import { metadata as providerMetadata } from './metadata';
import { appleRootCertificates } from './apple-root-cas';
import {
  NormalizedPaymentEvent,
  NormalizedSubscriptionState,
  PaymentsCapability,
  PaymentsCapabilityFlags,
  PaymentsPublicConfig,
  PaymentsSubscriptionStatus,
  PaymentsTier,
  PaymentsWebhookInput,
  PaymentsWebhookVerificationError,
  ProviderModule,
  WebhookReceipt,
  parseStoreProductId,
} from '@postmill-ai/provider-kernel';

const MANAGE_URL = 'https://apps.apple.com/account/subscriptions';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/**
 * Apple-signed payload that belongs to another app or the other environment.
 * The library verifies the signature BEFORE checking bundle id / environment,
 * so this never means "forged" — it means "not ours".
 */
class AppleForeignPayloadError extends Error {
  override readonly name = 'AppleForeignPayloadError';
  constructor(readonly status: VerificationStatus) {
    super(
      `Apple payload is for another ${status === VerificationStatus.INVALID_ENVIRONMENT ? 'environment' : 'app'}`,
    );
  }
}

// Duck-typed: the VerificationException class identity is not stable across
// module realms (or the spec mock), but its numeric `status` is.
const verificationStatusOf = (err: unknown): VerificationStatus | undefined => {
  const status = (err as { status?: unknown })?.status;
  return typeof status === 'number' ? (status as VerificationStatus) : undefined;
};
const message = (err: unknown) => (err as Error)?.message ?? String(err);

/**
 * App Store payments adapter (`checkoutMode: 'native'`). The mobile app buys
 * a subscription through StoreKit and hands the signed transaction (JWS) to
 * `POST /billing/native/verify`; Apple's App Store Server Notifications V2
 * land on `POST /payments/webhooks/apple`. Both are verified against Apple's
 * root certificates with `@apple/app-store-server-library`.
 *
 * Binding: the app sets `appAccountToken` to the Postmill organization id (a
 * UUID, which is what Apple requires) at purchase time; the server refuses a
 * purchase whose token does not match the calling org. `customerRef` is the
 * `originalTransactionId`, stable across renewals and plan changes.
 *
 * Products: `<PAYMENTS_APPLE_PRODUCT_PREFIX>.<tier>.<monthly|yearly>` in one
 * subscription group; the introductory offer is the trial (store-managed).
 * No add-ons, refunds, portal beyond the store's subscription page, or plan
 * changes from the web — the store owns all of that.
 */
export class ApplePaymentsAdapter implements PaymentsCapability {
  readonly name = 'apple';
  readonly capabilities: PaymentsCapabilityFlags = {
    checkoutMode: 'native',
    portal: true,
    proration: false,
    addons: false,
    refunds: false,
    promoCodes: false,
    trials: true,
    cardCheck: false,
    chargesHistory: false,
    // The store owns cancellation (the user cancels in Settings → Subscriptions);
    // the web app only links there via manageUrl.
    periodEndCancel: false,
    planChange: false,
  };
  readonly requiredEnvKeys = [
    'APPLE_IAP_BUNDLE_ID',
    'APPLE_IAP_ISSUER_ID',
    'APPLE_IAP_KEY_ID',
    'APPLE_IAP_PRIVATE_KEY',
    // Apple's verifier refuses to validate Production payloads without the app's numeric id.
    'APPLE_IAP_APP_APPLE_ID',
  ];

  private _verifiers: SignedDataVerifier[] | null = null;
  private _clients = new Map<Environment, AppStoreServerAPIClient>();

  isConfigured(): boolean {
    return !!process.env.APPLE_IAP_BUNDLE_ID;
  }

  publicConfig(): PaymentsPublicConfig {
    return {
      providerId: this.name,
      checkoutMode: this.capabilities.checkoutMode,
      capabilities: this.capabilities,
    };
  }

  private get _bundleId(): string {
    return process.env.APPLE_IAP_BUNDLE_ID || '';
  }

  private get _prefix(): string {
    return process.env.PAYMENTS_APPLE_PRODUCT_PREFIX || 'postmill';
  }

  /**
   * Sandbox payloads are genuinely Apple-signed, so with sandbox accepted on a
   * production backend anyone with a TestFlight build could "buy" a real tier.
   * `APPLE_IAP_SANDBOX_ORG_IDS` restricts sandbox purchases to listed orgs;
   * unset means every org (documented as a launch-only setting).
   */
  private _sandboxAllowedFor(orgId: string | undefined, environment?: string): boolean {
    if (environment !== Environment.SANDBOX) {
      return true;
    }
    if (!this._environments().includes(Environment.SANDBOX)) {
      return false;
    }
    const allowlist = (process.env.APPLE_IAP_SANDBOX_ORG_IDS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return allowlist.length === 0 || (!!orgId && allowlist.includes(orgId));
  }

  private _environments(): Environment[] {
    const primary =
      (process.env.APPLE_IAP_ENV || 'Production').toLowerCase() === 'sandbox'
        ? Environment.SANDBOX
        : Environment.PRODUCTION;
    const envs = [primary];
    // Sandbox testers and TestFlight builds talk to the production backend, so a
    // production deployment usually needs to accept sandbox payloads too.
    if (primary === Environment.PRODUCTION && process.env.APPLE_IAP_ALLOW_SANDBOX === 'true') {
      envs.push(Environment.SANDBOX);
    }
    return envs;
  }

  private _verifierSet(): SignedDataVerifier[] {
    if (!this._verifiers) {
      const appAppleId = process.env.APPLE_IAP_APP_APPLE_ID
        ? Number(process.env.APPLE_IAP_APP_APPLE_ID)
        : undefined;
      this._verifiers = this._environments().map(
        (env) => new SignedDataVerifier(appleRootCertificates(), true, env, this._bundleId, appAppleId),
      );
    }
    return this._verifiers;
  }

  private _client(env: Environment): AppStoreServerAPIClient {
    let client = this._clients.get(env);
    if (!client) {
      const key = Buffer.from(process.env.APPLE_IAP_PRIVATE_KEY || '', 'base64').toString('utf8');
      client = new AppStoreServerAPIClient(
        key,
        process.env.APPLE_IAP_KEY_ID || '',
        process.env.APPLE_IAP_ISSUER_ID || '',
        this._bundleId,
        env,
      );
      this._clients.set(env, client);
    }
    return client;
  }

  /**
   * Try each accepted environment's verifier; the first that validates wins.
   * When none does, the outcome is decided by precedence definitive > retryable
   * > foreign: a signature/chain failure anywhere is a forgery (401); else a
   * transient failure (OCSP/network) is a plain error (500 — Apple retries);
   * else every verifier said "another app / environment", which the caller may
   * acknowledge without acting on.
   */
  private async _verifyWith<T>(fn: (v: SignedDataVerifier) => Promise<T>): Promise<T> {
    let verifiers: SignedDataVerifier[];
    try {
      verifiers = this._verifierSet();
    } catch (err) {
      // e.g. "appAppleId is required when the environment is Production" — a
      // deployment misconfiguration, reported as a verification failure rather
      // than a crash so the vendor retries once the env is fixed.
      throw new PaymentsWebhookVerificationError(`Apple verifier could not be built: ${message(err)}`);
    }
    let definitive: unknown;
    let retryable: unknown;
    let foreign: VerificationStatus | undefined;
    for (const verifier of verifiers) {
      try {
        return await fn(verifier);
      } catch (err) {
        switch (verificationStatusOf(err)) {
          case VerificationStatus.RETRYABLE_VERIFICATION_FAILURE:
            retryable = err;
            break;
          case VerificationStatus.INVALID_APP_IDENTIFIER:
            foreign = VerificationStatus.INVALID_APP_IDENTIFIER;
            break;
          case VerificationStatus.INVALID_ENVIRONMENT:
            foreign ??= VerificationStatus.INVALID_ENVIRONMENT;
            break;
          default:
            definitive = err;
        }
      }
    }
    if (definitive) {
      throw new PaymentsWebhookVerificationError(
        `Apple signed payload verification failed: ${message(definitive)}`,
      );
    }
    if (retryable) {
      throw new Error(`Apple signed payload verification is temporarily unavailable: ${message(retryable)}`);
    }
    throw new AppleForeignPayloadError(foreign ?? VerificationStatus.INVALID_ENVIRONMENT);
  }

  /** `_verifyWith`, but a foreign payload is a verification failure (receipts handed over by the app must be ours). */
  private async _verifyStrict<T>(fn: (v: SignedDataVerifier) => Promise<T>): Promise<T> {
    try {
      return await this._verifyWith(fn);
    } catch (err) {
      if (err instanceof AppleForeignPayloadError) {
        throw new PaymentsWebhookVerificationError(err.message);
      }
      throw err;
    }
  }

  private _envOf(value?: string): Environment {
    return value === Environment.SANDBOX ? Environment.SANDBOX : Environment.PRODUCTION;
  }

  // ---------------------------------------------------------------- native purchase

  async verifyPurchase(input: { orgId: string; payload: unknown }): Promise<NormalizedPaymentEvent[]> {
    const jws = (input.payload as { jws?: string })?.jws;
    if (!jws || typeof jws !== 'string') {
      throw new PaymentsWebhookVerificationError('Apple purchase payload must carry the signed transaction as `jws`');
    }
    const transaction = await this._verifyStrict((v) => v.verifyAndDecodeTransaction(jws));
    if (transaction.bundleId && transaction.bundleId !== this._bundleId) {
      throw new PaymentsWebhookVerificationError('Apple transaction belongs to another app');
    }
    if (transaction.appAccountToken !== input.orgId) {
      throw new PaymentsWebhookVerificationError(
        'Apple transaction appAccountToken does not match the organization',
      );
    }
    if (!this._sandboxAllowedFor(input.orgId, transaction.environment)) {
      throw new PaymentsWebhookVerificationError(
        'Apple sandbox purchases are not accepted for this organization',
      );
    }
    if (!transaction.originalTransactionId) {
      return [];
    }

    // The signed transaction proves the purchase; the subscription-status API is
    // authoritative for the current state and carries the renewal info. No
    // matching status item ⇒ fail closed (a stale or foreign transaction must
    // not activate anything).
    const client = this._client(this._envOf(transaction.environment));
    const statuses = await client.getAllSubscriptionStatuses(transaction.originalTransactionId);
    let status: PaymentsSubscriptionStatus | null = null;
    let renewal: JWSRenewalInfoDecodedPayload | undefined;
    for (const group of statuses.data || []) {
      for (const item of group.lastTransactions || []) {
        if (item.originalTransactionId !== transaction.originalTransactionId) continue;
        status = this._toStatus(item.status);
        if (item.signedRenewalInfo) {
          renewal = await this._verifyStrict((v) => v.verifyAndDecodeRenewalInfo(item.signedRenewalInfo!));
        }
      }
    }
    if (status === null) {
      throw new PaymentsWebhookVerificationError(
        'App Store reports no subscription for this transaction',
      );
    }
    if (status === 'canceled') {
      return [{ type: 'subscription.canceled', customerRef: transaction.originalTransactionId, orgIdHint: input.orgId }];
    }
    const state = this._toState(transaction, renewal, status);
    if (!state) {
      return [];
    }
    return [
      {
        type: 'subscription.activated',
        customerRef: transaction.originalTransactionId,
        orgIdHint: input.orgId,
        state,
      },
    ];
  }

  private _toStatus(status?: Status | number): PaymentsSubscriptionStatus {
    switch (status) {
      case Status.ACTIVE:
        return 'active';
      case Status.BILLING_RETRY:
      case Status.BILLING_GRACE_PERIOD:
        return 'past_due';
      case Status.EXPIRED:
      case Status.REVOKED:
        return 'canceled';
      default:
        // Unknown status: never grant access on a guess.
        return 'incomplete';
    }
  }

  private _toState(
    transaction: JWSTransactionDecodedPayload,
    renewal: JWSRenewalInfoDecodedPayload | undefined,
    status: PaymentsSubscriptionStatus,
  ): NormalizedSubscriptionState | null {
    const plan = transaction.productId ? parseStoreProductId(this._prefix, transaction.productId) : null;
    if (!plan || !transaction.originalTransactionId) {
      return null;
    }
    const expiresAt = transaction.expiresDate ? new Date(transaction.expiresDate) : null;
    const autoRenewOff = renewal?.autoRenewStatus === 0;
    const pending = renewal?.autoRenewProductId
      ? parseStoreProductId(this._prefix, renewal.autoRenewProductId)
      : null;
    return {
      tier: plan.tier,
      period: plan.period,
      status,
      identifier: transaction.originalTransactionId,
      providerSubscriptionRef: transaction.originalTransactionId,
      // An introductory offer is a trial only when it is free; older payloads
      // carry offerType without offerDiscountType.
      isTrialing:
        transaction.offerDiscountType === 'FREE_TRIAL' ||
        (transaction.offerType === 1 && !transaction.offerDiscountType),
      cancelAt: autoRenewOff ? expiresAt : null,
      pendingTier: pending && pending.tier !== plan.tier ? pending.tier : null,
      expiresAt,
    };
  }

  // ---------------------------------------------------------------- notifications

  async receiveWebhook(input: PaymentsWebhookInput): Promise<WebhookReceipt> {
    let body: { signedPayload?: string };
    try {
      body = JSON.parse(input.rawBody.toString('utf8'));
    } catch {
      throw new PaymentsWebhookVerificationError('Malformed App Store notification body');
    }
    if (!body?.signedPayload) {
      throw new PaymentsWebhookVerificationError('App Store notification is missing signedPayload');
    }
    let notification: ResponseBodyV2DecodedPayload;
    try {
      notification = await this._verifyWith((v) => v.verifyAndDecodeNotification(body.signedPayload!));
    } catch (err) {
      if (err instanceof AppleForeignPayloadError) {
        // Genuinely Apple-signed, but for another app or the other environment:
        // acknowledge so Apple stops redelivering, without a ledger row.
        return {
          eventId: `apple:foreign:${sha256(body.signedPayload)}`,
          eventType: `apple.foreign.${
            err.status === VerificationStatus.INVALID_ENVIRONMENT ? 'environment' : 'app'
          }`,
          events: [],
          skipRecord: true,
        };
      }
      throw err;
    }
    // Deterministic fallback id so a redelivery without a UUID stays idempotent.
    const eventId = notification.notificationUUID || `apple:${sha256(body.signedPayload)}`;
    const eventType = `${notification.notificationType}${notification.subtype ? `.${notification.subtype}` : ''}`;
    const events = await this._translate(notification);
    return { eventId, eventType, events };
  }

  private async _translate(n: ResponseBodyV2DecodedPayload): Promise<NormalizedPaymentEvent[]> {
    const data = n.data;
    if (!data?.signedTransactionInfo) {
      return [];
    }
    const transaction = await this._verifyStrict((v) => v.verifyAndDecodeTransaction(data.signedTransactionInfo!));
    const renewal = data.signedRenewalInfo
      ? await this._verifyStrict((v) => v.verifyAndDecodeRenewalInfo(data.signedRenewalInfo!))
      : undefined;
    const customerRef = transaction.originalTransactionId;
    if (!customerRef) {
      return [];
    }
    if (!this._sandboxAllowedFor(transaction.appAccountToken, data.environment)) {
      return [];
    }
    // Hints bind an org on activation only; cancel/past-due events resolve by ref.
    const refs = {
      customerRef,
      ...(transaction.appAccountToken ? { orgIdHint: transaction.appAccountToken } : {}),
    };
    const byRef = { customerRef };
    const status = this._toStatus(data.status);
    const state = this._toState(transaction, renewal, status === 'canceled' ? 'active' : status);
    const activated = (): NormalizedPaymentEvent[] =>
      state ? [{ type: 'subscription.activated', ...refs, state }] : [];
    const updated = (patch: Partial<NormalizedSubscriptionState> = {}): NormalizedPaymentEvent[] =>
      state ? [{ type: 'subscription.updated', ...byRef, state: { ...state, ...patch } }] : [];

    switch (n.notificationType) {
      case 'SUBSCRIBED':
        return activated();
      case 'DID_RENEW':
        return [
          {
            type: 'payment.succeeded',
            ...byRef,
            ...(typeof transaction.price === 'number'
              ? { amountCents: Math.round(transaction.price / 10) }
              : {}),
            currency: (transaction.currency || 'USD').toLowerCase(),
            isAddon: false,
            providerSubscriptionRef: customerRef,
            subscriptionStatus: 'active',
          },
          ...updated({ status: 'active' }),
        ];
      case 'DID_CHANGE_RENEWAL_PREF':
      case 'DID_CHANGE_RENEWAL_STATUS':
      case 'RENEWAL_EXTENDED':
      case 'RENEWAL_EXTENSION':
      case 'OFFER_REDEEMED':
        return updated();
      case 'DID_FAIL_TO_RENEW':
        return [{ type: 'subscription.past_due', ...byRef, providerSubscriptionRef: customerRef }];
      case 'GRACE_PERIOD_EXPIRED':
      case 'EXPIRED':
      case 'REVOKE':
        return [{ type: 'subscription.canceled', ...byRef }];
      case 'REFUND':
        // A refunded renewal on a still-active subscription keeps the entitlement;
        // only a refund that ends it (status expired/revoked) tears down.
        return status === 'canceled' ? [{ type: 'subscription.canceled', ...byRef }] : updated();
      case 'REFUND_REVERSED':
        return activated();
      default:
        // TEST, CONSUMPTION_REQUEST, PRICE_INCREASE, REFUND_DECLINED, ONE_TIME_CHARGE, …
        return [];
    }
  }

  async fetchSubscriptionState(input: {
    customerRef: string;
  }): Promise<NormalizedSubscriptionState | null> {
    for (const env of this._environments()) {
      try {
        const statuses = await this._client(env).getAllSubscriptionStatuses(input.customerRef);
        for (const group of statuses.data || []) {
          for (const item of group.lastTransactions || []) {
            if (item.originalTransactionId !== input.customerRef || !item.signedTransactionInfo) continue;
            const transaction = await this._verifyStrict((v) => v.verifyAndDecodeTransaction(item.signedTransactionInfo!));
            const renewal = item.signedRenewalInfo
              ? await this._verifyStrict((v) => v.verifyAndDecodeRenewalInfo(item.signedRenewalInfo!))
              : undefined;
            return this._toState(transaction, renewal, this._toStatus(item.status));
          }
        }
      } catch {
        // try the next environment
      }
    }
    return null;
  }

  async manageUrl(): Promise<string> {
    return MANAGE_URL;
  }
}

const _meta = new ApplePaymentsAdapter();

export const applePaymentsModule: ProviderModule<any, any> = {
  metadata: providerMetadata,
  manifest: {
    domain: 'payments',
    providerId: _meta.name,
    version: 'v1',
    displayName: 'App Store',
    status: 'active',
    credentialFields: [],
    capabilities: _meta.capabilities,
    platformConnect: 'env',
    docsUrl: 'https://developer.apple.com/documentation/appstoreservernotifications',
    webhookInstructions:
      'App Store Connect → your app → App Information → App Store Server Notifications → set the Production (and Sandbox) URL to `https://<backend>/payments/webhooks/apple` (version 2).',
  },
  create: () => new ApplePaymentsAdapter(),
};
