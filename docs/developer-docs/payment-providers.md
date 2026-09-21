# Writing a payment provider

Postmill bills subscriptions through pluggable **payment providers**. Stripe, PayPal and the
app stores ship in the box; this page is for operators and contributors who need another one — a
regional gateway such as Razorpay, Paystack or Mollie, or an internal billing system.

A provider is a small TypeScript package that implements one interface, is switched on by
environment variables, and never touches the database. Everything else — plan limits, the 402
gate, subscription rows, dunning grace, add-on quantities, idempotency, audit — is handled once by
the orchestrator (`PaymentsService`), no matter which provider a customer pays through.

## How the pieces fit

```
mobile app / web app ──► /billing/* ──► PaymentsService ──► your adapter ──► vendor API
vendor webhook ──► /payments/webhooks/<id> ──► your adapter.receiveWebhook() ──► normalized events ──► PaymentsService.applyEvent()
```

- **Adapter** (`libraries/providers/<id>/src/v1/payments.adapter.ts`): talks to the vendor.
  Creates checkouts, changes plans, cancels, lists charges, verifies webhook signatures and
  translates vendor payloads into a small set of *normalized events*. It receives prices in the
  request and knows nothing about Postmill's database.
- **Orchestrator** (`libraries/nestjs-libraries/src/payments/payments.service.ts`): owns every
  database transition. `applyEvent()` is the single entry point for vendor state, whether it
  arrives by webhook, by polling after a redirect, from an app-store receipt or from the daily
  expiry job.
- **Env table** (`libraries/helpers/src/billing/payments.env.ts`): a pure list of each
  provider's keys. `billingEnabled()` — "is any provider configured?" — is evaluated from it in
  places that cannot reach the kernel (Inngest jobs, MCP tools, Next.js layouts).

Two families of provider exist, declared by `capabilities.checkoutMode`:

| Mode | Who starts the purchase | You implement |
|---|---|---|
| `hosted` / `embedded` | The web app (`createCheckout` returns a redirect URL or a client secret for an embedded form) | the web set: `ensureCustomer`, `createCheckout`, `setCancelAtPeriodEnd`, `cancelNow`, `checkoutStatus` |
| `native` | A mobile app through the App Store / Google Play; the server only verifies | `verifyPurchase` + the store-notification webhook |

## The contract

`PaymentsCapability` lives in `libraries/providers/kernel/src/domains/payments.ts`. The
required core is tiny:

```ts
export interface PaymentsCapability {
  name: string;
  capabilities: PaymentsCapabilityFlags;   // checkoutMode + ten booleans
  requiredEnvKeys: string[];               // first entry = the enabling key
  isConfigured(): boolean;
  publicConfig(): PaymentsPublicConfig;    // browser-safe: provider id, mode, public key
  receiveWebhook(input): Promise<WebhookReceipt>;
  // …then the methods behind the flags you turn on
}
```

Every optional feature is a **flag with a method behind it**:

| Flag | Method(s) | When `false` |
|---|---|---|
| `portal` | `manageUrl` | "Manage billing" is hidden |
| `proration` | `previewProration` | plan change quotes 0 |
| `addons` | `upsertAddon`, `cancelAddon`, `listAddonQuantities` | add-on packs hidden |
| `refunds` | `refund` | refunds return 400 |
| `chargesHistory` | `listCharges` | invoice list empty |
| `promoCodes` | `checkDiscount`, `applyDiscount` | no coupon offer |
| `trials` | `finishTrial` (web) | trial-end button hidden |
| `cardCheck` | `verifyPaymentMethod` | no authorise-and-void on trial start |
| `planChange` | `changePlan` | plan switches return 400 |
| `periodEndCancel` | semantics of `setCancelAtPeriodEnd` | see below |

A conformance helper (`runPaymentsConformance`) fails your package's tests if a flag is on and its
method is missing, so the orchestrator can trust the flags. Honest flags are the whole game: a
provider with `portal: false, addons: false, refunds: false` is perfectly valid — the UI simply
hides those features for organizations billed through it.

### Normalized events

`receiveWebhook` returns `{ eventId, eventType, events[] }`. `eventId` is the vendor's event id and
feeds the idempotency ledger — when the vendor sends none, derive one from the payload (a sha256 of
the body), never from the clock, so a redelivery stays idempotent. Traffic that is genuinely the
vendor's but not yours (another app on the same account, the other store environment) should return
`events: []` with `skipRecord: true`: acknowledged, not ledgered. `events` are drawn from:

