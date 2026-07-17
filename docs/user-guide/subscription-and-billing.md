# Subscription and Billing

The billing system at `/billing` manages subscription plans, payment methods, and invoicing when Stripe is configured. Billing is entirely optional — Postmill works with all features available without Stripe.

## When Stripe is not configured

If no Stripe integration is set up (no `STRIPE_PUBLISHABLE_KEY` environment variable — this is the key the feature gate checks, `permissions.service.ts:58,103` — or Stripe is otherwise unreachable):

- All features are available to all users without restriction.
- The `/billing` page may redirect or show a "billing not configured" state.
- No subscription checks gate any functionality.

## When Stripe is configured

### Subscription plans

Postmill uses four fixed plans. Prices and limits are defined in `libraries/nestjs-libraries/src/database/prisma/subscriptions/pricing.ts` and surfaced dynamically by the billing backend — no `STRIPE_PRICE_*` environment variables are required.

| Plan | Monthly | Yearly | Channels | Posts/mo | Team seats | Video exports/mo | Hosted storage | BYO storage | Campaigns | API & MCP | Webhooks | Competitors | Analytics retention |
|------|---------|--------|----------|----------|------------|------------------|----------------|-------------|-----------|-----------|----------|-------------|---------------------|
| **Starter** | $9 | $90 | 3 | 100 | 1 | 15 | 1 GB | — | — | — | 1 | 1 | 180 days |
| **Pro** | $29 | $290 | 10 | Unlimited | 3 | 60 | 5 GB | — | ✓ | ✓ | 5 | 5 | 18 months |
| **Team** | $99 | $990 | 30 | Unlimited | 10 | 200 | 20 GB | ✓ | ✓ | ✓ | 20 | 20 | 18 months |
| **Agency** | $249 | $2,490 | 100 | Unlimited | 25 | 600 | 100 GB | ✓ | ✓ | ✓ | Unlimited | 50 | 18 months |

**Unlimited AI** — AI is bring-your-own-key across 25+ providers. There are no per-request AI credits or token quotas; usage is governed only by your own provider keys and any org-level spend caps you configure in Settings → AI.

**30-day free trial** — new organizations start with a 30-day trial on the plan they select. The trial can be ended early from `/billing`.

**Self-host unlock** — deployments without Stripe configured treat every org as the **Agency** plan (`SELF_HOST_PLAN = 'AGENCY'`), so self-hosters get the full feature set.

### Metered usage

Two resources are metered against the plan limits plus any active add-ons:

- **Hosted storage** — files stored in Postmill's local or cloud-backed storage count toward the plan's `storage_gb` cap. Connecting your own S3/R2/B2/IDrive bucket waives the hosted-storage cap for that provider (BYO storage is unlimited).
- **Video exports** — completed exports from the Designer timeline and media studios count toward the plan's `video_exports` cap.

Both caps are **hard caps**: once you hit the limit, the action is blocked until you upgrade or buy an add-on. There are no automatic overages.

### Add-ons

Add-ons extend the two metered caps:

- **Extra storage** — +25 GB per pack for $19/mo (default; configurable via `ADDON_STORAGE_GB_PER_PACK`).
- **Extra video exports** — +50 exports per pack for $19/mo (default; configurable via `ADDON_VIDEO_EXPORTS_PER_PACK`).

Add-ons are managed from Settings → Subscription. Pack sizes are configured server-side and mirrored to the frontend via `NEXT_PUBLIC_*` variables.

### Managing your subscription

`GET /user/subscription` returns your current subscription status, including the active plan, billing period, next renewal date, and any pending tier change.

`GET /user/subscription/tiers` returns all available plans for your organisation.

The billing interface (`/billing`) lets you:

- View your current plan and its features.
- Upgrade or downgrade between available plans.
- Manage add-ons.
- Manage your payment method (add, update, or remove cards).
- View invoice history with download links.

### Plan changes

- **Upgrade** — takes effect immediately. You are charged the prorated difference for the remainder of the billing period.
- **Downgrade** — takes effect at the end of the current billing period. You retain current-tier features until then and the UI shows the pending tier.
- **Cancel** — your subscription remains active until the end of the current billing period, then reverts to the free self-host behavior. No data is lost on cancellation — your posts, channels, and settings are preserved.

### Payment methods

Add and manage credit/debit cards through Stripe's hosted payment form. Card details are tokenised by Stripe and never touch Postmill's servers. You can:

- Add a new payment method.
- Set a default payment method for recurring charges.
- Remove saved payment methods.

### Invoice history

A list of past invoices with:

- Invoice date and number.
- Amount charged.
- Payment status (paid, pending, failed).
- Downloadable PDF receipt.

> Verified against v1.0.0
