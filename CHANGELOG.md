# Changelog

All notable changes to Postmill are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Payment providers.** Billing is now a ProviderKernel domain (`payments`): Stripe is one provider (`payments/stripe@v1`, package `libraries/providers/stripe`) behind a provider-neutral orchestrator (`PaymentsService`), and any provider can be added by implementing the `PaymentsCapability` contract — see `docs/developer-docs/payment-providers.md`. Shipped alongside Stripe: **PayPal** (hosted checkout through the Subscriptions API, `PAYPAL_*`), the **Apple App Store** (`APPLE_IAP_*`) and **Google Play** (`GOOGLE_PLAY_*`) for the upcoming mobile app — the server verifies store purchases (`POST /billing/native/verify`) and consumes App Store Server Notifications / Play Real-time Developer Notifications. The billing pages branch on the deployment's checkout mode (embedded Stripe form, hosted redirect, or app-store copy) and hide affordances a provider lacks (portal, proration, coupons, add-ons, resume). Providers are enabled purely by their `.env` keys; `PAYMENTS_PROVIDER` picks the web-checkout default when several are enabled. New routes: `POST /payments/webhooks/:provider`, `GET /billing/config`, `POST /billing/native/verify` (for app-store purchases), `GET /billing/check/:id?ref=`. Schema: `Organization.paymentProvider`, `Subscription.provider`, `provider` on the webhook ledger (migration `20260921160000_payments_provider_domain`; existing Stripe organizations are backfilled). A daily `payments-expire-canceled` job tears down subscriptions whose scheduled end passed for providers that cannot keep a cancelled subscription alive until period end (log-only for Stripe).

- Organization-wide AI budget: a hard ceiling on total AI spend across all providers (monthly/daily caps + alert threshold), set from the new card at the top of **Settings → AI → LLM Providers** or `PUT /settings/ai/budget`. Enforced independently of per-provider caps — every AI call, including the AI Designer, content pipeline, agent digests and the daily brief, is refused with HTTP 429 (`org_budget_exceeded`) once reached. The usage dashboard now shows the organization's remaining budget. Stored on new nullable `Organization.aiBudget*` columns (migration `20260921130000_add_org_ai_budget_columns`); any cap previously written through the API into the legacy `perOrgCaps` settings slice is migrated on first boot. Previously that endpoint accepted a cap, sent an 80% alert, and never enforced it.

### Changed

- The billing master switch is "at least one payment provider is configured" (`billingEnabled()`) instead of `STRIPE_PUBLISHABLE_KEY` presence. For a Stripe-only deployment nothing changes: the same three `STRIPE_*` variables enable it.
- Stripe's proration preview no longer requires the price nickname to match (the four other lookups never did); prices are still matched by product name, interval and amount.

### Deprecated

- `POST /stripe` — the Stripe webhook now lives at `POST /payments/webhooks/stripe`. The old route forwards to the same handler and will be removed in a later release; re-point the Stripe dashboard webhook.

### Fixed

- `POST /billing/apply-discount` applied the coupon without waiting for the eligibility check (the check was never awaited); it now honours it.
- Budget-exceeded responses from `/copilot/chat` and the post generator now carry `{ error: 'BudgetExceeded', message }` so the UI shows a friendly message instead of the raw reason string; the message no longer claims the cap is monthly and resets on the 1st.

- Provider errors are attributed to the provider. Every AI/media upstream failure (bad key, quota or billing limit, rate limit, invalid request, outage) is now a typed `ProviderUpstreamError` → HTTP **502** with `{ provider, providerName, kind, upstreamStatus, message, settingsUrl }`, and the UI names the provider ("Google AI Studio reports the account's quota or billing limit was reached…") instead of showing `{"statusCode":500,"message":"Internal server error"}`. Previously a raw AI-SDK error also made Nest replay the provider's HTTP status as Postmill's own — a provider 401 logged the user out, a provider 429 showed Postmill's rate-limit toast. All 36 media adapters, the LLM facade (`generateText`/`generateObject`/`*WithModel`/`languageModel`), the AI routes' catch-alls, the studio render queue and the dashboard/analytics/generator toasts are covered. Sentry only sees provider outages (warning level), not users' key/plan problems.
- AI: system prompts were sent as a parts array instead of a string (LanguageModelV2 shape), which Gemini rejects with `Unknown name "text" at 'system_instruction.parts[0]'` — dashboard brief, structured output and every `system`-prompted call on Google models failed. `generateTextWithModel` / `generateObjectWithModel` also silently dropped their `system` argument, and alt-text vision used the SDK v1 `{type:'image'}` part.

## [1.0.0] - 2026-09-16

### Added

- Initial public release.