| Event | Meaning |
|---|---|
| `subscription.activated` / `subscription.updated` | A subscription exists with `state` `{ tier, period, status, identifier, providerSubscriptionRef, isTrialing, cancelAt?, pendingTier? }` |
| `subscription.past_due` / `payment.failed` | Open the 7-day dunning grace window (and notify the org) |
| `subscription.canceled` | Tear the subscription down (limits fall back to Starter) |
| `payment.succeeded` | Track the purchase; apply a pending downgrade if one is due |
| `addons.changed` | Re-read add-on quantities from the vendor |

Each event carries `customerRef` — the vendor's stable reference for this customer (a Stripe
customer id, a PayPal subscription id, an App Store original transaction id). It becomes
`Organization.paymentId`, and it is how later webhooks find the organization. If your vendor has
no customer object, echo Postmill's organization id back through whatever free-form field the
vendor offers (`custom_id`, `appAccountToken`, `obfuscatedExternalAccountId`) and return it as
`orgIdHint` on the first activation; the orchestrator binds the org to the `customerRef` from
then on.

### Cancellation semantics

`setCancelAtPeriodEnd(customerRef, true | false | 'toggle')` returns
`{ cancelAt, cancelAtPeriodEnd, canceledNow }`.

- Vendors that can keep a cancelled subscription alive until the period end (Stripe) set
  `periodEndCancel: true`, flip the vendor flag and let the vendor's terminal webhook do the
  teardown.
- Vendors that can only cancel immediately (PayPal) set `periodEndCancel: false`, cancel at the
  vendor now, and return the current period's end as `cancelAt`. The orchestrator keeps the
  subscription row so the customer keeps what they paid for, and the daily
  `payments-expire-canceled` job tears it down once `cancelAt` has passed.

### Prices

Provider packages depend on the kernel only, so they cannot import Postmill's plan table.
Every call that may need to create a vendor price receives the amounts explicitly:
`PaymentsPlanPrice { tier, monthlyCents, yearlyCents, currency }` and
`PaymentsAddonSpec { type, productName, unitAmountCents, currency }`. Stripe's adapter creates
products and prices on demand and finds them again by name + interval + amount; do the same, or
map to pre-created vendor plans if your gateway requires it.

## Step by step

1. **Scaffold** `libraries/providers/<id>/` by copying `libraries/providers/stripe` (package
   manifest, `src/index.ts`, `src/v1/{index,metadata,payments.adapter}.ts`, `__tests__/`).
   Keep `metadata.ts` in the shape the other packages use.
2. **Implement** the adapter. Construct the vendor SDK lazily (the kernel checks that
   `create()` makes no network call). Read your keys from `process.env` inside the adapter only.
   `receiveWebhook` must verify the signature first and throw
   `PaymentsWebhookVerificationError` on failure (the endpoint answers 401).
3. **Declare the keys** in `PAYMENT_PROVIDER_ENV` in `libraries/helpers/src/billing/payments.env.ts`
   — the same list as your `requiredEnvKeys`, the first one being the key that switches the
   provider on, plus the browser-safe key (if any) and a display name. A test keeps the two in
   lockstep.
4. **Register** the package: import + spread in `apps/backend/src/providers.generated.ts`, two
   path aliases in `tsconfig.base.json`, a `workspace:*` dependency in `apps/backend/package.json`,
   then `pnpm install`.
5. **Test**: a spec with the vendor SDK mocked (signature failure, every event mapping, the
   checkout/cancel/plan-change calls) and a one-line conformance spec calling
   `runPaymentsConformance(module)`.
6. **Document**: a section in `docs/operations-guide/subscriptions.md` (keys, where to paste the
   webhook URL `https://<backend>/payments/webhooks/<id>`, sandbox notes) and the row in
   `.env.example`.

For the agent-facing checklist see `agents/skills/add-payments-provider/SKILL.md`; for the full
contract and orchestrator behaviour see `agents/providers/payments.md`.

## Running it

Set the provider's keys and, if another web provider is also enabled, `PAYMENTS_PROVIDER=<id>`.
The backend logs the configured providers and the resolved default at boot:

```
Payment providers: stripe, razorpay; web checkout default: razorpay (explicit).
```

`GET /billing/config` shows what the billing page sees. Send the vendor's test webhook and check
that a row appears in the payment-event ledger (`StripeEvent` table — it now serves every
provider). An organization is bound to the provider it subscribed through; switching providers is
cancel + resubscribe.
