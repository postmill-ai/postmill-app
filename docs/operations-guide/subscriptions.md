# Subscriptions & payment providers

Postmill's billing layer runs on pluggable **payment providers**. Organizations subscribe to one
of four plans, each with hard limits on channels, posts, team seats, video exports, and storage.
The backend enforces these limits at the API level; when a limit is hit the caller receives a
`402 Payment Required` response with an upsell link to `/billing`.

A provider is enabled by setting its keys in the environment — there is nothing to configure in
the UI. Billing is **on** as soon as at least one provider is enabled. For self-hosted instances
that set **no** provider keys, billing is bypassed and every organization is treated as the
**Agency** plan.

Want to plug in a provider that isn't shipped (a regional PSP, say)? See the developer guide:
[Writing a payment provider](../developer-docs/payment-providers.md).

## Choosing the default provider

`PAYMENTS_PROVIDER=<id>` names the provider that serves checkout on the web app. You only need
it when more than one web provider is enabled:

- unset + exactly one web provider enabled → that provider;
- unset + several enabled → the backend logs an error at boot and defaults to Stripe (if
  enabled) or the first enabled provider;
- an id whose keys are not set, or an app-store provider, is rejected (logged) and the rules
  above apply.

An organization stays with the provider it subscribed through until it cancels; changing
providers is cancel + resubscribe.

## Stripe

Set these in your `.env` file or container environment:

