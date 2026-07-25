# Subscriptions & billing (developer view)

Stripe-backed per-org subscriptions with a two-gate model: the **billing gate** (402, "has
this org paid?") is orthogonal to the **RBAC gate** (403, "is this member allowed?" — see
`agents/backend.md` / `agents/security.md`). Sibling docs: `agents/backend.md`,
`agents/database.md`, `agents/frontend.md`, `agents/jobs.md`.

## The billing master switch

Billing is **on iff `process.env.STRIPE_PUBLISHABLE_KEY` is set** — checked directly from
`process.env` in both backend services and frontend layouts (no cached config):

- Backend: `PermissionsService.check` short-circuits — when the key is absent every
  requested ability is granted, and `getPackageOptions` uses tier `SELF_HOST_PLAN =
  'AGENCY'` (`pricing.ts`). The same presence check gates credits/quota writes in
  `posts.service.ts`, `storage.service.ts`, `integration.service.ts`,
  `chat/start.mcp.ts`, `chat/tools/integration.schedule.post.ts`, video-export metering,
  etc. Self-hosted instances simply never set the key.
- Frontend: `billingEnabled = !!process.env.STRIPE_PUBLISHABLE_KEY` injected via the
  layout providers (`apps/frontend/src/app/(app)/layout.tsx`, `(provider)/layout.tsx`,
  `(extension)/layout.tsx`, `share/layout.tsx`) into `VariableContext`
  (`libraries/react-shared-libraries/src/helpers/variable.context.tsx`, default `false`),
  consumed as `useVariables().billingEnabled`. The settings nav gates the subscription
  section on `billingEnabled && isGeneral`
  (`components/settings/settings-nav.config.tsx`).

## The 402 gate

| Piece | Path | Notes |
|---|---|---|
| `@CheckPolicies(...handlers)` | `apps/backend/src/services/auth/permissions/permissions.ability.ts` | Metadata decorator; a handler is `[AuthorizationActions, Sections]` |
| `PoliciesGuard` | `apps/backend/src/services/auth/permissions/permissions.guard.ts` | Skips paths containing `/auth`, `/integrations/social-connect`, `/integrations/provider`, `/api/inngest`; no-op when the handler has no policies; throws `SubscriptionException` on the first failing policy |
| `SubscriptionException` | `apps/backend/src/services/auth/permissions/permission.exception.class.ts` | `HttpException` with `HttpStatus.PAYMENT_REQUIRED` (**402**), body `{section, action}` |
| `Sections` enum (14) | same file | `CHANNEL`, `POSTS_PER_MONTH`, `TEAM_MEMBERS`, `BRANDS`, `CAMPAIGNS`, `API`, `MCP`, `COMPETITORS`, `ADMIN`, `WEBHOOKS`, `MEDIA`, `VIDEO_EXPORTS`, `STORAGE`, `BYO_STORAGE` |
| `AuthorizationActions` enum | same file | `Create` / `Read` / `Update` / `Delete` |
| `PermissionsService` | `apps/backend/src/services/auth/permissions/permissions.service.ts` | Builds the CASL ability per request: `getPackageOptions` (tier + grace-lapse downgrade) → `getEffectiveLimits` (adds `extraStorageGb`/`extraVideoExports`, detects `byoStorageActive`) → per-section limit checks |

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
(downgrade to `STARTER`). Recovery clears the marker in `stripe.service.ts`.

## Super-admin scope

`User.isSuperAdmin` bypasses **RBAC only** (`org-rbac.guard.ts` line ~75). It does **not**
bypass `PoliciesGuard` — a super-admin in an unpaid org still gets 402. Do not add a
super-admin branch to the billing path.

## Prisma models

`libraries/nestjs-libraries/src/database/prisma/schema.prisma`:

| Model | Key fields |
|---|---|
| `Subscription` | `organizationId @unique`, `subscriptionTier SubscriptionTier`, `identifier?` (Stripe customer/sub id), `cancelAt?`, `period` (default `"MONTHLY"`), `totalChannels`, `isLifetime`, `gracePeriodEnd?`, `extraStorageGb`, `extraVideoExports`, `pendingTier?` (deferred downgrade), `deletedAt?` |
| `SubscriptionTier` (enum) | `STARTER`, `PRO`, `TEAM`, `AGENCY` |
| `StripeEvent` | `id` = Stripe `event.id`, `type`, `processedAt` — webhook idempotency ledger |
| `Credits` | `organizationId`, `credits Int`, `type` — the only live credit dimension is **`video_export`**; a regression guard (`no-ai-credits.invariant.spec.ts`) fails the build if removed AI-credit types (`ai_images`, …) resurface in app source |

