---
name: add-media-provider
description: Add a media generation provider (image/video/audio generation studio, AI media studio, TTS/STT provider, upscale/bg-remove/inpaint) to the Postmill unified provider framework, with its descriptor-driven studio page. Use when adding a media provider, media studio, text-to-image/text-to-video/TTS/STT adapter, or wiring a new tool under /media.
---

# Add a media provider + studio

Wire a new media provider into the `ProviderKernel` and ship its descriptor-driven studio under `/media/<id>` — the generic backend covers the standard case with no controller work.

## Read first
- `agents/providers/overview.md` — kernel concepts, manifest rules, universal registration recipe.
- `agents/providers/media.md` — full media contract, credential modes, studio-kit, bespoke exceptions.

## Procedure
1. Scaffold `libraries/providers/<id>/` per the universal recipe: `package.json` (`@postmill-ai/provider-<id>`, dep `@postmill-ai/provider-kernel: workspace:*`, script `"test": "vitest run"`), `src/index.ts` default-exporting `ProviderModule[]`, `src/v1/{index.ts, metadata.ts, media.adapter.ts}` (detail: `agents/providers/overview.md` § Package layout).
2. Implement the adapter against `MediaCapability` (`libraries/providers/kernel/src/domains/media.ts`; `MediaProviderAdapter` is an alias at media.ts:154). Required members: `identifier`, `name`, `capabilities` flags, `generateImage` (synchronous contract — near-real-time or bounded internal polling), `generateVideo`/`generateAudio`/`generateAvatar` (async, return `{ jobId }`); optional `pollJob`, `listModels`, `testConnection`, plus extended ops (`textToSpeech`, `speechToText`, `upscaleImage`, `removeBackground`, `inpaintImage`, …). Reference: `libraries/providers/qwen/src/v1/media.adapter.ts`.
3. Pick a base adapter from `libraries/providers/kernel/src/domains/media-helpers.ts`: `BearerTokenMediaAdapter` (plain Bearer key), `OpenAiCompatibleMediaAdapter` (OpenAI-style hub: full image/audio/listModels/testConnection), or `AiSdkMediaAdapter` (non-trivial auth, delegates image to the matching AI adapter). Constructor receives `SafeFetchPort` — all outbound HTTP goes through `safeFetch`.
4. Honor the guardrails (`kernel/src/domains/media-guards.ts`): 429/5xx on a poll is transient → **throw**; `{status:'failed'}` is terminal; run provider error bodies through `redactError`, model ids in request paths through `validateModelId`, response bodies through `readCappedArrayBuffer`. Keep `testConnection` free (never bill a render).
5. Author the module: `manifest` with `domain: 'media'`, `providerId`, `version: 'v1'`, `status: 'active'` (`preview` for semver-prerelease), `credentialFields`, `capabilities`; plus `metadata.ts` (`ProviderMetadata` — `id` must equal `manifest.providerId`; the registry script generates `mediaModels`/categories into it, step 9). Export shape follows `qwenMediaModule`: `create: (rt) => new MyMediaAdapter(rt.fetch)` — keep `create()` network-free (conformance-tested).
6. Register with 3 hand edits (alphabetical): import + spread in `apps/backend/src/providers.generated.ts`, two path aliases in `tsconfig.base.json`, `workspace:*` dep in `apps/backend/package.json`; then `pnpm install`. Boot registration is automatic via `ProvidersBootstrap`.
7. Choose the credential mode (detail: `agents/providers/media.md` § Credential modes):
   - Own key (default): omit `credentialFields` — Settings → Media renders a single API Key field (`DEFAULT_CREDENTIAL_FIELDS` in `apps/frontend/src/components/settings/shared/kit/descriptors/media.descriptor.ts`).
   - Multi-field: set `credentialFields: MediaCredentialField[]`; read values from `options.credentials[key]` (`resolveApiKey`, media.ts:58, tolerates `apiKey`/`credentials.apiKey`/`.key`/`.token`).
   - Universal AI-key fallback: add the identifier to the hardcoded `UNIVERSAL_AI_CREDENTIAL` set in `libraries/nestjs-libraries/src/database/prisma/media-providers/org-media-provider-settings.service.ts:23`. This set is the working mechanism — the manifest's `universalCredentialFrom` field has no runtime consumer.
