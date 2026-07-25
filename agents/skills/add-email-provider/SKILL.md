---
name: add-email-provider
description: Add a transactional email provider (SMTP or API-based sender adapter) to the Postmill ProviderKernel email domain. Use when adding an email provider, a transactional email adapter, or an SMTP/API email sending provider selected by EMAIL_PROVIDER.
---

# Add an email provider

Scaffold a new env-configured email adapter package and register it in the kernel; no per-org config, no frontend, no schema change.

## Read first
- `agents/providers/overview.md` — kernel contracts, universal package layout, boot registration gates.
- `agents/providers/email.md` — the domain-specific recipe this skill condenses (reference: `libraries/providers/resend`).
- `agents/notifications.md` — the NotificationService chokepoint rule (feature code never calls `EmailService` directly).

## Key difference: env-configured, not per-org

Unlike ai/social/storage, email has **no per-org credential rows, no `credentialFields`, no Settings UI**. One deployment-wide provider is selected by the `EMAIL_PROVIDER` env var:

- `EmailAdapterRegistry.getActiveAdapter()` (`libraries/nestjs-libraries/src/emails/email-adapter.registry.ts:26`) reads `process.env.EMAIL_PROVIDER`, parses with `parseQualified()` (accepts `resend@v1`; a bare id resolves to the latest active version), and resolves via `ProviderResolutionService.resolveEmail()`.
- Fallback chain: unset, unknown id, resolution throw, or `isConfigured() === false` ⇒ the `empty` adapter (no-op `send()` returning `{}`).
- The `empty` provider is the always-on fallback: `ProvidersBootstrap` (`apps/backend/src/providers.bootstrap.ts:26-30`) registers it **regardless of `DEV_DISABLE_EMAIL`**; every other email provider honors that flag.

## Contract: `EmailCapability`

`libraries/providers/kernel/src/domains/email.ts` — required: `name`, `capabilities` (`{ webhooks, openTracking, clickTracking }`), `requiredEnvKeys: string[]`, `isConfigured()`, `send(params: EmailSendParams): Promise<EmailSendResult>`; optional: `verifyWebhook(rawBody, headers)`, `parseWebhook(rawBody, headers)`. `EmailSendResult.providerMessageId` is stored in `EmailLog` and is the join key for webhook status updates.

`requiredEnvKeys` reuses the shared `EMAIL_*` namespace — existing values: resend/sendgrid/postmark = `EMAIL_API_KEY`, `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME`; mailgun adds `EMAIL_MAILGUN_DOMAIN`; ses = `EMAIL_REGION` + from keys; smtp = `EMAIL_SMTP_HOST`, `EMAIL_SMTP_PORT` + from keys. `isConfigured()` must check the actual env vars (resend checks `!!process.env.EMAIL_API_KEY`).

## Send pipeline (already wired — do not rebuild)

`EmailService.sendEmail()` (`libraries/nestjs-libraries/src/services/email.service.ts`) enqueues Inngest event `email/send` with a deterministic id (`email_<sha256(to:subject:html)>_<minute-bucket>`) → `apps/backend/src/inngest/functions/send-email.ts` (rate-limited 1/sec globally) → `EmailService.sendEmailSync()` creates an `EmailLog` row, then calls `adapter.send()` with up to 3 attempts (700 ms backoff) and marks the log `sent` (with `providerMessageId`) or `failed`. Your adapter implements `send()` only.

Webhooks: one shared endpoint `POST /webhooks/email` (`apps/backend/src/api/routes/email-webhooks.controller.ts`, `@Throttle` 10 req/60 s). It no-ops unless the active adapter has `capabilities.webhooks: true` and both webhook methods; verify failure ⇒ 401; parsed events go to `EmailLogService.applyWebhookEvent()` which handles status precedence/ordering. Reference the svix pattern in `libraries/providers/resend/src/v1/email.adapter.ts:53-85` (`new Webhook(process.env.EMAIL_WEBHOOK_SECRET || '')`, map provider event types to `EmailStatus`).

## Procedure