## Services

| File | Symbol | Role |
|---|---|---|
| `libraries/nestjs-libraries/src/database/prisma/subscriptions/pricing.ts` | `pricing`, `PlanInterface`, `SELF_HOST_PLAN`, `ADDONS`, `addonPackSize` | The plan table (channels, posts/month, seats, brand kits, campaigns/api/mcp flags, webhooks, competitors, analytics retention, video exports, storage GB, byo_storage). Add-ons: `storage` (+25 GB default, `ADDON_STORAGE_GB_PER_PACK`) and `video_exports` (+50 default, `ADDON_VIDEO_EXPORTS_PER_PACK`), 1900¢ each |
| `…/subscriptions/subscription.service.ts` | `SubscriptionService`, `BillingTier` | `createOrUpdateSubscription`, `modifySubscription(ByOrg)`, `setPendingTier`/`clearPendingTier`, `updateAddonQuantities`, `_pruneToPlanLimits` (downgrade teardown), `getCreditsFrom`, `recordCredit(org, 'video_export')` |
| `…/subscriptions/stripe-event.repository.ts` | `StripeEventRepository` | Idempotency/grace reads; injected into `StripeService` as a `// layering: sanctioned leaf-read` |
| `libraries/nestjs-libraries/src/services/stripe.service.ts` | `StripeService` (~1460 lines) | `validateRequest` (`constructEvent` with `STRIPE_SIGNING_KEY`), `isEventProcessed`/`recordEvent` (C1 idempotency), `checkValidCard`, `createSubscription`/`updateSubscription`/`deleteSubscription`, `paymentSucceeded`/`paymentFailed` (dunning grace — verifies **live** subscription status before entering grace), `prorate` (`invoices.createPreview`), embedded + hosted checkout sessions, billing portal, `syncAddonQuantities`, lifetime deals, invoice PDF fetch, audit events |

## HTTP surface

- **Webhook:** `apps/backend/src/api/routes/stripe.controller.ts` — `POST /stripe`, raw
  body. Filters to `metadata.service === 'postmill'` (plus `invoice.payment_succeeded` /
  `invoice.payment_failed` which carry no metadata), checks `StripeEvent` idempotency
  **before** processing, records the event only after success (a thrown error stays
  retryable). Routes `customer.subscription.*` to add-on sync when
  `metadata.addon ∈ {storage, video_exports}`, else to base-subscription transitions.
- **Billing API:** `apps/backend/src/api/routes/billing.controller.ts` —
  `@Controller('/billing')`: `GET /` (current billing), `GET /check/:id`,
  `GET /check-discount`, `POST /apply-discount`, `POST /finish-trial`,
  `GET /is-trial-finished`, `POST /embedded`, `POST /subscribe`, `GET /portal`,
  `POST /cancel`, `POST /prorate`, `POST /lifetime`, plan-change/addon endpoints. See
  `billing.controller.plan-change.spec.ts` for the deferred-downgrade (`pendingTier`)
  contract.
- **Usage read:** `GET /dashboard/usage` (`dashboard.controller.ts`), consumed by
  `apps/frontend/src/components/settings/subscription/use-subscription.ts`
  (`USAGE_KEY = '/dashboard/usage'`; subscription from `GET /billing/`).

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
  `process.env.STRIPE_PUBLISHABLE_KEY` presence first (billing-off = allow/self-host
  behavior), then enforce via `SubscriptionService.getCreditsFrom`/`recordCredit` or the
  relevant count — mirror the existing early-return pattern.
- Never bypass the 402 path for super-admins, tests of "paid" behavior, or internal
  callers; the sanctioned bypass is unsetting `STRIPE_PUBLISHABLE_KEY` (self-host).
- Webhook changes stay in `stripe.controller.ts` routing + `StripeService` handlers; keep
  the `StripeEvent` idempotency contract (check before, record after success) and the
  `metadata.service === 'postmill'` filter.
- Plan-limit semantics live in exactly two places: `pricing.ts` (numbers) and
  `permissions.service.ts` (enforcement). Frontend plan copy derives from these — do not
  hardcode limits in components.
- Metered actions must record credits **after** confirmed completion (see the
  `video_export` charge in `MediaJobsActivity.processRenderJob` — a plain insert, never
  wrapped in an interactive transaction that a long render would outlive).
