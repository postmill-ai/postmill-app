import {
  AppStoreServerAPIClient,
  Environment,
  SignedDataVerifier,
  Status,
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
    periodEndCancel: true,
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

  /** Try each accepted environment's verifier; the first that validates wins. */
  private async _verifyWith<T>(fn: (v: SignedDataVerifier) => Promise<T>): Promise<T> {
    let lastError: unknown;
    let verifiers: SignedDataVerifier[];
    try {
      verifiers = this._verifierSet();
    } catch (err) {
      // e.g. "appAppleId is required when the environment is Production" — a
      // deployment misconfiguration, reported as a verification failure rather
      // than a crash so the vendor retries once the env is fixed.
      throw new PaymentsWebhookVerificationError(
        `Apple verifier could not be built: ${(err as Error)?.message ?? err}`,
      );
    }
    for (const verifier of verifiers) {
      try {
        return await fn(verifier);
      } catch (err) {
        lastError = err;
      }
    }
    throw new PaymentsWebhookVerificationError(
      `Apple signed payload verification failed: ${(lastError as Error)?.message ?? lastError}`,
    );
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
    const transaction = await this._verifyWith((v) => v.verifyAndDecodeTransaction(jws));
    if (transaction.bundleId && transaction.bundleId !== this._bundleId) {
      throw new PaymentsWebhookVerificationError('Apple transaction belongs to another app');
    }
    if (transaction.appAccountToken !== input.orgId) {
      throw new PaymentsWebhookVerificationError(
        'Apple transaction appAccountToken does not match the organization',
      );
    }
    if (!transaction.originalTransactionId) {
      return [];
    }

    // The signed transaction proves the purchase; the subscription-status API is
    // authoritative for the current state and carries the renewal info.
    const client = this._client(this._envOf(transaction.environment));
    const statuses = await client.getAllSubscriptionStatuses(transaction.originalTransactionId);
    let status: PaymentsSubscriptionStatus = 'active';
    let renewal: JWSRenewalInfoDecodedPayload | undefined;
    for (const group of statuses.data || []) {
      for (const item of group.lastTransactions || []) {
        if (item.originalTransactionId !== transaction.originalTransactionId) continue;
        status = this._toStatus(item.status);
        if (item.signedRenewalInfo) {
          renewal = await this._verifyWith((v) => v.verifyAndDecodeRenewalInfo(item.signedRenewalInfo!));
        }
      }
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
        return 'active';
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
      isTrialing: false,
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
    const notification = await this._verifyWith((v) => v.verifyAndDecodeNotification(body.signedPayload!));
    const eventId = notification.notificationUUID || `apple:${notification.signedDate ?? Date.now()}`;
    const eventType = `${notification.notificationType}${notification.subtype ? `.${notification.subtype}` : ''}`;
    const events = await this._translate(notification);
    return { eventId, eventType, events };
  }

  private async _translate(n: ResponseBodyV2DecodedPayload): Promise<NormalizedPaymentEvent[]> {
    const data = n.data;
    if (!data?.signedTransactionInfo) {
      return [];
    }
    const transaction = await this._verifyWith((v) => v.verifyAndDecodeTransaction(data.signedTransactionInfo!));
    const renewal = data.signedRenewalInfo
      ? await this._verifyWith((v) => v.verifyAndDecodeRenewalInfo(data.signedRenewalInfo!))
      : undefined;
    const customerRef = transaction.originalTransactionId;
    if (!customerRef) {
      return [];
    }
    const refs = {
      customerRef,
      ...(transaction.appAccountToken ? { orgIdHint: transaction.appAccountToken } : {}),
    };
    const status = this._toStatus(data.status);
    const state = this._toState(transaction, renewal, status === 'canceled' ? 'active' : status);
    const activated = (): NormalizedPaymentEvent[] =>
      state ? [{ type: 'subscription.activated', ...refs, state }] : [];
    const updated = (patch: Partial<NormalizedSubscriptionState> = {}): NormalizedPaymentEvent[] =>
      state ? [{ type: 'subscription.updated', ...refs, state: { ...state, ...patch } }] : [];

    switch (n.notificationType) {
      case 'SUBSCRIBED':
        return activated();
      case 'DID_RENEW':
        return [
          {
            type: 'payment.succeeded',
            ...refs,
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
        return [{ type: 'subscription.past_due', ...refs, providerSubscriptionRef: customerRef }];
      case 'GRACE_PERIOD_EXPIRED':
      case 'EXPIRED':
      case 'REVOKE':
      case 'REFUND':
        return [{ type: 'subscription.canceled', ...refs }];
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
            const transaction = await this._verifyWith((v) => v.verifyAndDecodeTransaction(item.signedTransactionInfo!));
            const renewal = item.signedRenewalInfo
              ? await this._verifyWith((v) => v.verifyAndDecodeRenewalInfo(item.signedRenewalInfo!))
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