1. Scaffold `libraries/providers/<id>/` mirroring `libraries/providers/resend`: `package.json` (`@postmill-ai/provider-<id>`, `main`/`types`: `src/index.ts`, deps `@postmill-ai/provider-kernel` `workspace:*` + vendor SDK, script `test: vitest run`); `src/index.ts` default-exporting the `ProviderModule[]` array; `src/v1/{index.ts, metadata.ts, email.adapter.ts, __tests__/}`.
2. Implement `EmailCapability` in `email.adapter.ts`; keep `create()` network-free (lazy-construct the SDK client, as resend does). End the file with `export const <id>EmailModule: ProviderModule<any, any>` — manifest `domain: 'email'`, `version: 'v1'`, `status: 'active'`, `credentialFields: []` (always empty). In `metadata.ts` copy the repo quirk verbatim: `kind: "action"`, `domains: ["media"]`, `hasModelList: false`.
3. If the provider supports status webhooks, implement `verifyWebhook`/`parseWebhook` and set `capabilities.webhooks: true`. Do **not** add a controller or route.
4. Registration — 3 edits + install (detail: `agents/providers/overview.md` § Registration):
   - `apps/backend/src/providers.generated.ts` (hand-maintained despite the name): add `import <id>Modules from '@postmill-ai/provider-<id>';` and spread `...<id>Modules,` into the `providerModules` array — both alphabetical.
   - `tsconfig.base.json`: two path aliases, `"@postmill-ai/provider-<id>": ["libraries/providers/<id>/src"]` and `".../*": ["libraries/providers/<id>/src/*"]`.
   - `apps/backend/package.json`: `"@postmill-ai/provider-<id>": "workspace:*"` in `dependencies`; then run `pnpm install`.
5. Update the `.env.example` "Email provider" block (~line 40): provider list in the `EMAIL_PROVIDER` comment plus any new `EMAIL_*` keys.
6. Tests: copy `libraries/providers/resend/src/v1/__tests__/resend.adapter.spec.ts` (mock the vendor SDK with `vi.mock`, set/clear `EMAIL_*` env in `beforeEach`/`afterEach`; cover name/capabilities, `isConfigured`, `send` mapping + errors, webhook verify/parse) and `conformance.spec.ts` (`runDomainConformance('email', module, { requiredMethods: ['send', 'isConfigured', 'verifyWebhook', 'parseWebhook'], capabilityKeys: ['webhooks', 'openTracking', 'clickTracking'] })` from `@postmill-ai/provider-kernel`).
7. Add a row + update header counts in `libraries/providers/PROVIDERS_INVENTORY.md` (maintained by hand).

No DB work: `EmailLog.provider` is a free-form string — no schema change, no migration. No frontend work of any kind.

## Verify

```bash
vitest run --root libraries/providers/<id>      # adapter + conformance specs
vitest run --root libraries/providers           # kernel-wide conformance gate
pnpm run build                                  # registration wiring compiles
```

Manual smoke: set `EMAIL_PROVIDER=<id>` + its `requiredEnvKeys` ⇒ `EmailService.hasProvider()` is true and sends land in `EmailLog`; unset/unknown ⇒ `empty` fallback, no crash.

## Pitfalls

- Building per-org config (`OrgProviderConfiguration` rows, `credentialFields`, Settings UI) — wrong model for this domain; email is env-only and deployment-wide.
- Declaring `requiredEnvKeys` but not validating them in `isConfigured()` — the registry falls back to `empty` silently when `isConfigured()` is false, so a sloppy check hides misconfiguration.
- Adding a new webhook route or controller — the shared `POST /webhooks/email` endpoint already dispatches to the active adapter; you only implement `verifyWebhook`/`parseWebhook`.
- Calling `EmailService` from feature code — user-facing mail must go through `NotificationService.sendEmail()` (`libraries/nestjs-libraries/src/database/prisma/notifications/notification.service.ts:288`), the single chokepoint.
- Doing network I/O in `create()` — the conformance spec requires a pure constructor; lazy-init the vendor client inside `send()`.
- Forgetting the always-on exception: only `empty` registers when `DEV_DISABLE_EMAIL=true`; your provider is gated by that flag, so a dev box with the flag set will silently fall back to `empty`.
