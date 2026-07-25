# Adding an email provider

This doc covers adding a new transactional-email adapter to the `email` domain of the ProviderKernel. Email is the env-configured domain: one deployment-wide provider selected by `EMAIL_PROVIDER`, no per-org configuration, no frontend work.

Reference implementation: `libraries/providers/resend` (adapter at `src/v1/email.adapter.ts`). Existing email providers: `resend`, `sendgrid`, `mailgun`, `postmark`, `ses`, `smtp`, plus the always-on `empty` fallback — all under `libraries/providers/<id>`.

## Contract: `EmailCapability`

Defined in `libraries/providers/kernel/src/domains/email.ts`, re-exported from `@postmill-ai/provider-kernel` and (aliased as `EmailAdapter`) from `@postmill-ai/nestjs-libraries/emails/email-adapter.interface`:

```ts
export interface EmailCapability {
  name: string;
  capabilities: EmailAdapterCapabilities; // { webhooks, openTracking, clickTracking } — all boolean
  requiredEnvKeys: string[];              // env vars this adapter needs (see table below)
  isConfigured(): boolean;                // false ⇒ registry falls back to 'empty'
  send(params: EmailSendParams): Promise<EmailSendResult>;
  verifyWebhook?(rawBody: Buffer, headers: Record<string, string | undefined>): boolean | Promise<boolean>;
  parseWebhook?(rawBody: Buffer, headers: Record<string, string | undefined>): EmailWebhookEvent[];
}
```

- `EmailSendParams`: `{ to, subject, html, fromName, fromAddress, replyTo? }`. `EmailSendResult`: `{ providerMessageId? }` — return the provider's message id; it is stored in `EmailLog` and is the join key for webhook status updates.
- `EmailStatus`: `'queued' | 'sent' | 'failed' | 'delivered' | 'bounced' | 'complained' | 'opened' | 'clicked'`.
- `EmailWebhookEvent`: `{ providerMessageId?, recipient?, status, occurredAt }`.
- `EmailAdapterCapabilities` flags: `webhooks` (adapter implements verify/parse and the webhook endpoint should process events), `openTracking`, `clickTracking` (informational; set false when unsupported, as `empty` does).

`requiredEnvKeys` convention (shared `EMAIL_*` namespace, per-adapter extras):

| Provider | `requiredEnvKeys` |
|---|---|
| resend, sendgrid, postmark | `EMAIL_API_KEY`, `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME` |
| mailgun | above + `EMAIL_MAILGUN_DOMAIN` |
| ses | `EMAIL_REGION`, `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME` |
| smtp | `EMAIL_SMTP_HOST`, `EMAIL_SMTP_PORT`, `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME` |

## Key difference: env-configured, not per-org

Unlike ai/social/storage providers, email has **no per-org credential rows, no `credentialFields`, no Settings UI**. Selection is deployment-wide:

- `EmailAdapterRegistry.getActiveAdapter()` (`libraries/nestjs-libraries/src/emails/email-adapter.registry.ts`) reads `process.env.EMAIL_PROVIDER`, parses it with `parseQualified()` (`libraries/providers/kernel/src/identity.ts:52` — accepts `resend@v1`; a bare `resend` resolves to the latest active version), and resolves through `ProviderResolutionService.resolveEmail()` (`libraries/nestjs-libraries/src/providers/provider-resolution.service.ts:345`) so every call rides the kernel telemetry proxy.
- Fallback chain: unset `EMAIL_PROVIDER`, unknown id, resolution throw, or `isConfigured() === false` ⇒ the `empty` adapter (`libraries/providers/empty/src/v1/email.adapter.ts`: `send()` is a no-op returning `{}`, all capabilities false).
- Registration: `ProvidersBootstrap` (`apps/backend/src/providers.bootstrap.ts:26-30`) registers `email/empty` **regardless of `DEV_DISABLE_EMAIL`** (it is the always-on fallback); every other email provider honours the flag (`FeatureFlagsService` maps `email` → `DEV_DISABLE_EMAIL`, `libraries/nestjs-libraries/src/feature-flags/feature-flags.service.ts:28`).
- Env documentation lives in `.env.example` ("Email provider" block, ~line 41). Update the provider list comment there when adding one.

## Send pipeline (already wired — do not rebuild)

`EmailService` (`libraries/nestjs-libraries/src/services/email.service.ts`) owns the flow; your adapter only implements `send()`:

