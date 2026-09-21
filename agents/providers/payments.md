# Payments providers (`payments` domain)

Subscription billing through the ProviderKernel: Stripe, PayPal, the Apple App Store, Google
Play, or a provider you add. Sibling docs: `agents/billing.md` (the 402 gate, plan table,
`PaymentsService` surface), `agents/providers/overview.md` (kernel essentials), `agents/jobs.md`
(the expiry cron). Human-facing setup per provider: `docs/operations-guide/subscriptions.md`.

## Shape of the domain

| Fact | Detail |
|---|---|
| Configuration | **Platform `.env` keys only** — never per-org BYOK, never a settings-kit surface. A provider is *enabled* when its `enabledBy` key is set; the rest of its keys are validated at boot with a warning. |
| Master switch | `billingEnabled()` in `libraries/helpers/src/billing/payments.env.ts` = "at least one provider enabled". This replaced `!!process.env.STRIPE_PUBLISHABLE_KEY` everywhere; a grep-guard spec (`apps/backend/src/__tests__/no-direct-stripe-env.spec.ts`) fails the build on a new raw `process.env.STRIPE_*` read outside the Stripe adapter. |
| Default web provider | `PAYMENTS_PROVIDER=<id>` (bare or `id@v1`). Unset + one web provider → it. Unset + several → `Logger.error` at boot + deterministic pick (table order, Stripe first). Native providers are rejected as a web default. Logic: `resolveDefaultWebPaymentProvider()`; boot log in `PaymentsConfigService.onModuleInit`. |
| Org binding | `Subscription.provider` (which provider bills the active row; `'manual'` for lifetime/admin grants) and `Organization.paymentProvider` + `paymentId` (the vendor customer/account ref: Stripe customer, PayPal subscription id, Apple originalTransactionId, Google purchaseToken). **An org is locked to the provider it first subscribed through, even after lapsing** (product decision 2026-09-21); an operator clears `paymentProvider`/`paymentId` (and any old subscription row) to let it switch. Resolution order in `PaymentsService.resolveOrgProvider`: subscription's provider → org's `paymentProvider` → default web provider → default native provider (so a never-subscribed org on a native-only deployment sees the store copy, never web purchase buttons). `GET /billing/config` exposes the lock as `org.lockedTo`. |
| Two families | `capabilities.checkoutMode`: `hosted`/`embedded` = the web app starts the purchase (`createCheckout`); `native` = a mobile app buys through the store and the server only verifies (`verifyPurchase`) + consumes store notifications. |
| Webhooks | `POST /payments/webhooks/:provider` (public; the vendor signature is the auth). `POST /stripe` is a deprecated alias. Unknown/unconfigured provider → 404, bad signature → 401, apply error → 500 **unrecorded** (the vendor retries). |
| Idempotency | `PaymentEvent` ledger (`@@map("StripeEvent")`, `id` = raw vendor event id + `provider`). Checked before applying, written only after success. `skipRecord` on a receipt acknowledges foreign traffic without a row (Stripe other-app events, Apple other-app/other-environment notifications, Google other-package pushes). `id` stays the sole PK: vendor id formats are disjoint by construction, so no `(id, provider)` key — and adapters derive fallback ids from the payload (sha256), never from the clock. |

## Division of labour — adapter vs orchestrator

The **adapter** (`libraries/providers/<id>/src/v1/payments.adapter.ts`, implements
`PaymentsCapability` from `kernel/src/domains/payments.ts`) talks to the vendor only: creates
checkouts, mutates vendor subscriptions, verifies webhooks/receipts and translates vendor payloads
into `NormalizedPaymentEvent`s. **It never sees the database.** Prices reach it through the
request (`PaymentsPlanPrice` / `PaymentsAddonSpec`) because provider packages depend on the
kernel only — they cannot import `pricing.ts`.

The **orchestrator** (`libraries/nestjs-libraries/src/payments/payments.service.ts`,
`PaymentsService`) owns every database transition: subscription rows, dunning grace
(`_enterGracePeriod`, 7 days, live-status guard via `fetchSubscriptionState`), audit
(`billing.subscription.changed`), purchase tracking, pending downgrades, add-on quantity sync,
webhook idempotency, the `$1` card check decision (`requiresCardCheck` × `org.allowTrial` ×
`capabilities.cardCheck`). **`applyEvent(providerId, event)` is the single sink** — webhooks,
native receipt verification (`POST /billing/native/verify`), post-checkout polling
(`pullSubscription`) and the expiry cron all end there.

Org resolution inside `applyEvent`: by `customerRef` scoped to the provider; else by `orgIdHint`
(Apple `appAccountToken`, Google `obfuscatedExternalAccountId`, PayPal `custom_id`) which binds the
org to that ref (`updateCustomerId`) — this is also how Google's rotated `linkedPurchaseToken` and
PayPal's first activation attach. A hint can never steal an org whose live subscription belongs to
a different provider; the adapter's signature verification is what makes a hint trustworthy.

## Capability flags → methods

