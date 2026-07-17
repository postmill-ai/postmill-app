# Subscriptions & Stripe

Postmill's billing layer is built on Stripe. Organizations subscribe to one of four plans, each
with hard limits on channels, posts, team seats, video exports, and storage. The backend enforces
these limits at the API level; when a limit is hit the caller receives a `402 Payment Required`
response with an upsell link to `/billing`.

For self-hosted instances that do **not** set Stripe keys, billing is bypassed and every
organization is treated as the **Agency** plan.

## Required Stripe environment variables

Set these in your `.env` file or container environment:

| Variable | Purpose |
|----------|---------|
| `STRIPE_PUBLISHABLE_KEY` | Stripe publishable key (used by the frontend billing page). |
| `STRIPE_SECRET_KEY` | Stripe secret key (used server-side for charges, subscriptions, and the customer portal). |
| `STRIPE_SIGNING_KEY` | Stripe webhook signing secret (see [Webhook setup](#webhook-setup)). |

If `STRIPE_PUBLISHABLE_KEY` is absent, the entire billing gate is disabled and every org gets the
[Agency defaults](#self-hosted-default).

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

The `PermissionsService` evaluates every billed action against the org's effective limits. Limits
include purchased add-ons (`extraStorageGb`, `extraVideoExports`).

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

Two metered dimensions can be expanded without changing plans:

| Add-on | Default pack size | Price | Env override |
|--------|-------------------|-------|--------------|
| Extra storage | 25 GB | $19 / pack / month | `ADDON_STORAGE_GB_PER_PACK` |
| Extra video exports | 50 exports | $19 / pack / month | `ADDON_VIDEO_EXPORTS_PER_PACK` |

Add-ons are Stripe subscriptions marked with `metadata.addon`. Their quantities are synced back to
the `Subscription` table on every relevant Stripe webhook so effective limits update immediately.
The frontend mirrors the pack sizes via `NEXT_PUBLIC_ADDON_*` variables.

## Self-hosted default

If `STRIPE_PUBLISHABLE_KEY` is not set:

- All billing checks short-circuit to "allowed."
- Every organization is treated as `AGENCY`.
- The `/billing` page shows empty packages and does not offer checkout.

This is controlled by `SELF_HOST_PLAN = 'AGENCY'` in the pricing module.

## Webhook setup

Create a Stripe webhook endpoint that points to:

```
POST https://<your-domain>/stripe
```

Subscribe to these events:

- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_succeeded`
- `invoice.payment_failed`

Copy the webhook signing secret into `STRIPE_SIGNING_KEY`. The controller rejects events whose
`metadata.service !== 'postmill'` (except for the two invoice events, which are inspected per
subscription). Events are recorded in the `StripeEvent` table for idempotency; redeliveries of the
same `event.id` are ignored.

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
- `GET /billing/portal` returns a Stripe Customer Portal link for payment-method and invoice
  management.

Most billing-management routes require the `billing:manage` RBAC permission, but not all — `GET /billing/portal` and `POST /billing/finish-trial` are org-scoped without the `billing:manage` decorator (`billing.controller.ts:55,106`; the `@RequirePermission('billing','manage')` gate begins at line 123).

## Related

- [Configuration](./configuration.md) — full env var reference including Stripe and add-on pack sizes
- [Security](./security.md) — webhook signature verification and audit logging
- [Settings](../user-guide/settings.md) — the Team & Roles tab where the `billing:manage` permission is granted
- [Subscription & Billing](../user-guide/subscription-and-billing.md) — end-user guide to plans, add-ons, and the `/billing` UI

> Verified against v1.0.0
