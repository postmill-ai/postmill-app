# Adding a media-generation provider + studio

Wire a new media provider (image / video / audio / avatar / TTS / STT / upscale / bg-remove / inpaint) into the unified provider framework and, when wanted, ship a user-facing studio under `/media/<id>`. The generic `MediaStudioController` / `MediaStudioService` plus the descriptor-driven studio-kit cover the standard case end-to-end — most providers need no backend controller work.

See `agents/providers/overview.md` for kernel concepts (manifest, `ProviderModule`, resolution via `ProviderResolutionService`, version lifecycle).

## 1. Contract: `MediaCapability`

Defined in `libraries/providers/kernel/src/domains/media.ts`. `MediaProviderAdapter` is a legacy type alias for `MediaCapability` (media.ts:154) — same shape.

Required members:

| Member | Shape | Notes |
|---|---|---|
| `identifier` | `string` | Routing id, matches `metadata.id` and the studio descriptor's `provider` |
| `name` | `string` | Display name |
| `capabilities` | `MediaProviderCapabilities` | Boolean flags: `image`, `video`, `audio`, `avatar`, `tts`, `stt`, `upscale`, `bgRemove`, `inpaint` (+ optional `videoBg`, `videoUpscale`, `videoToVideo`) |
| `credentialFields?` | `MediaCredentialField[]` | Multi-field creds (`{key,label,type:'string'\|'password'\|'textarea',required,placeholder?,help?}`); omit for single-API-key providers |
| `generateImage(prompt, options?)` | `Promise<MediaGenerationResult>` | **Synchronous** contract — near-real-time or fail. Async providers do bounded internal polling (see `QwenMediaAdapter.generateImage`) |
| `generateVideo / generateAudio / generateAvatar(prompt, options?)` | `Promise<MediaJobSubmission>` | Async: return `{ jobId }`; throw "does not support" for unsupported ops |
| `pollJob?(jobId, options?)` | `Promise<MediaPollResult>` | `{status:'pending'\|'completed'\|'failed', artifactUrl?, extraArtifactUrls?, error?}` |
| `listModels?(operation, options?)` | `Promise<MediaModelOption[]>` | Feeds the studio's dynamic model dropdown (`operation: 'image'\|'video'\|'audio'`) |
| `testConnection?(options?)` | `Promise<{ok,message}>` | Must be cheap/free — never bill a render for an auth check |

Optional extended ops: `textToSpeech`, `speechToText`, `speechToTextWords`, `upscaleImage`, `removeBackground`, `inpaintImage`, `listVoices`, `upscaleVideo`, `removeVideoBackground`.

Key option/result types: `MediaGenerateOptions extends MediaCredentialOptions` (adds `model`, `size`, `n`, `durationSeconds`, `input: Record<string, MediaInputValue>` — the flat descriptor params), `MediaGenerationResult` (`{multi, image?, images?, metadata?}`), `MediaPollResult.extraArtifactUrls` (multi-clip jobs like Suno land each extra as a sibling job).

Poll semantics (enforced across adapters, see `libraries/providers/kernel/src/domains/media-guards.ts`):
- 429/5xx on a status poll is **transient** → **throw** (`isTransientStatus`); the lifecycle retries. A returned `{status:'failed'}` is terminal.
- Persist provider error bodies through `redactError(body)` — it truncates to 500 chars and strips signed-URL token params before they reach `AIMediaJob.error` or the client.
- Model ids interpolated into request paths must pass `validateModelId(model)` (allowlist regex, blocks `..`/query/fragment injection).
- Reading provider response bodies into memory: `readCappedArrayBuffer(res, maxBytes)`.

Missing-key on poll → return terminal `{status:'failed', error}` (a config error must not retry to the 24h timeout).

## 2. Base adapters (`kernel/src/domains/media-helpers.ts`)