Declared in `capabilities`; `runPaymentsConformance` (`kernel/src/testing/conformance.ts`)
fails the module when a flag is true and its method is missing, or a family is missing its base set.

| Flag / mode | Required methods | Orchestrator behaviour when `false` |
|---|---|---|
| `checkoutMode: hosted \| embedded` | `ensureCustomer`, `createCheckout`, `setCancelAtPeriodEnd`, `cancelNow`, `checkoutStatus` | — |
| `checkoutMode: native` | `verifyPurchase` | `/billing/embedded`, `/subscribe`, `/change-plan` etc. → 400 `PAYMENTS_UNSUPPORTED` |
| `portal` | `manageUrl(customerRef, returnUrl)` — vendor portal or the store's subscription page | `/billing/portal` → 400; `GET /billing/config` returns `manageUrl: null` |
| `proration` | `previewProration` | `/billing/prorate` → `{ price: 0 }` |
| `addons` | `upsertAddon`, `cancelAddon`, `listAddonQuantities` | `/billing/addons` → 400 |
| `refunds` | `refund` | `/billing/refund-charges` → 400 |
| `chargesHistory` | `listCharges` | `/billing/charges` → `[]` |
| `promoCodes` | `checkDiscount`, `applyDiscount` | `/billing/check-discount` → `offerCoupon: false` |
| `trials` | `finishTrial` (web providers) | `/billing/finish-trial` no-op |
| `cardCheck` | `verifyPaymentMethod` | no authorise-and-void on trial activation |
| `planChange` | `changePlan`, optionally `commitPendingTier` | `/billing/change-plan` → 400 |
| `periodEndCancel` | (semantics of `setCancelAtPeriodEnd`) | the adapter cancels at the vendor **now** and returns the period end as `cancelAt`; the orchestrator keeps the row and the `payments-expire-canceled` cron tears it down after `cancelAt` (+1 day slack) |

Optional hooks any provider may implement: `fetchSubscriptionState` (live-status guard before
entering grace — without it the vendor's word is final), `pullSubscription(providerRef)` (poll
fallback for vendors whose webhooks lag the checkout redirect), `commitPendingTier`.

## Normalized events

| Event | Carries | Orchestrator does |
|---|---|---|
| `subscription.activated` / `subscription.updated` | `state` (`tier`, `period`, `status`, `identifier` = app purchase id, `providerSubscriptionRef`, `isTrialing`, `cancelAt?`, `pendingTier?`), `requiresCardCheck?` | `incomplete` ⇒ `{ok:false}` (recorded, no row); card check for trial orgs; `updated` + `active\|trialing` clears grace; audit; `createOrUpdateSubscription(..., provider)`; `pendingTier` ≠ tier ⇒ `setPendingTier` |
| `subscription.past_due`, `payment.failed` | `providerSubscriptionRef?` | `_enterGracePeriod` (live check when `fetchSubscriptionState` exists) + `budget` notification linking `/billing` |
| `subscription.canceled` | — | `deleteSubscription` (prunes to STARTER limits) + audit `deleted` |
| `payment.succeeded` | `amountCents?` (falls back to the plan price), `currency`, `isAddon`, `subscriptionStatus?`, `userIdHint?`, `trackingRef?` | add-on ⇒ nothing; clear grace on `active\|trialing`; `TrackService` purchase; apply + clear `pendingTier`, then `commitPendingTier` |
| `addons.changed` | — | `listAddonQuantities` × `addonPackSize` → `updateAddonQuantities` |

`WebhookReceipt.events: []` means "nothing to apply" (still recorded); `ackBody` is returned
verbatim to the vendor (Pub/Sub, challenge handshakes).

## Env keys

Every provider's keys live in **two lockstep places**: the adapter's `requiredEnvKeys` (first =
the enabling key) and the row in `PAYMENT_PROVIDER_ENV` (`libraries/helpers/src/billing/payments.env.ts`).
`apps/backend/src/__tests__/payments-env-lockstep.spec.ts` fails when they drift or a row has no
module. The helpers table exists because the master switch is evaluated in leaf services, Inngest
activities, MCP tools and Next.js server layouts (`apps/frontend/src/app/payments.vars.ts`) that
have no kernel access. Never read a vendor key anywhere else.

