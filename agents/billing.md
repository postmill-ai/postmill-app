# Subscriptions & billing (developer view)

Per-org subscriptions billed through a **payment provider** (Stripe, PayPal, the app stores —
the `payments` kernel domain, see `agents/providers/payments.md`) with a two-gate model: the
**billing gate** (402, "has this org paid?") is orthogonal to the **RBAC gate** (403, "is this
member allowed?" — see `agents/backend.md` / `agents/security.md`). Sibling docs:
`agents/backend.md`, `agents/database.md`, `agents/frontend.md`, `agents/jobs.md`.

## The billing master switch

Billing is **on iff at least one payment provider is configured** — `billingEnabled()` from
`libraries/helpers/src/billing/payments.env.ts` (pure, reads `process.env` on every call, no
cached config; for Stripe that is still just `STRIPE_PUBLISHABLE_KEY`). Never test a vendor key
directly — a grep-guard spec fails the build on a raw `process.env.STRIPE_*` read outside the
Stripe adapter.

- Backend: `PermissionsService.check` short-circuits — when billing is off every requested
  ability is granted, and `getPackageOptions` uses tier `SELF_HOST_PLAN = 'AGENCY'`
  (`pricing.ts`). The same `billingEnabled()` check gates credits/quota writes in
  `posts.service.ts`, `storage.service.ts`, `integration.service.ts`, `chat/start.mcp.ts`,
  `chat/tools/integration.schedule.post.ts`, video-export metering, the public-API
  "no subscription" 401, etc. Self-hosted instances simply never set a provider key.
- Frontend: the server layouts (`apps/frontend/src/app/(app)/layout.tsx`,
  `(provider)/layout.tsx`, `(extension)/layout.tsx`, `share/layout.tsx`) call
  `paymentsVariables()` (`apps/frontend/src/app/payments.vars.ts`) and inject
  `billingEnabled` plus `payments = { provider, checkoutMode, publicKey, displayName }` (the
  default web provider's public bits) into `VariableContext`
  (`libraries/react-shared-libraries/src/helpers/variable.context.tsx`), consumed as
  `useVariables().billingEnabled` / `.payments`. The settings nav gates the subscription
  section on `billingEnabled && isGeneral` (`components/settings/settings-nav.config.tsx`).
- Which provider serves web checkout: `PAYMENTS_PROVIDER` (see `agents/providers/payments.md`).

## The 402 gate

| Piece | Path | Notes |
|---|---|---|
| `@CheckPolicies(...handlers)` | `apps/backend/src/services/auth/permissions/permissions.ability.ts` | Metadata decorator; a handler is `[AuthorizationActions, Sections]` |
| `PoliciesGuard` | `apps/backend/src/services/auth/permissions/permissions.guard.ts` | Skips paths containing `/auth`, `/integrations/social-connect`, `/integrations/provider`, `/api/inngest`; no-op when the handler has no policies; throws `SubscriptionException` on the first failing policy |
| `SubscriptionException` | `apps/backend/src/services/auth/permissions/permission.exception.class.ts` | `HttpException` with `HttpStatus.PAYMENT_REQUIRED` (**402**), body `{section, action}` |
| `Sections` enum (14) | same file | `CHANNEL`, `POSTS_PER_MONTH`, `TEAM_MEMBERS`, `BRANDS`, `CAMPAIGNS`, `API`, `MCP`, `COMPETITORS`, `ADMIN`, `WEBHOOKS`, `MEDIA`, `VIDEO_EXPORTS`, `STORAGE`, `BYO_STORAGE` |
| `AuthorizationActions` enum | same file | `Create` / `Read` / `Update` / `Delete` |
| `PermissionsService` | `apps/backend/src/services/auth/permissions/permissions.service.ts` | Builds the CASL ability per request: `getPackageOptions` (tier + grace-lapse downgrade) → `getEffectiveLimits` (merges add-on extras + `limitOverrides` via `mergeEffectiveLimits`, detects `byoStorageActive`) → per-section limit checks |

Effective limits merge in exactly one place: **`mergeEffectiveLimits(base, subscription)`**
(`libraries/nestjs-libraries/src/database/prisma/subscriptions/effective.limits.ts`) — base plan +
each `ADDONS[type]` extra column + manual overrides (overrides win last, replacing base+add-ons).
Channels are special: the persisted `totalChannels` column is the base, not `options.channel`.
All four readers go through it: `PermissionsService` enforcement, the storage upload quota
(`storage.service.ts` `assertWithinQuota`), the channel-enable gate
(`integrations.controller.ts` `POST /integrations/enable`), and the dashboard usage read
(`dashboard.service.ts`). Never re-implement the merge at a call site.

Per-section enforcement inside `check()`:

- `CHANNEL` — count non-`refreshNeeded` integrations; a refresh (`?refresh=<id>` of an
  existing org channel) bypasses the limit.
- `POSTS_PER_MONTH` — `PostsService.countPostsFromDay` from the billing-month anniversary
  (`subscription.createdAt` else org `createdAt`).
- `TEAM_MEMBERS` — only **enabled** seats count (disabled pruned members don't).
- `WEBHOOKS`, `BRANDS`, `COMPETITORS` — row counts vs. plan numbers.
- `CAMPAIGNS`, `API`, `MCP`, `BYO_STORAGE` — boolean plan flags.
- `MEDIA` — never paywalled (always granted; guard still enforces auth/org).
- `VIDEO_EXPORTS` — `Credits` rows of type `video_export` since billing-month start **plus
  in-flight `AIMediaJob` renders** (TOCTOU fix: the credit is recorded only after the
  async render completes, so in-flight jobs count toward the cap).

**Dunning/grace:** a past-due subscription gets `Subscription.gracePeriodEnd` instead of an
immediate teardown; `getPackageOptions` treats a lapsed grace window as no subscription
(downgrade to `STARTER`). Recovery clears the marker in `PaymentsService.applyEvent`.

## Super-admin scope

`User.isSuperAdmin` bypasses **RBAC only** (`org-rbac.guard.ts` line ~75). It does **not**
bypass `PoliciesGuard` — a super-admin in an unpaid org still gets 402. Do not add a
super-admin branch to the billing path.

## Prisma models

`libraries/nestjs-libraries/src/database/prisma/schema.prisma`:

| Model | Key fields |
|---|---|
| `Subscription` | `organizationId @unique`, `subscriptionTier SubscriptionTier`, `identifier?` (the app-generated purchase id echoed back by the vendor), `provider` (default `"stripe"`; `"manual"` for lifetime/admin grants), `cancelAt?`, `period` (default `"MONTHLY"`), `totalChannels`, `isLifetime`, `gracePeriodEnd?`, `extraStorageGb`, `extraVideoExports`, `extraChannels`, `extraTeamMembers`, `extraPosts`, `extraBrandKits`, `extraWebhooks`, `extraCompetitors` (all `Int @default(0)` add-on tallies), `limitOverrides?` (JSON sparse map, super-admin only), `pendingTier?` (deferred downgrade), `deletedAt?` |
| `Organization` (billing columns) | `paymentId?` — the vendor customer/account ref (Stripe customer id, PayPal subscription id, Apple originalTransactionId, Google purchaseToken); `paymentProvider?` — which provider issued it |
| `SubscriptionTier` (enum) | `STARTER`, `PRO`, `TEAM`, `AGENCY` |
| `PaymentEvent` (table `StripeEvent`) | `id` = the vendor event id, `type`, `provider`, `processedAt` — webhook idempotency ledger for every provider |
| `Credits` | `organizationId`, `credits Int`, `type` — the only live credit dimension is **`video_export`**; a regression guard (`no-ai-credits.invariant.spec.ts`) fails the build if removed AI-credit types (`ai_images`, …) resurface in app source |

## Services

| File | Symbol | Role |
|---|---|---|
| `libraries/nestjs-libraries/src/database/prisma/subscriptions/pricing.ts` | `pricing`, `PlanInterface`, `SELF_HOST_PLAN`, `ADDONS`, `AddonType`, `addonPackSize`, `addonPriceCents` | The plan table (channels, posts/month, seats, brand kits, campaigns/api/mcp flags, webhooks, competitors, analytics retention, video exports, storage GB, byo_storage). **8 add-on types** (`storage`, `video_exports`, `channels`, `team_seats`, `posts`, `brand_kits`, `webhooks`, `competitors`), data-driven: each `ADDONS[type]` entry carries `column` (the `Subscription` `extra*` column), `limitKey` (the `PlanInterface` key it raises), `packSizeEnv`+`defaultPackSize`, `priceCentsEnv`+`defaultPriceCents` — sync and merge are generic loops over `ADDONS`, no per-type branches. `addonPackSize()`/`addonPriceCents()` are server-side only (dynamic `process.env` reads return defaults in the browser; the frontend uses statically-referenced `NEXT_PUBLIC_ADDON_*` mirrors) |
| `…/subscriptions/subscription.service.ts` | `SubscriptionService`, `BillingTier` | `createOrUpdateSubscription`, `modifySubscription(ByOrg)`, `setPendingTier`/`clearPendingTier`, `updateAddonQuantities`, `_pruneToPlanLimits` (downgrade teardown), `getCreditsFrom`, `recordCredit(org, 'video_export')` |
| `…/subscriptions/payment-event.repository.ts` | `PaymentEventRepository` | Idempotency/grace reads (scoped by `paymentId` + `paymentProvider`); injected into `PaymentsService` as a `// layering: sanctioned leaf-read` |
| `libraries/nestjs-libraries/src/payments/payments.service.ts` | `PaymentsService` | The provider-agnostic orchestrator: resolves the org's provider (`resolveOrgProvider`), drives the adapter (`PaymentsCapability`), and owns every DB transition — `applyEvent` (single sink for normalized vendor events: activation/update with the trial card check, dunning grace with the **live**-status guard, cancel teardown, `payment.succeeded` → purchase tracking + `pendingTier` apply, add-on sync), `handleWebhook` (verify → idempotency → apply → record), `startCheckout`, `changePlan`, `setToCancel`, `prorate`, charges/refunds, `lifetimeDeal`, `verifyNativePurchase`, `expireCanceledSubscriptions` |
| `libraries/nestjs-libraries/src/payments/payments-config.service.ts` | `PaymentsConfigService` | Env-table wrapper + kernel resolution; boot log of the configured providers and the resolved `PAYMENTS_PROVIDER` |
| `libraries/providers/stripe/src/v1/payments.adapter.ts` | `StripePaymentsAdapter` (`payments/stripe@v1`) | Every Stripe API call: webhook verification + event translation, catalog get-or-create, embedded/hosted checkout, plan change, cancel, discounts, portal, add-ons, charges, refunds, the `$1` card check |

## HTTP surface

- **Webhooks:** `apps/backend/src/api/routes/payments.webhooks.controller.ts` —
  `POST /payments/webhooks/:provider`, raw body, public (the vendor signature is the auth).
  The adapter verifies + translates; `PaymentsService.handleWebhook` checks `PaymentEvent`
  idempotency **before** applying and records only after success (a thrown error stays
  retryable). `POST /stripe` (`stripe.controller.ts`) is a **deprecated alias** kept for
  dashboards configured before the payments domain; remove once every deployment has
  re-pointed its Stripe webhook.
- **Billing API:** `apps/backend/src/api/routes/billing.controller.ts` —
  `@Controller('/billing')`: `GET /config` (deployment + org payment config for the UI),
  `GET /` (current billing), `GET /check/:id?ref=`, `GET /check-discount`,
  `POST /apply-discount`, `POST /finish-trial`, `GET /is-trial-finished`, `POST /embedded`,
  `POST /subscribe`, `GET /portal`, `POST /cancel`, `POST /prorate`, `POST /lifetime`,
  `POST /native/verify` (store purchase handover), plan-change/addon endpoints. Operations the
  org's provider cannot do answer **400 `{ code: 'PAYMENTS_UNSUPPORTED', provider, operation }`**
  (`PaymentsUnsupportedOperationFilter`). See `billing.controller.plan-change.spec.ts` for the
  deferred-downgrade (`pendingTier`) contract.
- **Usage read:** `GET /dashboard/usage` (`dashboard.controller.ts`), consumed by
  `apps/frontend/src/components/settings/subscription/use-subscription.ts`
  (`USAGE_KEY = '/dashboard/usage'`; subscription from `GET /billing/`).
- **Manual limit overrides (super-admin, backend-only):** `PATCH
  /admin/orgs/:orgId/limit-overrides`, body `{ overrides: { <limitKey>: number|null } }` — a
  number sets, `null` clears, absent leaves. Keys are the 8 `OVERRIDABLE_LIMIT_KEYS` in
  `effective.limits.ts`; `analytics_retention_days` and booleans are deliberately rejected.
  Consumed by the separate admin app with the super-admin JWT in the custom `auth` header
  (CSRF skipped for header auth; no API-key path). Must stay registered in the
  `authenticatedController` array in `api.module.ts`. No frontend in this repo.

## Frontend surfaces

- Pages: `apps/frontend/src/app/(app)/(site)/billing/` (checkout flow),
  `apps/frontend/src/app/(app)/(site)/settings/subscription/` (manage panel).
- Components: `apps/frontend/src/components/billing/` (`billing.component.tsx`,
  `main.billing.component.tsx`, `first.billing.component.tsx`, `embedded.billing.tsx`,
  `finish.trial.tsx`, `lifetime.deal.tsx`, `faq.component.tsx`),
  `apps/frontend/src/components/settings/subscription/` (`subscription.panel.tsx`,
  `use-subscription.ts`).
- Gating UI: `useVariables().billingEnabled`; `top.menu.tsx` hides `requireBilling` items
  when billing is off. The 402 body `{section, action}` is what upgrade prompts key on.

## Key rules

- **To gate a new route:** add `@CheckPolicies([AuthorizationActions.X, Sections.Y])`. If
  the limit is a new dimension, extend `PlanInterface` + all four tiers in `pricing.ts`
  and add the counting branch in `PermissionsService.check`. Mutations usually also need
  `@RequirePermission` (RBAC) — the gates are complementary, not alternatives.
- **To gate non-HTTP work** (agent tools, MCP, Inngest activities): check
  `billingEnabled()` first (billing-off = allow/self-host behavior), then enforce via
  `SubscriptionService.getCreditsFrom`/`recordCredit` or the relevant count — mirror the
  existing early-return pattern.
- Never bypass the 402 path for super-admins, tests of "paid" behavior, or internal
  callers; the sanctioned bypass is configuring no payment provider (self-host).
- Webhook changes live in the provider adapter's `receiveWebhook` (vendor payload →
  `NormalizedPaymentEvent`) and `PaymentsService.applyEvent` (DB transition); keep the
  `PaymentEvent` idempotency contract (check before, record after success). The Stripe
  adapter keeps the `metadata.service === 'postmill'` filter and its metadata keys — they are a
  wire contract with live subscriptions.
- Plan-limit semantics live in exactly two places: `pricing.ts` (numbers) and
  `permissions.service.ts` (enforcement). Frontend plan copy derives from these — do not
  hardcode limits in components.
- Metered actions must record credits **after** confirmed completion (see the
  `video_export` charge in `MediaJobsActivity.processRenderJob` — a plain insert, never
  wrapped in an interactive transaction that a long render would outlive).
- **Downgrade pruning targets effective limits** — `_pruneToPlanLimits`
  (`subscription.service.ts`) prunes channels/seats to plan + surviving add-on packs +
  overrides, not to the bare plan: add-ons survive a downgrade.
- **Lifetime orgs cannot purchase add-ons** (frontend hides the section, backend rejects) —
  no base vendor subscription for add-on items to ride on.
- **Scheduled cancellations** (`Subscription.cancelAt`) are informational for providers with
  `periodEndCancel: true` (Stripe keeps the vendor subscription alive and sends the terminal
  webhook). For providers without it the row stays and the Inngest cron
  `payments-expire-canceled` tears it down after `cancelAt` (Stripe/manual rows are excluded from that query).
- **Price-env changes grandfather:** a new `ADDON_*_PRICE_CENTS` value creates a new Stripe
  Price for new purchases only; existing add-on subscriptions keep the old price (migrating
  them is a manual Stripe operation). The same env value must feed both the Stripe price
  lookup and price creation, or every call find-mismatches and recreates.
- **`NEXT_PUBLIC_ADDON_*` mirrors are build-time** — changing a backend `ADDON_*` without
  rebuilding the frontend with matching mirrors leaves the UI showing stale pack
  sizes/prices. Never call `addonPackSize()`/`addonPriceCents()` client-side.