1. `sendEmail()` enqueues Inngest event `email/send` with a deterministic id (`email_<sha256(to:subject:html)>_<minute-bucket>`); skipped when Inngest is disabled.
2. `createSendEmail` (`apps/backend/src/inngest/functions/send-email.ts`) consumes it, rate-limited to 1/sec globally, calling `EmailActivity.sendEmail()` → `EmailService.sendEmailSync()`.
3. `sendEmailSync()` wraps the HTML in the standard template (sender block + preferences link), creates an `EmailLog` row via `EmailLogService.createLog()`, then calls `adapter.send()` with up to 3 attempts (700 ms backoff), marking the log `sent` (with `providerMessageId`, or `'no-id'`) or `failed`.
4. `hasProvider()` returns true only when the active adapter is not `empty` and `isConfigured()`.

**Notification chokepoint:** feature code never calls `EmailService` directly — user-facing mail goes through `NotificationService` (`libraries/nestjs-libraries/src/database/prisma/notifications/notification.service.ts:288`, `sendEmail()` → `_emailService.sendEmail(...)`). See `agents/notifications.md`.

## Webhooks

One generic endpoint already exists: `POST /webhooks/email` in `EmailWebhooksController` (`apps/backend/src/api/routes/email-webhooks.controller.ts`), throttled 10 req/60 s. It no-ops (`{ ok: true }`) unless the active adapter has `capabilities.webhooks` plus both methods; otherwise `verifyWebhook` failure ⇒ 401, then each parsed event goes to `EmailLogService.applyWebhookEvent()`. **No new controller or route is needed for a new provider.**

Resend's svix pattern (`libraries/providers/resend/src/v1/email.adapter.ts:53-85`):

- `verifyWebhook`: construct `new Webhook(process.env.EMAIL_WEBHOOK_SECRET || '')` (from the `svix` package) and call `wh.verify(rawBody.toString(), { 'svix-id', 'svix-timestamp', 'svix-signature' } from headers)`; any throw ⇒ `false`.
- `parseWebhook`: `JSON.parse` the raw body, map provider event types to `EmailStatus` (`email.delivered` → `delivered`, `email.bounced` → `bounced`, …), return `[]` for unmapped types, and emit `{ providerMessageId: event.data.email_id, recipient: event.data.to?.[0], status, occurredAt: new Date() }`.

`EmailLogService.applyWebhookEvent()` (`libraries/nestjs-libraries/src/database/prisma/emails/email-log.service.ts:55`) matches on `(provider, providerMessageId)` and applies status precedence (`STATUS_PRECEDENCE`): out-of-order/lower-rank events are dropped, `bounced`/`complained` are terminal, `delivered` sets `deliveredAt`. Unknown message ids create a placeholder row. So your `parseWebhook` only needs accurate mapping — ordering is handled. SES is the exception on secret semantics: its `EMAIL_WEBHOOK_SECRET` is the SNS TopicArn and webhooks fail closed when unset (see `.env.example`).

## Database

`EmailLog` only (`libraries/nestjs-libraries/src/database/prisma/schema.prisma:1906`): `provider`, `toAddress`, `fromAddress`, `subject`, `replyTo?`, `providerMessageId?`, `status` (default `queued`), `error?`, `organizationId?`, `sentAt`, `deliveredAt?`; indexed on `(provider, providerMessageId)`, `sentAt`, `status`. Access goes through `EmailLogService` / `EmailLogRepository` (`libraries/nestjs-libraries/src/database/prisma/emails/`). A new provider needs **no schema change** — `provider` is a free-form string.

## Package layout (copy `libraries/providers/resend`)

```
libraries/providers/<id>/
  package.json          # name @postmill-ai/provider-<id>, main/types src/index.ts,
                        # deps: @postmill-ai/provider-kernel workspace:* + vendor SDK; script: test → vitest run
  src/index.ts          # default-exports ProviderModule[] (all versions)
  src/v1/index.ts       # re-export the module
  src/v1/metadata.ts    # ProviderMetadata (id, displayName, kind "action", hasModelList false)
  src/v1/email.adapter.ts
  src/v1/__tests__/
```

`email.adapter.ts` ends with the module export (from resend):

```ts
export const resendEmailModule: ProviderModule<any, any> = {
  metadata: providerMetadata,
  manifest: {
    domain: 'email',
    providerId: _meta.name,   // 'resend'
    version: 'v1',
    displayName: _meta.name,
    status: 'active',
    credentialFields: [],     // always empty — env-configured domain
    capabilities: _meta.capabilities,
  },
  create: () => new ResendAdapter(),
};
```

