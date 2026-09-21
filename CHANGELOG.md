# Changelog

All notable changes to Postmill are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Organization-wide AI budget: a hard ceiling on total AI spend across all providers (monthly/daily caps + alert threshold), set from the new card at the top of **Settings → AI → LLM Providers** or `PUT /settings/ai/budget`. Enforced independently of per-provider caps — every AI call, including the AI Designer, content pipeline, agent digests and the daily brief, is refused with HTTP 429 (`org_budget_exceeded`) once reached. The usage dashboard now shows the organization's remaining budget. Stored on new nullable `Organization.aiBudget*` columns (migration `20260921130000_add_org_ai_budget_columns`); any cap previously written through the API into the legacy `perOrgCaps` settings slice is migrated on first boot. Previously that endpoint accepted a cap, sent an 80% alert, and never enforced it.

### Fixed

- Budget-exceeded responses from `/copilot/chat` and the post generator now carry `{ error: 'BudgetExceeded', message }` so the UI shows a friendly message instead of the raw reason string; the message no longer claims the cap is monthly and resets on the 1st.

- Provider errors are attributed to the provider. Every AI/media upstream failure (bad key, quota or billing limit, rate limit, invalid request, outage) is now a typed `ProviderUpstreamError` → HTTP **502** with `{ provider, providerName, kind, upstreamStatus, message, settingsUrl }`, and the UI names the provider ("Google AI Studio reports the account's quota or billing limit was reached…") instead of showing `{"statusCode":500,"message":"Internal server error"}`. Previously a raw AI-SDK error also made Nest replay the provider's HTTP status as Postmill's own — a provider 401 logged the user out, a provider 429 showed Postmill's rate-limit toast. All 36 media adapters, the LLM facade (`generateText`/`generateObject`/`*WithModel`/`languageModel`), the AI routes' catch-alls, the studio render queue and the dashboard/analytics/generator toasts are covered. Sentry only sees provider outages (warning level), not users' key/plan problems.
- AI: system prompts were sent as a parts array instead of a string (LanguageModelV2 shape), which Gemini rejects with `Unknown name "text" at 'system_instruction.parts[0]'` — dashboard brief, structured output and every `system`-prompted call on Google models failed. `generateTextWithModel` / `generateObjectWithModel` also silently dropped their `system` argument, and alt-text vision used the SDK v1 `{type:'image'}` part.

## [1.0.0] - 2026-09-16

### Added

- Initial public release.