| Base | Use when | Provides |
|---|---|---|
| `BearerTokenMediaAdapter` | Plain `Authorization: Bearer <key>` single-key API (DeepInfra, LTX, Leonardo, Recraft, Fireworks, …) | `_key()`, `_headers()`, `_clean()`; the four `generate*` stay abstract |
| `OpenAiCompatibleMediaAdapter` | Hub with an OpenAI-compatible surface (`POST {base}/images/generations`, `/audio/speech`, `/models`) | Full `generateImage`/`generateAudio`/`listModels`/`testConnection`; subclass sets `baseUrl`, defaults; override `generateVideo`+`pollJob` for bespoke async video |
| `AiSdkMediaAdapter` | Hub whose auth is non-trivial (AWS SigV4 Bedrock, Azure deployment URLs, Vercel gateway) | Delegates image generation to the matching **AI** adapter (same `identifier`) via `setAiRegistry`; image only |

Also exported: `pollMediaJob<T>({fetch, url, headers, attempts, intervalMs, parse})` — the shared submit-and-poll loop. Constructor always receives `SafeFetchPort` (all outbound HTTP goes through `safeFetch`; see `agents/security.md`).

Reference implementation: `libraries/providers/qwen/src/v1/media.adapter.ts` (`QwenMediaAdapter`) — async task API, bounded internal polling for image, submit+poll for video.

## 3. Package shape & registration

Workspace package `libraries/providers/<id>` (name `@postmill-ai/provider-<id>`, dep `@postmill-ai/provider-kernel: workspace:*`, script `"test": "vitest run"`):

```
src/v1/metadata.ts        # ProviderMetadata (id, kind, domains, mediaCategories, mediaModels — generated, §5)
src/v1/media.adapter.ts   # adapter class + exported ProviderModule
src/v1/index.ts           # re-export the media module (and ai module if dual-domain)
src/index.ts              # default-export ProviderModule[] array
```

Module export shape (from `qwenMediaModule`):

```ts
export const myMediaModule: ProviderModule<any, any> = {
  metadata: providerMetadata,
  manifest: {
    domain: 'media', providerId: _meta.identifier, version: 'v1',
    displayName: _meta.name, status: 'active',
    credentialFields: (_meta as any).credentialFields || [],
    capabilities: (_meta as any).capabilities,
  },
  create: (rt) => new MyMediaAdapter(rt.fetch),
};
```

Registration (all three, alphabetical order):
- `apps/backend/src/providers.generated.ts` — import + spread (hand-maintained despite the name).
- `tsconfig.base.json` — `paths` entry for `@postmill-ai/provider-<id>`.
- `apps/backend/package.json` — `workspace:*` dependency.

Boot path: `ProvidersBootstrap` (`apps/backend/src/providers.bootstrap.ts`) registers the modules into the `ProviderKernel`.

## 4. Credential modes

| Mode | Mechanism |
|---|---|
| Own key (default) | Per-org row in `MediaProviderConfig`; user enters one API key at Settings → Media. Omit `credentialFields` — the settings surface falls back to a single `API Key` password field (`DEFAULT_CREDENTIAL_FIELDS` in `apps/frontend/src/components/settings/shared/kit/descriptors/media.descriptor.ts`) |
| Multi-field | Set `credentialFields` on the adapter (`MediaCredentialField[]`, e.g. Vertex project + location + service-account JSON); the modal renders them dynamically. Adapters read values from `options.credentials[key]` |
| Universal AI-key fallback | Provider shares one key with its LLM provider (Qwen on DashScope, hub providers). Add the identifier to the hardcoded `UNIVERSAL_AI_CREDENTIAL` set in `libraries/nestjs-libraries/src/database/prisma/media-providers/org-media-provider-settings.service.ts:23` — with no media row the org's AI key counts as configured/enabled. An explicit row's `enabled:false` always wins |

Key resolution inside adapters: `resolveApiKey(options)` (media.ts:58) tolerates `apiKey` / `credentials.apiKey` / `credentials.key` / `credentials.token`.

Note: the kernel `ProviderManifest` type has an optional `universalCredentialFrom?: string` field (`kernel/src/manifest.ts:31`), set only by OpenAI (`libraries/providers/openai/src/v1/media.manifest.ts:25`). Nothing in nestjs-libraries consumes it — the runtime fallback is the `UNIVERSAL_AI_CREDENTIAL` set above (OpenAI additionally write-mirrors credentials via `ProviderCredentialLinkService`). For a new shared-key provider, the set is the mechanism that works today.

## 5. Studio frontend (required to expose a studio)

All under `apps/frontend/src/components/media-tools/<id>/`:

