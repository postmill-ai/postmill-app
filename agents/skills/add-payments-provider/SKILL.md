---
name: add-payments-provider
description: Add a subscription-billing payment provider (card PSP, regional gateway, or app store) to the Postmill ProviderKernel payments domain. Use when adding a payment provider, a billing gateway, a checkout/webhook integration, or app-store (Apple/Google) purchase verification selected by PAYMENTS_PROVIDER.
---

# Add a payments provider

Scaffold an env-configured payments adapter, register it in the kernel and the env truth table; no per-org config, no settings UI, no schema change.

## Read first
- `agents/providers/payments.md` — the domain contract, flag→method matrix, normalized events, adapter-vs-orchestrator split.
- `agents/providers/overview.md` — kernel contracts, package layout, registration.
- `agents/billing.md` — what the orchestrator does with your events (402 gate, plan table, `PaymentsService`).
- Reference implementation: `libraries/providers/stripe/src/v1/payments.adapter.ts` (web/embedded, every flag on).

## Key facts

- **Env-configured, one deployment-wide set of keys.** No `credentialFields`, no catalog kit. Your adapter's `requiredEnvKeys[0]` is the enabling key; the same list lives in `PAYMENT_PROVIDER_ENV` (`libraries/helpers/src/billing/payments.env.ts`) so `billingEnabled()` works where the kernel is not available. `apps/backend/src/__tests__/payments-env-lockstep.spec.ts` fails when they drift.
- **Adapters never touch the database or `pricing.ts`.** Prices arrive in the request (`PaymentsPlanPrice` has both periods; `PaymentsAddonSpec` the add-on). The orchestrator (`PaymentsService`) owns subscription rows, grace, audit, tracking, idempotency.
- **Two families.** `checkoutMode: 'hosted' | 'embedded'` (the web app calls `createCheckout`) or `'native'` (a mobile app buys through the store; you implement `verifyPurchase` and the store-notification webhook). Native providers are never the web default.
- **Flags must be honest.** `runPaymentsConformance` fails a flag without its method; the orchestrator returns 400 `PAYMENTS_UNSUPPORTED` for flags you set to false, and the billing UI hides the affordance.
- **Verify before parse.** `receiveWebhook` throws `PaymentsWebhookVerificationError` on a bad signature (→ 401). Never return `events: []` for an unverified payload. `skipRecord: true` is for foreign traffic on a shared vendor account.

## Procedure

1. Scaffold `libraries/providers/<id>/` mirroring `libraries/providers/stripe` — or, if the vendor already has a package (`apple`, `google` host auth/ai modules), add `src/v1/payments.adapter.ts` there and append the module to the package's default export. `package.json`: `@postmill-ai/provider-<id>`, deps `@postmill-ai/provider-kernel` `workspace:*` + the vendor SDK (or none — `ctx.fetch` for plain REST). `metadata.ts` declares `kind: "action"`, `domains: ["payments"]` (never `media` — a kernel spec enforces it), `hasModelList: false`, `mediaCategories: []` (keep the empty array: `tools/codegen/generate-studio-descriptor-registry.mjs --check` re-emits it).
2. Implement `PaymentsCapability` (`libraries/providers/kernel/src/domains/payments.ts`): `name`, `capabilities` (all eleven flags), `requiredEnvKeys`, `isConfigured()` (checks the enabling key only), `publicConfig()` (no secrets), `receiveWebhook`, then the family set (`ensureCustomer`, `createCheckout`, `setCancelAtPeriodEnd`, `cancelNow`, `checkoutStatus` — or `verifyPurchase`) and one method per flag you turn on. Lazy-construct the SDK client: `create()` must be network-free. Map vendor payloads to `NormalizedPaymentEvent`s; put the org id the vendor echoes back in `orgIdHint` when you have no customer object.
3. End the file with `export const <id>PaymentsModule: ProviderModule<any, any>` — manifest `domain: 'payments'`, `version: 'v1'`, `status: 'active'`, `credentialFields: []`, `platformConnect: 'env'`, `webhookInstructions` (where the operator pastes `https://<backend>/payments/webhooks/<id>`).
4. Add the row to `PAYMENT_PROVIDER_ENV` in `libraries/helpers/src/billing/payments.env.ts` (`enabledBy`, `required` in the same order as `requiredEnvKeys`, `checkoutMode`, `publicKeyEnv` for the browser-safe key, `displayName`). Extend `libraries/helpers/src/billing/payments.env.spec.ts` if your provider changes the default-provider resolution matrix (a second web provider makes `ambiguous` reachable).
5. Registration — 3 edits + install: `apps/backend/src/providers.generated.ts` (alphabetical import + spread), `tsconfig.base.json` (two aliases), `apps/backend/package.json` (`workspace:*`), then `pnpm install`. Skip all three when you added a module to an existing package.
6. Tests: `src/v1/__tests__/<id>.payments.adapter.spec.ts` with the vendor SDK/`fetch` mocked — cover `isConfigured`/`publicConfig`, webhook verification failure ⇒ `PaymentsWebhookVerificationError`, every event mapping you implement, checkout/plan-change/cancel calls; and `conformance.spec.ts` calling `runPaymentsConformance(module)` from `@postmill-ai/provider-kernel`.
7. Docs: `.env.example` payments block, `docs/operations-guide/subscriptions.md` (a section for your provider: keys, dashboard/webhook setup, sandbox), the env table in `agents/providers/payments.md`, a row + header counts in `libraries/providers/PROVIDERS_INVENTORY.md`, `CHANGELOG.md`.

No DB work: `Subscription.provider` / `Organization.paymentProvider` are free-form strings. No frontend work for a hosted provider; an `embedded` provider needs its client-side checkout component branched in `apps/frontend/src/components/billing/first.billing.component.tsx`; a native provider needs the mobile app to call `POST /billing/native/verify`.

## Verify

```bash
vitest run --root libraries/providers/<id>                 # adapter + conformance specs
vitest run --root libraries/providers                      # kernel-wide gates (all-providers, metadata)
vitest run --root libraries/helpers                        # env table spec
vitest run --root apps/backend src/__tests__               # lockstep + grep guard
pnpm run build && node tools/codegen/generate-studio-descriptor-registry.mjs --check
```

Manual smoke: set the provider's keys (sandbox) and `PAYMENTS_PROVIDER=<id>` ⇒ the backend logs `web checkout default: <id> (explicit)`, `GET /billing/config` lists it, a checkout round-trips, the vendor's test webhook lands as a `PaymentEvent` row.

## Pitfalls
- Reading `process.env.<VENDOR>_*` anywhere but the adapter and the env table — the grep guard only covers `STRIPE_*`, but the same rule applies: leaf services must use `billingEnabled()`.
- Returning a customer ref from `ensureCustomer` that is not stable across the org's life — it becomes `Organization.paymentId` and is how webhooks find the org. Vendors without a customer object return `existingRef` and rely on `orgIdHint`.
- `setCancelAtPeriodEnd` with `periodEndCancel: false`: cancel at the vendor **now** and return the period end as `cancelAt`; the orchestrator keeps the row and the `payments-expire-canceled` cron ends access — do not delete anything yourself.
- Stripe's metadata keys are a wire contract with live subscriptions; a new provider is free to choose its own, but must echo `identifier` back (`NormalizedSubscriptionState.identifier`) for `/billing/check/:id` to resolve.