| Provider | Enabling key | Other keys | Mode |
|---|---|---|---|
| `stripe` | `STRIPE_PUBLISHABLE_KEY` | `STRIPE_SECRET_KEY`, `STRIPE_SIGNING_KEY`, optional `STRIPE_DISCOUNT_ID` | embedded |
| `paypal` | `PAYPAL_CLIENT_ID` | `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, optional `PAYPAL_ENV`, `PAYPAL_BRAND_NAME` | hosted |
| `apple` | `APPLE_IAP_BUNDLE_ID` | `APPLE_IAP_ISSUER_ID`, `APPLE_IAP_KEY_ID`, `APPLE_IAP_PRIVATE_KEY`, `APPLE_IAP_APP_APPLE_ID`, optional `APPLE_IAP_SANDBOX_ORG_IDS`, `APPLE_IAP_ENV`, `APPLE_IAP_ALLOW_SANDBOX`, `PAYMENTS_APPLE_PRODUCT_PREFIX`, `APPLE_IAP_ROOT_CA_BASE64` | native |
| `google` | `GOOGLE_PLAY_PACKAGE_NAME` | `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`, optional `GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL` (webhook fails closed without it), `GOOGLE_PLAY_RTDN_AUDIENCE`, `PAYMENTS_GOOGLE_PRODUCT_PREFIX` | native |

Org binding rules (`PaymentsService._resolveEventOrg`): by `(customerRef, provider)` first. A vendor `orgIdHint` binds an org **only on `subscription.activated`** and never re-points an org bound to a *different* provider (the locked rule — logged at `warn` with the operator escape hatch). A same-provider re-bind is refused only while the org has a **live** row on that provider — `isSubscriptionLive` in `database/prisma/subscriptions/subscription.liveness.ts`: exists, not deleted, dunning grace not lapsed, `cancelAt` not more than a day in the past — unless the event carries `previousCustomerRef` equal to the org's current ref (Google `linkedPurchaseToken`). A lapsed org (torn down, lapsed grace, or a missed teardown webhook past `cancelAt`) re-binds freely, and the re-bind clears the row's stale `gracePeriodEnd`/`pendingTier` (the upsert never touches them). Cancel/past-due/payment events must be emitted by ref alone.

Flag matrix as shipped:

| Provider | portal | proration | addons | refunds | promoCodes | trials | cardCheck | chargesHistory | periodEndCancel | planChange |
|---|---|---|---|---|---|---|---|---|---|---|
| stripe | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| paypal | – | – | – | ✓ | – | ✓ (trial cycle; `finishTrial` unsupported) | – | ✓ | – (immediate cancel + `cancelAt`) | ✓ (revise) |
| apple | ✓ (store page) | – | – | – | – | ✓ (intro offer) | – | – | – (store cancels) | – |
| google | ✓ (store page) | – | – | – | – | ✓ | – | – | – (store cancels) | – |

Frontend branches: `apps/frontend/src/components/billing/first.billing.component.tsx` on
`useVariables().payments.checkoutMode` (embedded → Stripe.js form, hosted → "Continue with
<Provider>" redirect, native → store copy); `main.billing.component.tsx` and
`settings/subscription/subscription.panel.tsx` hide portal/proration/coupon/add-on/resume/plan-change
affordances from `GET /billing/config` (`useBillingConfig`), and render "managed through the app
store" + `manageUrl` for native orgs. `CheckPayment` forwards `?subscription_id=`/`?ref=` from the
return URL to `/billing/check/:id?ref=`.

## HTTP surface

- `GET /billing/config` — `{ enabled, defaultProvider, providers[{providerId, displayName, checkoutMode, publicKey?}], org: { provider, checkoutMode, capabilities, manageUrl } | null }`. The billing UI branches on this; no secret ever appears.
- `POST /billing/embedded` / `POST /billing/subscribe` — first purchase → vendor checkout (`{client_secret, auto_apply_coupon?}` for embedded, `{url}` for hosted); an org that already has a row → in-place upgrade (`{id}` / `{portal}` / `{url}`).
- `GET /billing/check/:id?ref=` — 2 = landed, 1 = abandoned, 0 = keep polling; `ref` lets `pullSubscription` reconcile before the webhook.
- `POST /billing/native/verify { provider, payload }` (`billing:manage`) — store purchase handover.
- `POST /payments/webhooks/:provider`; `POST /stripe` (deprecated alias).
- Everything else on `/billing/*` is unchanged (see `agents/billing.md`).

## Adding a provider

Follow the skill `agents/skills/add-payments-provider/SKILL.md`. In short: scaffold
`libraries/providers/<id>` (or add a `payments.adapter.ts` to an existing package — `apple` and
`google` already host auth/ai modules), implement `PaymentsCapability` with honest flags, lazy
SDK client (`create()` must be pure), `receiveWebhook` that **verifies before parsing**, add the
`PAYMENT_PROVIDER_ENV` row, register (`providers.generated.ts`, `tsconfig.base.json`,
`apps/backend/package.json`), write the adapter spec with the vendor SDK mocked plus a
`runPaymentsConformance` spec, then update `PROVIDERS_INVENTORY.md`, `.env.example`, this doc's
env table and `docs/operations-guide/subscriptions.md`.

## Invariants

- Adapters never touch Prisma or `pricing.ts`; the orchestrator never calls a vendor SDK.
- Webhook handlers verify the signature first, and `receiveWebhook` must throw
  `PaymentsWebhookVerificationError` (→ 401) on failure — never return `events: []`.
- Record the ledger row **after** a successful apply; a thrown error must stay retryable.
- Stripe metadata keys (`service`, `billing`, `period`, `uniqueId`, `userId`, `ud`, `addon`,
  `pendingTier`) are a wire contract with live subscriptions — do not rename.
- `Subscription.cancelAt` is informational for `periodEndCancel: true` providers; only the
  expiry cron acts on it, and only for providers that need it.