The kernel registers by `manifest.domain`/`providerId`/`version`. Note: existing email providers all carry `"domains": ["media"]` in `metadata.ts` — a repo-wide quirk; copy it as-is, the catalog `metadata` is not what routes email resolution.

## Universal steps vs. overview.md

From the universal provider-add flow in `agents/providers/overview.md`, these **apply**: create the workspace package, implement the capability interface, export a `ProviderModule` with `status: 'active'`, add `@postmill-ai/provider-<id>` to `apps/backend/package.json`, add the import + spread to `providerModules` in `apps/backend/src/providers.generated.ts` (committed file, alphabetical, no generator script), write adapter + conformance tests, run `pnpm install`.

These **do not apply** to email: per-org `credentialFields` / `OrgProviderConfiguration` rows, encryption of stored credentials, catalog/Settings UI, frontend work of any kind, new REST controllers or DTOs (the webhook route is shared), Prisma schema changes.

Operational step unique to email: document the adapter in the `.env.example` email block (`EMAIL_PROVIDER` list, any provider-specific `EMAIL_*` keys) and set `EMAIL_PROVIDER=<id>` (+ `EMAIL_WEBHOOK_SECRET` if webhooks) in deployment env.

## Tests

- Adapter spec: `libraries/providers/resend/src/v1/__tests__/resend.adapter.spec.ts` — mock the vendor SDK (`vi.mock('resend')`, `vi.mock('svix')`), set/clear `EMAIL_*` env in `beforeEach`/`afterEach`, cover name/capabilities, `isConfigured`, `send` param mapping and error propagation, webhook verify/parse.
- Conformance spec: `libraries/providers/resend/src/v1/__tests__/conformance.spec.ts` — `runDomainConformance('email', module, { requiredMethods: ['send', 'isConfigured', 'verifyWebhook', 'parseWebhook'], capabilityKeys: ['webhooks', 'openTracking', 'clickTracking'] })` from `@postmill-ai/provider-kernel` (helper at `libraries/providers/kernel/src/testing/conformance.ts`).
- Registry behavior spec (selection/fallback): `libraries/nestjs-libraries/src/emails/email-adapter.registry.spec.ts`.
- Webhook endpoint spec: `apps/backend/src/api/routes/email-webhooks.controller.spec.ts`.
- Run: `vitest run --root libraries/providers/<id>` (and `vitest run --root libraries/nestjs-libraries` if you touch the registry). See `agents/testing.md`.

## Checklist

1. [ ] Create `libraries/providers/<id>/` package mirroring `resend` (package.json `@postmill-ai/provider-<id>`, `src/index.ts` default module array, `src/v1/{index.ts,metadata.ts,email.adapter.ts}`).
2. [ ] Implement `EmailCapability`: `name`, `capabilities` flags, `requiredEnvKeys` (reuse the shared `EMAIL_*` keys; add provider-specific ones only when unavoidable), `isConfigured()`, `send()` returning `providerMessageId`.
3. [ ] If the provider supports status webhooks, implement `verifyWebhook`/`parseWebhook` (svix or equivalent) and set `capabilities.webhooks: true`; do not add a controller — `POST /webhooks/email` is shared.
4. [ ] Export `ProviderModule` with `manifest.domain: 'email'`, `version: 'v1'`, `credentialFields: []`, `status: 'active'`.
5. [ ] Add `"@postmill-ai/provider-<id>": "workspace:*"` to `apps/backend/package.json` and the import + array spread in `apps/backend/src/providers.generated.ts`; run `pnpm install`.
6. [ ] Update the `.env.example` email block (provider list in the `EMAIL_PROVIDER` comment, any new `EMAIL_*` keys).
7. [ ] Write `src/v1/__tests__/<id>.adapter.spec.ts` and `conformance.spec.ts` (copy resend's patterns); run `vitest run --root libraries/providers/<id>`.
8. [ ] Verify end-to-end selection: `EMAIL_PROVIDER=<id>` + required env set ⇒ `EmailService.hasProvider()` true and sends log to `EmailLog`; unset/unknown ⇒ `empty` fallback, no crash.
9. [ ] Do not touch frontend, per-org credential storage, `NotificationService`, or the Prisma schema — none apply to this domain.