| File | Content |
|---|---|
| `descriptor.ts` | `export const <id>Descriptor: StudioDescriptor` — `provider` (must equal adapter `identifier`), `title`, `tabs[]`, optional `landing` (`website`, `tagline`, `description`, `badges`, `highlights`, optional `icon` override). Types: `studio-kit/types.ts` |
| `<id>-studio.tsx` | `'use client'`; `return <StudioShell descriptor={...} />` (`studio-kit/studio-shell.tsx`) |
| `apps/frontend/src/app/(app)/(site)/media/<id>/page.tsx` | `dynamic(..., { ssr: false })` wrapper rendering the studio component |
| nav entry | `apps/frontend/src/app/(app)/(site)/media/layout.tsx` — `{ href: '/media/<id>', label, section: 'Providers', icon: <svg …/> }` |

Tab shape (`StudioTab`): `{ key, label, operation: 'image'|'video'|'audio', model?, fields: StudioField[], custom? }`. Field types: `prompt`, `media` (file picker → `FileFieldValue`), `select` (a `select` named `model` + `source: 'models'` gives dynamic discovery via `listModels`), `number`, `toggle`, `text`. Field `name`s are the provider's **native** API params — the adapter routes them (Qwen splits `input` vs `parameters`). Category keys follow the taxonomy in `scripts/generate-studio-descriptor-registry.mjs` (`text-to-image`, `text-to-video`, `image-to-video`, `text-to-speech`, `text-to-music`, …).

Backend for the generic path: **none**. `MediaStudioController` (`apps/backend/src/api/routes/media-studio.controller.ts`, `/media/studio/:provider/{status,jobs,models,generate}`) + `MediaStudioService` (`libraries/nestjs-libraries/src/media/studio/media-studio.service.ts`) are provider-agnostic; async completion comes from webhooks first with the Inngest `media-jobs-poll` cron as backstop. Settings UI (`/settings/media/providers` + `/settings/media/config`, `MediaProviderController`) is catalog-driven from kernel manifests — no new settings code.

### CI gate (do not skip)

`scripts/generate-studio-descriptor-registry.mjs` reads every `media-tools/*/descriptor.ts` and merges generated `mediaModels`, `website`, `description.en`, and reconciled `mediaCategories`/`kind` into the provider package's `src/v1/metadata.ts`. `.github/workflows/test.yml` runs it with `--check` ("Studio descriptor metadata drift gate") and **fails the build on drift**. After adding/changing a descriptor, run write mode and commit the result:

```bash
node scripts/generate-studio-descriptor-registry.mjs          # write mode
node scripts/generate-studio-descriptor-registry.mjs --check  # verify no drift
```

Descriptor caveats: a descriptor that imports runtime values (custom panels) is skipped by the generator; orchestration categories (`image-focal-point`, `image-slide`, `video-caption`) declared in `metadata.ts` are preserved; live-`listModels` hubs and action-only providers are special-cased in the script's constant sets.

## 6. Bespoke-studio exceptions

Escape hatch only when the generic form can't express the UX:

| Studio | Why bespoke |
|---|---|
| Deepgram | STT returns text, not a media artifact — descriptor tab uses `custom: DeepgramPanel` calling the dedicated `apps/backend/src/api/routes/deepgram.controller.ts` + `libraries/nestjs-libraries/src/media/deepgram/deepgram.service.ts` |
| HeyGen | Structured avatar tools (avatar/voice pickers, storyboard, translate) — no descriptor; `media-tools/heygen/*` + backend `libraries/nestjs-libraries/src/media/heygen/` |
| Replicate | Schema-driven dynamic model catalog + editors (inpaint mask, merge) — `media-tools/replicate/*` + backend `libraries/nestjs-libraries/src/media/replicate-studio/`; no descriptor (snapshot-backed `mediaModels` committed in `metadata.ts`) |
| Designer | Not a provider at all — the Konva canvas studio (`media-tools/designer/`) |

Rule: prefer the descriptor path; go bespoke only for non-artifact outputs, structured multi-step UX, or schema-dynamic catalogs.

## 7. Database