8. Build the studio frontend (required to expose a studio):
   - `apps/frontend/src/components/media-tools/<id>/descriptor.ts` — `export const <id>Descriptor: StudioDescriptor` with `provider` (must equal adapter `identifier`), `title`, `tabs[]`, optional `landing` block (types in `media-tools/studio-kit/types.ts`).
   - `apps/frontend/src/components/media-tools/<id>/<id>-studio.tsx` — `'use client'`; render `<StudioShell descriptor={…} />` from `studio-kit/studio-shell.tsx`.
   - `apps/frontend/src/app/(app)/(site)/media/<id>/page.tsx` — `dynamic(…, { ssr: false })` wrapper.
   - Nav entry `{ href: '/media/<id>', label, section: 'Providers', icon }` in `apps/frontend/src/app/(app)/(site)/media/layout.tsx`.
   Tab shape: `{ key, label, operation: 'image'|'video'|'audio', model?, fields: StudioField[] }`; field types `prompt`, `media`, `select` (a `select` named `model` with `source: 'models'` enables dynamic discovery via `listModels`), `number`, `toggle`, `text`. Field `name`s are the provider's native API params — the adapter routes them. Backend: **none** — `MediaStudioController` (`apps/backend/src/api/routes/media-studio.controller.ts`, `/media/studio/:provider/{status,jobs,models,generate}`) and `MediaStudioService` (`libraries/nestjs-libraries/src/media/studio/media-studio.service.ts`) are provider-agnostic; async completion comes from webhooks with the Inngest `media-jobs-poll` cron as backstop.
9. **CRITICAL**: run `node scripts/generate-studio-descriptor-registry.mjs` (write mode) to merge descriptor data (`mediaModels`, `website`, `description.en`, categories) into the package's `src/v1/metadata.ts`; commit the result. `.github/workflows/test.yml` runs `--check` ("Studio descriptor metadata drift gate") and fails the build on drift.
10. No DB schema change: per-org config rows land in `MediaProviderConfig` (`@@unique([organizationId, identifier, version])`, encrypted `credentials`, one `isActive` Primary per org), jobs in `AIMediaJob` (`provider`, `operation`, `status`, `artifactUrl`, `costUsd`, redacted `error`) — both in `libraries/nestjs-libraries/src/database/prisma/schema.prisma`. Access only via `OrgMediaProviderSettingsRepository`/`OrgMediaProviderSettingsService` — never Prisma from a controller.
11. Bespoke escape hatch only when the descriptor form can't express the UX (non-artifact output, structured multi-step UX, schema-dynamic catalogs): Deepgram, HeyGen, Replicate, Designer are the existing exceptions with custom backend (detail: `agents/providers/media.md` § Bespoke-studio exceptions).
12. Wrap-up:
    - (Optional) `ICONS` entry in `apps/frontend/src/components/shared/provider-icon.tsx`, keyed by provider identifier.
    - Add a recorded-fixture `media.int-spec.ts` using `makeCtx`/`res` from `@postmill-ai/provider-kernel/testing/media-int-helpers`: assert endpoint URL, headers, body shape, poll parsing, transient-throw vs terminal-failed, unsupported-op rejection (pattern: `libraries/providers/qwen/src/v1/media.int-spec.ts`).
    - Add a row to `libraries/providers/PROVIDERS_INVENTORY.md` and bump its header counts (maintained by hand).
    - If built without a live key, add `media/<id>` to `BETA_PROVIDER_KEYS` in `libraries/providers/kernel/src/verification.ts`; remove after a live smoke test.

## Verify
- `vitest run --root libraries/providers/<id>` — package specs.
- `vitest run --root libraries/providers` — kernel conformance + metadata specs (pure `create()`, all required methods).
- `node scripts/generate-studio-descriptor-registry.mjs --check` — no descriptor/metadata drift.
- In-app: provider appears under Settings → Media, `testConnection` passes, a generation lands an `AIMediaJob` and completes (webhook or `media-jobs-poll` cron backstop).

## Pitfalls
- Forgetting `scripts/generate-studio-descriptor-registry.mjs` after adding/changing a descriptor — CI's `--check` gate fails the build on metadata drift.
- Building a new backend controller/service for a standard studio — the generic `MediaStudioController`/`MediaStudioService` already route `/media/studio/:provider/*`; bespoke backend is for the four documented exceptions only.
- Setting the manifest's `universalCredentialFrom` field and expecting runtime behavior — nothing consumes it; the `UNIVERSAL_AI_CREDENTIAL` hardcoded set is the working fallback mechanism.
- Making `generateImage` return a job id — the contract is synchronous; task-based APIs must do bounded internal polling (see `QwenMediaAdapter`).
- Returning `{status:'failed'}` on a 429/5xx poll response — transient errors must **throw** so the lifecycle retries; a returned failure is terminal and burns the job.
- Making `testConnection` do a real render — it must be cheap/free; adapters bill per generation.