| Variable | Purpose |
|----------|---------|
| `STRIPE_PUBLISHABLE_KEY` | Stripe publishable key (enables the provider; used by the frontend billing page). |
| `STRIPE_SECRET_KEY` | Stripe secret key (used server-side for charges, subscriptions, and the customer portal). |
| `STRIPE_SIGNING_KEY` | Stripe webhook signing secret (see [Webhook setup](#webhook-setup)). |

If `STRIPE_PUBLISHABLE_KEY` is absent (and no other provider is enabled), the entire billing gate
is disabled and every org gets the [Agency defaults](#self-hosted-default).

Stripe supports everything the billing UI offers: embedded checkout, the customer portal,
proration previews, coupons, add-on packs, invoices and refunds, period-end cancellation with
resume, and the 30-day trial with a card check.

## PayPal

Hosted checkout through the PayPal Subscriptions API: the buyer is redirected to PayPal to
approve the subscription and returned to Postmill. Plans and products are created in your PayPal
catalog on first use (`Postmill PRO MONTHLY`, `… TRIAL`, …), so nothing needs pre-creating.

| Variable | Purpose |
|----------|---------|
| `PAYPAL_CLIENT_ID` | REST app client id (enables the provider; also exposed to the browser). |
| `PAYPAL_CLIENT_SECRET` | REST app secret. |
| `PAYPAL_WEBHOOK_ID` | The id of the webhook you register below — PayPal verifies deliveries against it. |
| `PAYPAL_ENV` | `live` (default) or `sandbox`. |
| `PAYPAL_BRAND_NAME` | Name shown on the PayPal approval page (default `Postmill`). |

Setup: [developer.paypal.com](https://developer.paypal.com) → **Apps & Credentials** → create a
REST app (a sandbox app for testing, a live app for production) → copy the client id and secret →
**Webhooks** → add `https://<your-domain>/payments/webhooks/paypal` subscribed to
`BILLING.SUBSCRIPTION.*` and `PAYMENT.SALE.COMPLETED` → copy the **Webhook ID**. For sandbox
testing create a business and a personal sandbox account under **Sandbox → Accounts** and set
`PAYPAL_ENV=sandbox`.

What differs from Stripe: PayPal has no customer portal (the buyer manages the agreement at
paypal.com), no proration preview (PayPal prorates plan revisions itself), no coupons, and no
add-on packs. Cancelling is immediate at PayPal, so Postmill keeps the subscription active until
the paid-through date and a daily job (`payments-expire-canceled`) downgrades it after that; a
cancelled PayPal subscription cannot be resumed — the customer subscribes again. PayPal webhooks
can lag the approval redirect by a minute or two; the post-checkout page reconciles from the
`subscription_id` PayPal appends to the return URL, so the wait is short.

## Apple App Store (mobile app)

For the Postmill mobile app. Purchases happen in the app through StoreKit; the server verifies
the signed transaction the app hands over (`POST /billing/native/verify`) and consumes App Store
Server Notifications. Nothing is sold through the web UI for this provider.

| Variable | Purpose |
|----------|---------|
| `APPLE_IAP_BUNDLE_ID` | The app's bundle id (enables the provider). |
| `APPLE_IAP_ISSUER_ID`, `APPLE_IAP_KEY_ID`, `APPLE_IAP_PRIVATE_KEY` | An **In-App Purchase** key from App Store Connect → Users and Access → Integrations → In-App Purchase (base64 of the `.p8`). This is a different key from Sign in with Apple's. |
| `APPLE_IAP_APP_APPLE_ID` | The numeric Apple ID of the app (App Store Connect → App Information). Required — Apple's verifier refuses production payloads without it. |
| `APPLE_IAP_ENV` | `Production` (default) or `Sandbox`. |
| `APPLE_IAP_ALLOW_SANDBOX` | `true` to also accept sandbox/TestFlight purchases on a production backend. |
| `PAYMENTS_APPLE_PRODUCT_PREFIX` | Product-id prefix (default `postmill`). |
| `APPLE_IAP_ROOT_CA_BASE64` | Override for Apple's root certificates (comma-separated base64 DER); normally unset. |

Products: create auto-renewable subscriptions in one subscription group with ids
`<prefix>.<tier>.monthly` / `<prefix>.<tier>.yearly` (e.g. `postmill.pro.monthly`); the free
trial is the group's introductory offer. Notifications: App Store Connect → your app → **App
Information → App Store Server Notifications** → version 2 → URL
`https://<your-domain>/payments/webhooks/apple` for Production and Sandbox. The app must set the
purchase's `appAccountToken` to the Postmill organization id so the server can bind it.

## Google Play (mobile app)

Same shape as Apple: the app buys through Play Billing and hands `{ purchaseToken, productId }`
to `POST /billing/native/verify`; Real-time Developer Notifications arrive through Pub/Sub.

| Variable | Purpose |
|----------|---------|
| `GOOGLE_PLAY_PACKAGE_NAME` | The app's package name (enables the provider). |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | Base64 of a service-account key JSON with access to the Play Developer API. |
| `GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL` | The service account Pub/Sub uses to sign push requests; the webhook refuses requests when unset. |
| `GOOGLE_PLAY_RTDN_AUDIENCE` | Audience of the push OIDC token (default: the webhook URL). |
| `PAYMENTS_GOOGLE_PRODUCT_PREFIX` | Product-id prefix (default `postmill`). |

Setup: Google Cloud → **Pub/Sub** → create a topic → grant
`google-play-developer-notifications@system.gserviceaccount.com` the *Pub/Sub Publisher* role →
add a **push** subscription to `https://<your-domain>/payments/webhooks/google` with
*Enable authentication* on (choose a service account; its email goes into
`GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL`, the audience into `GOOGLE_PLAY_RTDN_AUDIENCE`). Play
Console → **Monetize → Monetization setup** → paste the topic name and send a test notification.
Invite the API service account under **Users and permissions** with *View financial data* and
*Manage orders and subscriptions*. Products: subscription ids `<prefix>.<tier>.monthly` / `.yearly`,
or one product per tier with `monthly`/`yearly` base plans. The app must set
`obfuscatedExternalAccountId` to the Postmill organization id at purchase time. Postmill
acknowledges every verified purchase (Play refunds unacknowledged ones after three days).

## Plans

Plans are defined in `pricing.ts` and created dynamically in Stripe as products/prices on first
use. You do **not** need to pre-create Stripe price IDs.

| Plan | Monthly | Yearly | Channels | Posts / month | Team seats | Brand kits | Campaigns | API | MCP | Webhooks | Competitors | Analytics retention | Video exports | Storage |
|------|---------|--------|----------|---------------|------------|------------|-----------|-----|-----|----------|-------------|---------------------|---------------|---------|
| **Starter** | $9 | $90 | 3 | 100 | 1 | 0 | No | No | No | 1 | 1 | 180 days | 15 | 1 GB |
| **Pro** | $29 | $290 | 10 | 1,000,000 | 3 | 2 | Yes | Yes | Yes | 5 | 5 | 548 days | 60 | 5 GB |
| **Team** | $99 | $990 | 30 | 1,000,000 | 10 | 10 | Yes | Yes | Yes | 20 | 20 | 548 days | 200 | 20 GB |
| **Agency** | $249 | $2,490 | 100 | 1,000,000 | 25 | 1,000,000 | Yes | Yes | Yes | 1,000,000 | 50 | 548 days | 600 | 100 GB |

All prices are in USD. Yearly billing is roughly two months free compared to monthly.

## Trials

New organizations start with `allowTrial: true`. When a user subscribes to any plan, the checkout
session is created with `trial_period_days: 30`. The trial flag is cleared once the subscription is
persisted, so each org can trial only once. Operators can force a trial to end immediately via
`POST /billing/finish-trial`.

## Metered limits and enforcement

The `PermissionsService` evaluates every billed action against the org's effective limits: the
base plan limits plus purchased add-ons (the `extra*` columns on `Subscription`) plus any manual
[limit overrides](#manual-overrides). The same merged value feeds the storage upload quota, the
channel-enable gate, and the dashboard usage read.

| Dimension | Counted as | Reset behavior |
|-----------|-----------|----------------|
| Channels | Enabled integrations (not refresh-needed) | Hard cap; excess channels are disabled on downgrade. |
| Posts / month | Posts created since the subscription's monthly anniversary | Billing-month window based on `subscription.createdAt`. |
| Team seats | Enabled org members | Disabled members do not count. |
| Brand kits | Rows in the `AIBrandProfile` table | — |
| Webhooks | Rows in the `Webhooks` table | — |
| Competitors | Rows in `WatchedAccount` | — |
| Video exports | Rows in `Credits` with `type = 'video_export'` | Resets at the start of each billing month. |
| Storage | Bytes used in the `File` table | Hard cap (over-cap writes throw 402); [BYO storage](./storage.md) bypasses it entirely. |

A `POST` or `PATCH` that would exceed a limit throws `SubscriptionException` → HTTP 402 with a
message naming the specific limit and a `url` field pointing to `/billing`.

## Add-ons

Every capped plan dimension can be expanded without changing plans. Eight add-on types exist; each
pack adds a fixed amount and bills monthly alongside the base subscription. Pack sizes and prices
are env-overridable per type:

| Add-on | Default pack | Default price | Pack-size env | Price env |
|--------|--------------|---------------|---------------|-----------|
| Extra storage | 25 GB | $19 / pack / month | `ADDON_STORAGE_GB_PER_PACK` | `ADDON_STORAGE_PRICE_CENTS` |
| Extra video exports | 50 exports | $19 / pack / month | `ADDON_VIDEO_EXPORTS_PER_PACK` | `ADDON_VIDEO_EXPORTS_PRICE_CENTS` |
| Extra channels | 5 channels | $19 / pack / month | `ADDON_CHANNELS_PER_PACK` | `ADDON_CHANNELS_PRICE_CENTS` |
| Extra team seats | 5 seats | $15 / pack / month | `ADDON_TEAM_SEATS_PER_PACK` | `ADDON_TEAM_SEATS_PRICE_CENTS` |
| Extra posts | 500 posts / month | $9 / pack / month | `ADDON_POSTS_PER_PACK` | `ADDON_POSTS_PRICE_CENTS` |
| Extra brand kits | 5 kits | $9 / pack / month | `ADDON_BRAND_KITS_PER_PACK` | `ADDON_BRAND_KITS_PRICE_CENTS` |
| Extra webhooks | 10 webhooks | $9 / pack / month | `ADDON_WEBHOOKS_PER_PACK` | `ADDON_WEBHOOKS_PRICE_CENTS` |
| Extra competitors | 10 competitors | $9 / pack / month | `ADDON_COMPETITORS_PER_PACK` | `ADDON_COMPETITORS_PRICE_CENTS` |

Add-ons are Stripe subscriptions marked with `metadata.addon`. Their quantities are synced back to
the `Subscription` table (the matching `extra*` column) on every relevant Stripe webhook so
effective limits update immediately.

Operational notes:

- **Frontend mirrors:** the frontend reads pack sizes and prices from `NEXT_PUBLIC_ADDON_*`
  variables baked in at build time. If you change a backend `ADDON_*` value, rebuild the frontend
  with matching `NEXT_PUBLIC_ADDON_*` values or the UI shows stale pack sizes/prices. See
  [Configuration](./configuration.md).
- **Price grandfathering:** changing an `ADDON_*_PRICE_CENTS` variable creates a **new** Stripe
  Price used for new purchases only. Existing add-on subscriptions keep billing the old price;
  migrating them to the new price is a manual Stripe operation.
- **Downgrades:** when a plan downgrade prunes excess channels/team seats, it prunes to the
  org's **effective** limits (new plan + surviving add-on packs + overrides) — add-ons survive a
  downgrade.
- **Lifetime orgs:** organizations on a lifetime code cannot purchase add-ons (the UI hides the
  section and the backend rejects the purchase) — they have no base Stripe subscription for
  add-on items to ride on.

### Manual overrides

Super-admins can override any numeric limit for a specific org, replacing base + add-ons for that
dimension entirely. This is a **backend-only** surface — there is no UI for it in this repo; it
exists for the separate administration app.

```
PATCH /admin/orgs/:orgId/limit-overrides
```

Body: `{ "overrides": { "<key>": <number|null> } }` where key is one of `channel`,
`team_members`, `posts_per_month`, `brand_kits`, `webhooks`, `competitors`, `storage_gb`,
`video_exports`. A number sets the override, `null` clears it, and an absent key is left
untouched. `analytics_retention_days` is deliberately **not** overridable (a data-lifecycle
decision, not a purchasable quota) and is rejected like any unknown key.

Overrides are stored on `Subscription.limitOverrides` (JSON) and win last in the effective-limits
merge. The endpoint requires super-admin authentication: the admin app sends the super-admin
user's JWT in the custom `auth` header (`auth: <jwt>`) — CSRF is skipped for header auth, and
there is no API-key path.

## Self-hosted default

If `STRIPE_PUBLISHABLE_KEY` is not set:

- All billing checks short-circuit to "allowed."
- Every organization is treated as `AGENCY`.
- The `/billing` page shows empty packages and does not offer checkout.

This is controlled by `SELF_HOST_PLAN = 'AGENCY'` in the pricing module.

## Webhook setup

Create a Stripe webhook endpoint that points to:

```
POST https://<your-domain>/payments/webhooks/stripe
```

::: tip Upgrading from a release before the payments domain
`POST https://<your-domain>/stripe` still works as a deprecated alias, so an existing dashboard
webhook keeps delivering. Re-point it to `/payments/webhooks/stripe` at your convenience — the
alias will be removed in a later release.
:::

Subscribe to these events:

- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_succeeded`
- `invoice.payment_failed`

Copy the webhook signing secret into `STRIPE_SIGNING_KEY`. The controller rejects events whose
`metadata.service !== 'postmill'` (except for the two invoice events, which are inspected per
subscription). Events are recorded in the payment-event ledger (the `StripeEvent` table, shared by
every provider) for idempotency; redeliveries of the same `event.id` are ignored.

## Subscription lifecycle

### Creation and updates

`customer.subscription.created` / `.updated` read `metadata.billing`, `metadata.period`, and
`metadata.uniqueId`, validate the card with a $1 manual-capture authorization (during a trial), and
upsert the org's `Subscription` row. The `totalChannels` column is set to the plan's channel limit.

### Payment failure and dunning

`invoice.payment_failed` does **not** immediately downgrade the org. Instead it enters a 7-day grace
period (`GRACE_PERIOD_DAYS = 7`), records `gracePeriodEnd`, and sends a `budget` notification to the
org with a link to `/billing`. Channels and features remain usable during the grace window.

### Terminal cancellation

`customer.subscription.deleted` downgrades the org to `STARTER` and prunes excess channels/team
members. The `Subscription` row is **hard-deleted** (`subscription.repository.ts:59-67`, via
`deleteMany`); the `deletedAt` column exists but is not used for cancellation.

### Plan changes

- **Upgrades** apply immediately via a new checkout session or a Stripe subscription update with
  `proration_behavior: 'always_invoice'`.
- **Downgrades** set `pendingTier` on the subscription, update the Stripe price so the next invoice
  uses the lower amount, and apply the new limits at the next billing period (triggered by
  `invoice.payment_succeeded`).

## Lifetime codes

Operators can mint signed lifetime codes. `POST /billing/lifetime` accepts a JWT-signed code
(produced out-of-band), decrypts it with `AuthService.fixedDecryption`, and applies the `AGENCY`
plan permanently (`isLifetime: true`). A code can only be used once; the plaintext is recorded in
`UsedCodes` to prevent reuse.

This path is intended for special deals, migration credits, or operator-granted exceptions.

## Charges, refunds, and cancellation

- `GET /billing/charges` lists succeeded charges and links to Stripe receipts/PDFs.
- `POST /billing/refund-charges` refunds specific charge IDs.
- `POST /billing/cancel` schedules cancellation at period end and emails the operator-defined
  billing address with the user's feedback.
- `POST /billing/cancel-subscription` cancels immediately.
- `GET /billing/portal` returns the provider's management link (Stripe Customer Portal; the store's
  subscription page for app-store providers). Providers without one answer 400
  `PAYMENTS_UNSUPPORTED` and the button is hidden.

Most billing-management routes require the `billing:manage` RBAC permission, but not all — `GET /billing/portal` and `POST /billing/finish-trial` are org-scoped without the `billing:manage` decorator (`billing.controller.ts:55,106`; the `@RequirePermission('billing','manage')` gate begins at line 123).

## Related

- [Configuration](./configuration.md) — full env var reference including every payment provider and add-on pack sizes
- [Writing a payment provider](../developer-docs/payment-providers.md) — add a provider that isn't shipped
- [Security](./security.md) — webhook signature verification and audit logging
- [Settings](../user-guide/settings.md) — the Team & Roles tab where the `billing:manage` permission is granted
- [Subscription & Billing](../user-guide/subscription-and-billing.md) — end-user guide to plans, add-ons, and the `/billing` UI

> Verified against v1.0.0 (2026-07-25)
