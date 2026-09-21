import { createHash } from 'node:crypto';
import { google, androidpublisher_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { metadata as providerMetadata } from './payments.metadata';
import {
  NormalizedPaymentEvent,
  NormalizedSubscriptionState,
  PaymentsCapability,
  PaymentsCapabilityFlags,
  PaymentsPublicConfig,
  PaymentsSubscriptionStatus,
  PaymentsWebhookInput,
  PaymentsWebhookVerificationError,
  ProviderModule,
  WebhookReceipt,
  parseStoreProductId,
} from '@postmill-ai/provider-kernel';

type SubscriptionPurchase = androidpublisher_v3.Schema$SubscriptionPurchaseV2;

/** Real-time developer notification types (subscriptionNotification.notificationType). */
const RTDN = {
  RECOVERED: 1,
  RENEWED: 2,
  CANCELED: 3,
  PURCHASED: 4,
  ON_HOLD: 5,
  IN_GRACE_PERIOD: 6,
  RESTARTED: 7,
  PRICE_CHANGE_CONFIRMED: 8,
  DEFERRED: 9,
  PAUSED: 10,
  PAUSE_SCHEDULE_CHANGED: 11,
  REVOKED: 12,
  EXPIRED: 13,
  PENDING_PURCHASE_CANCELED: 20,
} as const;

/**
 * Google Play payments adapter (`checkoutMode: 'native'`). The mobile app
 * buys through Play Billing and hands `{ purchaseToken, productId }` to
 * `POST /billing/native/verify`; Play's Real-time Developer Notifications
 * arrive as Pub/Sub push messages on `POST /payments/webhooks/google`.
 *
 * - Verification: the purchase state is always read back from the Play
 *   Developer API (`purchases.subscriptionsv2.get`) — RTDN payloads carry no
 *   state, only the token. Push requests are authenticated by the OIDC token
 *   Pub/Sub attaches (audience = this endpoint, issuer = the configured push
 *   service account).
 * - Binding: the app sets `obfuscatedExternalAccountId` to the Postmill org id
 *   at purchase time; `customerRef` is the purchase token. Play rotates the
 *   token on plan changes (`linkedPurchaseToken`) — the event carries the NEW
 *   token and the org id hint so the orchestrator re-points the org.
 * - Acknowledgement: an unacknowledged subscription purchase is refunded by
 *   Play after three days, so every verified purchase is acknowledged here.
 * - Products: `<PAYMENTS_GOOGLE_PRODUCT_PREFIX>.<tier>.<monthly|yearly>`, or
 *   one product per tier with `monthly`/`yearly` base plans (`productId.basePlanId`).
 */
export class GooglePaymentsAdapter implements PaymentsCapability {
  readonly name = 'google';
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
    // The store owns cancellation; the web app only links to the Play subscriptions page.
    periodEndCancel: false,
    planChange: false,
  };
  readonly requiredEnvKeys = ['GOOGLE_PLAY_PACKAGE_NAME', 'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON'];

  private _publisher: androidpublisher_v3.Androidpublisher | null = null;
  /** Wait before re-reading a token Play rejected on an activation push (propagation lag). Specs set 0. */
  _activationRetryDelayMs = 2000;
  private _oidc: OAuth2Client | null = null;

  isConfigured(): boolean {
    return !!process.env.GOOGLE_PLAY_PACKAGE_NAME;
  }

  publicConfig(): PaymentsPublicConfig {
    return {
      providerId: this.name,
      checkoutMode: this.capabilities.checkoutMode,
      capabilities: this.capabilities,
    };
  }

  private get _packageName(): string {
    return process.env.GOOGLE_PLAY_PACKAGE_NAME || '';
  }

  private get _prefix(): string {
    return process.env.PAYMENTS_GOOGLE_PRODUCT_PREFIX || 'postmill';
  }

  // S-17 / known proxy gap (same as the google auth adapter): googleapis builds
  // its own Gaxios clients and does not accept an undici Dispatcher, so these
  // calls bypass the VPN egress. Acceptable — Google is never a channel.
  private _client(): androidpublisher_v3.Androidpublisher {
    if (!this._publisher) {
      const credentials = JSON.parse(
        Buffer.from(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON || '', 'base64').toString('utf8') || '{}',
      );
      const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/androidpublisher'],
      });
      this._publisher = google.androidpublisher({ version: 'v3', auth });
    }
    return this._publisher;
  }

  private _oidcClient(): OAuth2Client {
    if (!this._oidc) {
      this._oidc = new OAuth2Client();
    }
    return this._oidc;
  }

  // ---------------------------------------------------------------- purchase state

  /**
   * Read a purchase from Play. Only Play's own verdict on the token (400/404/410)
   * is a verification failure; a 5xx, quota or network error is rethrown so it
   * surfaces as retryable rather than "rejected".
   */
  private async _readPurchase(token: string): Promise<SubscriptionPurchase> {
    try {
      const res = await this._client().purchases.subscriptionsv2.get({
        packageName: this._packageName,
        token,
      });
      return res.data;
    } catch (err) {
      const status = Number((err as { code?: number; status?: number })?.code ?? (err as { status?: number })?.status);
      if (status === 400 || status === 404 || status === 410) {
        throw new PaymentsWebhookVerificationError(
          `Google Play rejected the purchase token: ${(err as Error)?.message ?? err}`,
        );
      }
      throw err;
    }
  }

  private async _acknowledge(token: string, productId: string, purchase: SubscriptionPurchase): Promise<void> {
    if (purchase.acknowledgementState !== 'ACKNOWLEDGEMENT_STATE_PENDING') {
      return;
    }
    await this._client().purchases.subscriptions.acknowledge({
      packageName: this._packageName,
      subscriptionId: productId,
      token,
    });
  }

  private _plan(item: androidpublisher_v3.Schema$SubscriptionPurchaseLineItem) {
    const productId = item.productId || '';
    return (
      parseStoreProductId(this._prefix, productId) ||
      (item.offerDetails?.basePlanId
        ? parseStoreProductId(this._prefix, `${productId}.${item.offerDetails.basePlanId}`)
        : null)
    );
  }

  private _toStatus(state?: string | null): PaymentsSubscriptionStatus {
    switch (state) {
      case 'SUBSCRIPTION_STATE_ACTIVE':
      case 'SUBSCRIPTION_STATE_CANCELED': // still entitled until expiryTime
        return 'active';
      case 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD':
      case 'SUBSCRIPTION_STATE_ON_HOLD':
      case 'SUBSCRIPTION_STATE_PAUSED':
        return 'past_due';
      case 'SUBSCRIPTION_STATE_PENDING':
        return 'incomplete';
      default:
        return 'canceled';
    }
  }

  private _toState(token: string, purchase: SubscriptionPurchase): NormalizedSubscriptionState | null {
    const item = purchase.lineItems?.[0];
    if (!item) {
      return null;
    }
    const plan = this._plan(item);
    if (!plan) {
      return null;
    }
    const expiresAt = item.expiryTime ? new Date(item.expiryTime) : null;
    const autoRenew = item.autoRenewingPlan?.autoRenewEnabled !== false;
    const status = this._toStatus(purchase.subscriptionState);
    return {
      tier: plan.tier,
      period: plan.period,
      status,
      identifier: purchase.latestOrderId || token,
      providerSubscriptionRef: token,
      isTrialing: false,
      cancelAt: !autoRenew || purchase.subscriptionState === 'SUBSCRIPTION_STATE_CANCELED' ? expiresAt : null,
      pendingTier: null,
      expiresAt,
    };
  }

  /**
   * Activation refs carry the org hint (binds the org on first purchase) and
   * the token this purchase supersedes (`linkedPurchaseToken`, set on plan
   * changes) so the orchestrator can move the binding. Every other event
   * resolves by ref alone — a hint on EXPIRED for a rotated-out token would
   * otherwise re-bind the org to the dead token and tear it down.
   */
  private _activationRefs(token: string, purchase: SubscriptionPurchase) {
    const hint = purchase.externalAccountIdentifiers?.obfuscatedExternalAccountId || undefined;
    return {
      customerRef: token,
      ...(hint ? { orgIdHint: hint } : {}),
      ...(purchase.linkedPurchaseToken ? { previousCustomerRef: purchase.linkedPurchaseToken } : {}),
    };
  }

  /** Read + acknowledge + translate a purchase token into events. */
  private async _eventsFor(
    token: string,
    kind: 'activated' | 'updated' | 'renewed',
    alreadyRead?: SubscriptionPurchase,
  ): Promise<NormalizedPaymentEvent[]> {
    const purchase = alreadyRead ?? (await this._readPurchase(token));
    if (!purchase.lineItems?.length) {
      return [];
    }
    if (purchase.lineItems[0].productId) {
      await this._acknowledge(token, purchase.lineItems[0].productId, purchase);
    }
    const state = this._toState(token, purchase);
    if (!state) {
      return [];
    }
    if (state.status === 'canceled') {
      return [{ type: 'subscription.canceled', customerRef: token }];
    }
    const events: NormalizedPaymentEvent[] = [];
    if (kind === 'renewed') {
      events.push({
        type: 'payment.succeeded',
        customerRef: token,
        // Play's v2 purchase resource carries no amount; the orchestrator prices it from the plan.
        currency: 'usd',
        isAddon: false,
        providerSubscriptionRef: token,
        subscriptionStatus: state.status,
      });
    }
    events.push(
      kind === 'activated'
        ? { type: 'subscription.activated', ...this._activationRefs(token, purchase), state }
        : { type: 'subscription.updated', customerRef: token, state },
    );
    return events;
  }

  // ---------------------------------------------------------------- native purchase

  async verifyPurchase(input: { orgId: string; payload: unknown }): Promise<NormalizedPaymentEvent[]> {
    const { purchaseToken } = (input.payload as { purchaseToken?: string; productId?: string }) || {};
    if (!purchaseToken || typeof purchaseToken !== 'string') {
      throw new PaymentsWebhookVerificationError('Google purchase payload must carry `purchaseToken`');
    }
    const purchase = await this._readPurchase(purchaseToken);
    // Same rule as Apple: the app must tag the purchase with the org id.
    const boundOrg = purchase.externalAccountIdentifiers?.obfuscatedExternalAccountId;
    if (boundOrg !== input.orgId) {
      throw new PaymentsWebhookVerificationError(
        'Google purchase obfuscatedExternalAccountId does not match the organization',
      );
    }
    // One Play round-trip: reuse the purchase we just read.
    return this._eventsFor(purchaseToken, 'activated', purchase);
  }

  // ---------------------------------------------------------------- Pub/Sub push

  async receiveWebhook(input: PaymentsWebhookInput): Promise<WebhookReceipt> {
    await this._verifyPush(input.headers.authorization || input.headers.Authorization);

    let envelope: { message?: { data?: string; messageId?: string; message_id?: string } };
    try {
      envelope = JSON.parse(input.rawBody.toString('utf8'));
    } catch {
      throw new PaymentsWebhookVerificationError('Malformed Pub/Sub push body');
    }
    const message = envelope.message;
    if (!message?.data) {
      throw new PaymentsWebhookVerificationError('Pub/Sub push body has no message.data');
    }
    // Deterministic fallback so a redelivery without an id stays idempotent.
    const eventId =
      message.messageId || message.message_id || `google:${createHash('sha256').update(message.data).digest('hex')}`;
    let notification: {
      packageName?: string;
      subscriptionNotification?: { notificationType?: number; purchaseToken?: string; subscriptionId?: string };
      voidedPurchaseNotification?: { purchaseToken?: string };
      testNotification?: unknown;
    };
    try {
      notification = JSON.parse(Buffer.from(message.data, 'base64').toString('utf8'));
    } catch {
      throw new PaymentsWebhookVerificationError('Pub/Sub message.data is not a JSON RTDN payload');
    }

    if (notification.packageName && notification.packageName !== this._packageName) {
      return { eventId, eventType: 'rtdn.foreign-package', events: [], skipRecord: true };
    }
    if (notification.testNotification) {
      return { eventId, eventType: 'rtdn.test', events: [] };
    }
    if (notification.voidedPurchaseNotification?.purchaseToken) {
      return {
        eventId,
        eventType: 'rtdn.voided',
        events: [{ type: 'subscription.canceled', customerRef: notification.voidedPurchaseNotification.purchaseToken }],
      };
    }
    const sub = notification.subscriptionNotification;
    if (!sub?.purchaseToken || typeof sub.notificationType !== 'number') {
      return { eventId, eventType: 'rtdn.other', events: [] };
    }
    const eventType = `rtdn.subscription.${sub.notificationType}`;
    const token = sub.purchaseToken;

    const isActivation =
      sub.notificationType === RTDN.PURCHASED ||
      sub.notificationType === RTDN.RESTARTED ||
      sub.notificationType === RTDN.RECOVERED;
    const rejected = (err: unknown) => (err as Error)?.name === 'PaymentsWebhookVerificationError';
    try {
      return await this._translateSubscription(eventId, eventType, sub.notificationType, token);
    } catch (err) {
      if (!rejected(err)) {
        throw err;
      }
      // The push itself was authenticated; Play says the token is invalid/gone.
      // For an activation the RTDN can outrun Play's own API propagation on a
      // FRESH token: retry once after a short wait, and if still rejected
      // acknowledge WITHOUT a ledger row so Pub/Sub's redelivery gets another
      // look (the app's /billing/native/verify is the other backstop).
      if (isActivation) {
        await new Promise((r) => setTimeout(r, this._activationRetryDelayMs));
        try {
          return await this._translateSubscription(eventId, eventType, sub.notificationType, token);
        } catch (again) {
          if (!rejected(again)) {
            throw again;
          }
          return { eventId, eventType: `${eventType}.token-rejected`, events: [], skipRecord: true };
        }
      }
      // A dead token on a non-activation push is a permanent verdict: ledger it
      // (a 401 would only make Pub/Sub redeliver it for up to seven days).
      return { eventId, eventType: `${eventType}.token-rejected`, events: [] };
    }
  }

  private async _translateSubscription(
    eventId: string,
    eventType: string,
    notificationType: number,
    token: string,
  ): Promise<WebhookReceipt> {
    switch (notificationType) {
      case RTDN.PURCHASED:
        return { eventId, eventType, events: await this._eventsFor(token, 'activated') };
      case RTDN.RESTARTED:
      case RTDN.RECOVERED:
        // Recovery from hold/grace carries no charge; `subscription.updated`
        // (active) is what clears the dunning grace marker.
        return { eventId, eventType, events: await this._eventsFor(token, 'updated') };
      case RTDN.RENEWED:
        return { eventId, eventType, events: await this._eventsFor(token, 'renewed') };
      case RTDN.CANCELED:
      case RTDN.PRICE_CHANGE_CONFIRMED:
      case RTDN.DEFERRED:
      case RTDN.PAUSE_SCHEDULE_CHANGED:
        return { eventId, eventType, events: await this._eventsFor(token, 'updated') };
      case RTDN.ON_HOLD:
      case RTDN.IN_GRACE_PERIOD:
      case RTDN.PAUSED:
        return {
          eventId,
          eventType,
          events: [{ type: 'subscription.past_due', customerRef: token, providerSubscriptionRef: token }],
        };
      case RTDN.REVOKED:
      case RTDN.EXPIRED:
        // By ref only: for a rotated-out token this finds nothing and no-ops.
        return { eventId, eventType, events: [{ type: 'subscription.canceled', customerRef: token }] };
      default:
        return { eventId, eventType, events: [] };
    }
  }

  /**
   * Pub/Sub push authentication: the subscription is created with "enable
   * authentication" + a service account; Pub/Sub then sends an OIDC token
   * whose audience is this endpoint. Fail closed when no account is configured.
   */
  private async _verifyPush(authorization?: string): Promise<void> {
    const expectedEmail = process.env.GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL;
    if (!expectedEmail) {
      throw new PaymentsWebhookVerificationError(
        'GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL is not set — refusing unauthenticated Pub/Sub push',
      );
    }
    const token = (authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) {
      throw new PaymentsWebhookVerificationError('Pub/Sub push is missing its bearer token');
    }
    const audience =
      process.env.GOOGLE_PLAY_RTDN_AUDIENCE ||
      `${(process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || '').replace(/\/+$/, '')}/payments/webhooks/google`;
    let payload: { email?: string; email_verified?: boolean } | undefined;
    try {
      const ticket = await this._oidcClient().verifyIdToken({ idToken: token, audience });
      payload = ticket.getPayload() ?? undefined;
    } catch (err) {
      throw new PaymentsWebhookVerificationError(
        `Pub/Sub OIDC token rejected: ${(err as Error)?.message ?? err}`,
      );
    }
    if (!payload?.email_verified || payload.email !== expectedEmail) {
      throw new PaymentsWebhookVerificationError('Pub/Sub OIDC token is not from the configured push service account');
    }
  }

  // ---------------------------------------------------------------- hooks

  async fetchSubscriptionState(input: { customerRef: string }): Promise<NormalizedSubscriptionState | null> {
    try {
      return this._toState(input.customerRef, await this._readPurchase(input.customerRef));
    } catch {
      return null;
    }
  }

  async manageUrl(): Promise<string> {
    return `https://play.google.com/store/account/subscriptions?package=${encodeURIComponent(this._packageName)}`;
  }
}

const _meta = new GooglePaymentsAdapter();

export const googlePaymentsModule: ProviderModule<any, any> = {
  metadata: providerMetadata,
  manifest: {
    domain: 'payments',
    providerId: _meta.name,
    version: 'v1',
    displayName: 'Google Play',
    status: 'active',
    credentialFields: [],
    capabilities: _meta.capabilities,
    platformConnect: 'env',
    docsUrl: 'https://developer.android.com/google/play/billing/rtdn-reference',
    webhookInstructions:
      'Google Cloud → Pub/Sub → create a topic, grant google-play-developer-notifications@system.gserviceaccount.com the Publisher role, add a push subscription to `https://<backend>/payments/webhooks/google` with authentication enabled (service account = GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL, audience = that URL); Play Console → Monetize → Monetization setup → paste the topic name.',
  },
  create: () => new GooglePaymentsAdapter(),
};
