# Subscription and Billing

The billing system at `/billing` manages subscription plans, payment methods, and invoicing when a payment provider is configured — Stripe, PayPal, or, for the mobile app, the Apple App Store and Google Play. Billing is entirely optional — Postmill works with all features available without one.

## When no payment provider is configured

If no payment provider is set up (for Stripe that means no `STRIPE_PUBLISHABLE_KEY` environment variable — the feature gate checks whether any provider is configured):

- All features are available to all users without restriction.
- The `/billing` page may redirect or show a "billing not configured" state.
- No subscription checks gate any functionality.

## When a payment provider is configured

### Subscription plans

Postmill uses four fixed plans. Prices and limits are defined in `libraries/nestjs-libraries/src/database/prisma/subscriptions/pricing.ts` and surfaced dynamically by the billing backend — no `STRIPE_PRICE_*` environment variables are required.

| Plan | Monthly | Yearly | Channels | Posts/mo | Team seats | Video exports/mo | Hosted storage | BYO storage | Campaigns | API & MCP | Webhooks | Competitors | Analytics retention |
|------|---------|--------|----------|----------|------------|------------------|----------------|-------------|-----------|-----------|----------|-------------|---------------------|
| **Starter** | $9 | $90 | 3 | 100 | 1 | 15 | 1 GB | — | — | — | 1 | 1 | 180 days |
| **Pro** | $29 | $290 | 10 | Unlimited | 3 | 60 | 5 GB | — | ✓ | ✓ | 5 | 5 | 18 months |
| **Team** | $99 | $990 | 30 | Unlimited | 10 | 200 | 20 GB | ✓ | ✓ | ✓ | 20 | 20 | 18 months |
| **Agency** | $249 | $2,490 | 100 | Unlimited | 25 | 600 | 100 GB | ✓ | ✓ | ✓ | Unlimited | 50 | 18 months |

**Unlimited AI** — AI is bring-your-own-key across 30 providers. There are no per-request AI credits or token quotas; usage is governed only by your own provider keys and any spend caps you configure in **Settings → AI → LLM Providers** (an organisation-wide budget plus optional per-provider caps).

**30-day free trial** — new organizations start with a 30-day trial on the plan they select. The trial can be ended early from `/billing`.

**Self-host unlock** — deployments without a payment provider configured treat every org as the **Agency** plan (`SELF_HOST_PLAN = 'AGENCY'`), so self-hosters get the full feature set.

### Metered usage

Two resources are metered against the plan limits plus any active add-ons:

- **Hosted storage** — files stored in Postmill's local or cloud-backed storage count toward the plan's `storage_gb` cap. Connecting your own S3/R2/B2/IDrive bucket waives the hosted-storage cap for that provider (BYO storage is unlimited).
- **Video exports** — completed exports from the Designer timeline and media studios count toward the plan's `video_exports` cap.

Both caps are **hard caps**: once you hit the limit, the action is blocked until you upgrade or buy an add-on. There are no automatic overages.

### Add-ons

Every capped plan limit can be extended with add-on packs, so nothing is a hard ceiling — you can
always buy more or upgrade your plan:

- **Extra storage** — +25 GB per pack for $19/mo (default; configurable via `ADDON_STORAGE_GB_PER_PACK`).
- **Extra video exports** — +50 exports per pack for $19/mo (default; configurable via `ADDON_VIDEO_EXPORTS_PER_PACK`).
- **Extra channels** — +5 channels per pack for $19/mo.
- **Extra team seats** — +5 seats per pack for $15/mo.
- **Extra posts** — +500 posts per month per pack for $9/mo.
- **Extra brand kits** — +5 brand kits per pack for $9/mo.
- **Extra webhooks** — +10 webhooks per pack for $9/mo.
- **Extra competitors** — +10 competitors per pack for $9/mo.

Add-ons are managed from Settings → Subscription and are available only when your organisation is
billed through Stripe (PayPal and the app stores have no add-on packs). Pack sizes are configured server-side and
mirrored to the frontend via `NEXT_PUBLIC_*` variables. Add-ons survive a plan downgrade — if you
move to a lower plan, excess channels and seats are only pruned down to what your new plan plus
your active add-on packs allow. Add-ons are not available to organizations on lifetime plans.

### Managing your subscription

`GET /user/subscription` returns your current subscription status, including the active plan, billing period, next renewal date, and any pending tier change.

`GET /user/subscription/tiers` returns all available plans for your organisation.

The billing interface (`/billing`) lets you:

- View your current plan and its features.
- Upgrade or downgrade between available plans.
- Cancel your subscription.
- Open your payment provider's customer portal (**Update Payment Method / Invoices History**) to
  manage payment methods and invoices, when the provider has one.

Add-ons are managed from Settings → Subscription. Controls a provider does not support are hidden.

### Plan changes

- **Upgrade** — takes effect immediately. With Stripe you are charged the prorated difference for the remainder of the billing period (PayPal prorates plan revisions itself).
- **Downgrade** — takes effect at the end of the current billing period. You retain current-tier features until then and the UI shows the pending tier, which you can undo.
- **Cancel** — your subscription remains active until the end of the current billing period, then ends. With Stripe you can resume a cancelled subscription before it expires; a cancelled PayPal subscription cannot be resumed — subscribe again once the period ends. No data is lost on cancellation — your posts, channels, and settings are preserved.

### Payment providers

How you pay depends on the payment provider your organisation is billed through:

- **Stripe** — an embedded card form on the `/billing` page; supports proration, coupons, add-ons, and a customer portal for payment methods and invoices.
- **PayPal** — **Continue with PayPal** redirects you to PayPal to approve the subscription, then back to Postmill. You manage the agreement itself at paypal.com.
- **App Store / Google Play** — subscriptions bought in the mobile app are managed in the app store; the web billing pages show **Manage subscription**, which links to the store. When the deployment sells plans only through the mobile app, the web pages ask you to subscribe in the app.

An organisation stays **locked to the provider it first subscribed through**, even after its subscription lapses — a workspace that once paid with Stripe cannot later buy through PayPal or an app store, and vice versa.

### Payment methods and invoices

Card details are entered in the provider's own payment form (Stripe's embedded form, or PayPal's or the app store's checkout) and never touch Postmill's servers. With Stripe, the **Update Payment Method / Invoices History** button opens Stripe's customer portal, where you can add, update, or remove cards, set the default payment method, and download past invoices.

> Verified against v1.4.0