`libraries/nestjs-libraries/src/database/prisma/schema.prisma`:
- `MediaProviderConfig` (schema.prisma:1406) — per-org config: `identifier`, `version` (default `"v1"`), `enabled`, `isActive` (one Primary per org), encrypted `credentials`, `storageProviderId`/`storageRootFolderId` (artifact landing target), `@@unique([organizationId, identifier, version])`.
- `AIMediaJob` (schema.prisma:1531) — generation job ledger: `provider`, `operation`, `status`, `artifactUrl`, `model`, `version` pin, `costUsd`, `inputJson`, `error` (redacted — §1).

No schema change is needed to add a provider. Access goes through `OrgMediaProviderSettingsRepository` / `OrgMediaProviderSettingsService`; never call Prisma from a controller (see `agents/backend.md`, `agents/database.md`).

## 8. Optional: provider icon

Add an entry to the `ICONS` map in `apps/frontend/src/components/shared/provider-icon.tsx` (`{ viewBox, color, node }` or `{ src }`) keyed by the provider identifier — used by settings surfaces and studio landings.

## 9. Free stock providers — outside versioning

Unsplash, Pexels, Pixabay, GIPHY, Jamendo, Iconify are intentionally **not** versioned provider packages: no stored config row, served by `libraries/nestjs-libraries/src/media/stock/stock-media.service.ts` and the `stock-*.tsx` browsers in `media-tools/`. Do not build them as kernel providers. For premium content packs see `agents/providers/contentpack.md`.

## 10. Universal steps

Package scaffolding, manifest validation rules (`validateManifest` — no `/`/`@`/whitespace in ids, prerelease ⇒ `preview` status), version lifecycle, and kernel registration semantics are shared across all domains — follow `agents/providers/overview.md`.

## 11. Tests

Per-package Vitest. Recorded-fixture integration spec pattern: `libraries/providers/qwen/src/v1/media.int-spec.ts` uses `makeCtx`/`res` from `@postmill-ai/provider-kernel/testing/media-int-helpers` — assert endpoint URL, headers, request body shape, poll parsing (pending/completed/failed), transient-throw vs terminal-failed, and unsupported-op rejection. Run:

```bash
vitest run --root libraries/providers/<id>
```

## Checklist

1. [ ] Create `libraries/providers/<id>/` package (`package.json`, `src/index.ts`, `src/v1/index.ts`, `src/v1/metadata.ts`, `src/v1/media.adapter.ts`) exporting a `ProviderModule` with `domain: 'media'`, `version: 'v1'`, `status: 'active'`.
2. [ ] Implement the adapter against `MediaCapability` — pick `BearerTokenMediaAdapter`, `OpenAiCompatibleMediaAdapter`, or `AiSdkMediaAdapter`; keep `generateImage` synchronous (bounded internal poll if the API is task-based); implement `pollJob` with transient-throw/terminal-return semantics; run errors through `redactError` and model ids through `validateModelId`; make `testConnection` free.
3. [ ] Register the package in `apps/backend/src/providers.generated.ts` (alphabetical), `tsconfig.base.json` paths, and `apps/backend/package.json`.
4. [ ] Choose the credential mode: nothing for single-key, `credentialFields` for multi-field, or add the identifier to `UNIVERSAL_AI_CREDENTIAL` in `org-media-provider-settings.service.ts` for a shared AI key.
5. [ ] Add the studio: `apps/frontend/src/components/media-tools/<id>/descriptor.ts` + `<id>-studio.tsx`, the page at `apps/frontend/src/app/(app)/(site)/media/<id>/page.tsx`, and a `Providers`-section nav entry in `apps/frontend/src/app/(app)/(site)/media/layout.tsx`.
6. [ ] Run `node scripts/generate-studio-descriptor-registry.mjs` (write mode), commit the regenerated `src/v1/metadata.ts`, and confirm `--check` passes.
7. [ ] (Optional) Add an `ICONS` entry in `apps/frontend/src/components/shared/provider-icon.tsx`.
8. [ ] Write a `media.int-spec.ts` recorded-fixture spec and run `vitest run --root libraries/providers/<id>`.
9. [ ] Verify in the app: provider appears under Settings → Media, `testConnection` passes, a generation lands an `AIMediaJob` and completes (webhook or `media-jobs-poll` backstop).
