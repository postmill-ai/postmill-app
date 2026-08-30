# Adding an AI/LLM provider

Covers adding a provider to the `ai` domain: the `AiCapability` contract, the two implementation paths (bespoke vs `OpenAICompatibleAdapter`), credential/storage invariants, and registration. Generic provider-kernel mechanics (package layout, manifest, lifecycle, catalog) live in `agents/providers/overview.md`; this doc only covers what is AI-specific.

## The `AiCapability` contract

Defined in `libraries/providers/kernel/src/domains/ai.ts`, re-exported from `@postmill-ai/provider-kernel`. Model types are AI SDK v5 (`@ai-sdk/provider-v5`) aliases:

| Export | Type | Notes |
|---|---|---|
| `LanguageModel` | `LanguageModelV2` | text/chat model |
| `ImageModel` | `ImageModelV2` | |
| `EmbeddingModel` | `EmbeddingModelV2<string>` | |
| `SpeechModel` | `SpeechModelV2` | |
| `AiCapabilities` | `{ text, image, vision, embeddings, speech, tools: boolean }` | all six required |
| `AiModelInfo` | `{ id, label, kind: 'text'\|'image'\|'embedding', dimension?, capabilities, reasoning? }` | one catalog entry |
| `AiCredentialField` | `{ key, label, type: 'string'\|'password'\|'textarea'\|'select', required, options?, placeholder? }` | drives the Settings form |
| `AiModelOptions` | `{ temperature?, topP?, maxTokens? }` | |
| `AiScope` | `'utility' \| 'generator' \| 'agent' \| 'mcp'` | see Surfaces below |
| `AiProviderType` | `'hub' \| 'direct'` | |

Required members of `AiCapability` (enforced by the kernel conformance gate, `libraries/providers/kernel/src/testing/conformance.ts` → `REQUIRED_METHODS.ai`):

- readonly props: `identifier`, `name`, `type`, `credentialFields`, `capabilities` (optional: `privacy`, `health`)
- `listModels(creds): Promise<AiModelInfo[]>`
- `validateCredentials(creds): Promise<{ ok: boolean; error?: string }>`
- `createLanguageModel(creds, modelId, opts?): LanguageModel`
- `createLangchainModel(creds, modelId, opts?): BaseChatModel` (`@langchain/core`)

Optional members: `createImageModel`, `createEmbeddingModel`, `createSpeechModel` — each `(creds, modelId) => Model | undefined`.

**No kernel wrapper class.** The `ProviderModule.create(ctx)` (`kernel/src/module.ts`, `ProviderRuntimeContext.fetch: SafeFetchPort`) injects the SSRF-safe fetch into a module-level adapter singleton and returns it directly — the exact shape in every AI adapter:

```ts
create: (ctx) => {
  adapter.setSafeFetch(ctx.fetch);
  return adapter as any;
},
validateCredentials: async (ctx) => {
  adapter.setSafeFetch(ctx.fetch);
  return adapter.validateCredentials(ctx.credentials);
},
```

`create()` must be pure (no network I/O at construction) — `runDomainConformance` swaps in a throwing fetch to prove it.

## Fast path: `OpenAICompatibleAdapter`

14 of the 30 AI providers are thin instantiations of the shared base class in `libraries/providers/kernel/src/domains/ai-helpers.ts` — no bespoke class needed: `siliconflow`, `deepinfra`, `minimax`, `qwen`, `meta-llama`, `gmihub`, `bitdeer`, `lightning`, `vultr`, `kimi`, `zai`, `apertus`, `nvidia`, `openai-compatible`. (The stale comment on the class says "nine"; the code has 14.)

Constructor signature (`ai-helpers.ts`):

```ts
new OpenAICompatibleAdapter(
  identifier: string,
  name: string,
  baseURL: string,                    // canonical endpoint; '' for endpoint-bringing providers
  capabilities?: Partial<AiCapabilities>, // text:true, tools:true always default on
  models?: AiModelInfo[],             // static fallback catalog
  type: AiProviderType = 'hub',
  opts?: { requireBaseURL?: boolean },
)
```

Behavior you get for free:

- Inference via `createOpenAI` (`@ai-sdk/openai`) and `ChatOpenAI` (`@langchain/openai`); clients are cached in `BoundedProviderCache` (bounded LRU, default cap 256) keyed by `apiKey||baseURL`.
- `credentialFields` = `apiKey` (password, required) + `baseURL` (string, required only when `requireBaseURL`).
- `listModels` is live-first: `fetchOpenAIStyleModels(safeFetch, baseURL, apiKey)` GETs `{baseURL}/models` (Bearer auth, never throws, returns `null` on any failure) and `mergeLiveModels(live, staticModels, capabilities)` merges — live decides which ids exist, static wins on curated metadata for known ids, live-only ids are classified by `heuristicModelInfo` (id-substring heuristics for embedding/image/speech kinds).
- `validateCredentials` runs over the injected `safeFetch` only: missing `_safeFetch` ⇒ `{ ok: false, error: 'cannot validate' }`; SSRF `Blocked URL` errors are re-thrown (caller maps to 400); transport errors become `{ ok: false, error: 'Could not reach the Base URL (...)' }`; 401/403 ⇒ `Invalid API key`.
- Tenant-supplied `baseURL` (≠ canonical default) routes all inference through the SSRF-safe fetch with a 300s ceiling; without an injected safeFetch it throws rather than falling back to the global fetch. `requireBaseURL: true` also refuses to default to `api.openai.com`.

Minimal package shape (from `libraries/providers/openai-compatible/src`):

```
libraries/providers/<id>/
├── package.json          # @postmill-ai/provider-<id>, dep: @postmill-ai/provider-kernel: workspace:*
├── src/
│   ├── index.ts          # import { <id>AiModule } from './v1'; export default [<id>AiModule];
│   └── v1/
│       ├── index.ts      # export { <id>AiModule } from './ai.adapter';
│       ├── ai.adapter.ts # new OpenAICompatibleAdapter(...) + ProviderModule
│       └── metadata.ts   # ProviderMetadata
```

```ts
// src/v1/ai.adapter.ts
import { OpenAICompatibleAdapter, type ProviderModule } from '@postmill-ai/provider-kernel';
import { metadata as providerMetadata } from './metadata';

const adapter = new OpenAICompatibleAdapter(
  'yourprovider', 'Your Provider', 'https://api.yourprovider.com/v1',
  { vision: true }, undefined, 'hub',
);

export const yourproviderAiModule: ProviderModule<any, any> = {
  metadata: providerMetadata,
  manifest: {
    domain: 'ai', providerId: adapter.identifier, version: 'v1',
    displayName: adapter.name, status: 'active',
    credentialFields: (adapter as any).credentialFields || [],
    capabilities: (adapter as any).capabilities,
  },
  create: (ctx) => { adapter.setSafeFetch(ctx.fetch); return adapter as any; },
  validateCredentials: async (ctx) => {
    adapter.setSafeFetch(ctx.fetch);
    return adapter.validateCredentials(ctx.credentials);
  },
};
```

Use the fast path whenever the provider speaks the OpenAI Chat Completions API. Use bespoke only when it has its own `@ai-sdk/*` package or a non-compatible API.

## Bespoke path

Model on `libraries/providers/openai/src/v1/ai.adapter.ts` (`OpenAIAdapter`). Same `ProviderModule` shell as above, but the class implements `AiCapability` itself:

- Declare `CAPABILITIES`, `CREDENTIAL_FIELDS`, and a static `MODELS` catalog (`AiModelInfo[]` with per-model capability overrides and `reasoning`/`dimension` flags). OpenAI's catalog shows the per-model override idiom (`{ ...OPENAI_CAPABILITIES, image: false, embeddings: false, speech: false }`).
- Keep the `_safeFetch?: SafeFetchPort` + `setSafeFetch()` pattern; `listModels` should still be live-first via `fetchOpenAIStyleModels` + `mergeLiveModels` where the API is OpenAI-style.
- Build models from the provider's own SDK (`createXai`, `createAnthropic`, …). Watch SDK defaults: `OpenAIAdapter.createLanguageModel` deliberately returns `provider.chat(modelId)` (Chat Completions) instead of `.languageModel()` because `@ai-sdk/openai` v2 defaults to the Responses API, which rejects the `{ type: 'text' }` message parts `AIModelProvider` builds.
- Implement `createLangchainModel` with the matching `@langchain/*` chat class; pass `opts.temperature/topP/maxTokens` through.

## Surfaces (scopes)

`AiScope = 'utility' | 'generator' | 'agent' | 'mcp'` (`kernel/src/domains/ai.ts`). When the org's config row has no explicit model, resolution falls back to `SURFACE_DEFAULTS` in `libraries/nestjs-libraries/src/ai/ai-model.provider.ts`:

| Scope | `textModel` | `imageModel` | extra |
|---|---|---|---|
| `utility` | `gpt-4.1` | `chatgpt-image-latest` | |
| `generator` | `gpt-4.1` | `chatgpt-image-latest` | `temperature: 0.7` |
| `agent` | `gpt-5.2` | — | |
| `mcp` | `gpt-4.1` | — | |

Adding a scope means updating `SURFACE_DEFAULTS` and every exhaustive `AiScope` switch (comment at `ai.ts` line 56). Resolution itself (`AIModelProvider._resolveConfig`) is org-first: active `AIOrgProviderConfig` → `OrgDefaultModel` category defaults → `SURFACE_DEFAULTS`.

## Credentials & security invariants

- **Per-org storage only:** `AIOrgProviderConfig` (schema `libraries/nestjs-libraries/src/database/prisma/schema.prisma`, `@@unique([organizationId, identifier, version])`, `isActive` singleton per org). `credentials` is encrypted at rest via `EncryptionService` (AES-GCM, `v2:` prefix); the adapter receives decrypted creds through the runtime context and must never persist or log them.
- **No global AI config table.** The legacy global `AIProviderConfig` table was dropped in v1.0.0 — per-org `AIOrgProviderConfig` is the only store. `OrgDefaultModel` stores per-org per-category default models (non-secret).
- **No env-key fallback.** The env `OPENAI_API_KEY` fallback was removed (`ai-model.provider.ts` line ~242). No active provider for an org ⇒ AI is off for that org on all four surfaces. Never reintroduce one; AI providers are BYOK.
- All credential validation and tenant-URL traffic goes through the injected `SafeFetchPort`; never call the global `fetch` against a tenant-supplied URL (see `agents/security.md`).

## baseURL-bringing providers

Two gates, both required:

1. **Frontend allowlist:** `BASE_URL_PROVIDERS` in `apps/frontend/src/components/settings/shared/kit/descriptors/ai.descriptor.ts` (currently only `'openai-compatible'`). The Settings → AI form filters the `baseURL` credential field out for any provider not in the set (`credentialFieldsFromMeta` / `filterCredentialFields`). Add your id there if the provider has no canonical endpoint.
2. **Backend SSRF check:** `OrgAiSettingsService._assertBaseURLSafe` (`libraries/nestjs-libraries/src/database/prisma/ai-settings/org-ai-settings.service.ts`) runs on save and on `testConnection`, rejecting private/loopback/non-HTTPS base URLs with 400.

Pair with `{ requireBaseURL: true }` on `OpenAICompatibleAdapter` so the adapter never silently defaults to `api.openai.com` with the org's key.

## Frontend icon (optional)

Add an entry to `ICONS` (and `LABEL_MAP`/brand-color map) in `apps/frontend/src/components/shared/provider-icon.tsx`, keyed by provider identifier. Omitting it is safe: the component falls back to a two-letter tile derived from the name (`provider-icon.tsx` line ~219).

## Universal steps (compressed)

Detail in `agents/providers/overview.md`; the AI-specific deltas:

1. Create the workspace package `libraries/providers/<id>/` (shape above); `pnpm-workspace.yaml` glob already covers it.
2. Author `src/v1/metadata.ts` (`ProviderMetadata`, `kernel/src/domains/metadata.ts`): `id`, `displayName`, `kind` (`'direct'` single-brand / `'hub'` aggregator / `'action'` no model list), `domains: ['ai']`, `modelCategories` (subset of the known AI model categories, e.g. `'low-reasoning'`, `'high-reasoning'`, `'workflow'`, `'vision'`), `hasModelList: true`, `modelHints` per category, `website`, `description.en`. `kernel.metadata.spec.ts` validates every registered module's metadata.
3. Registration edits: `"@postmill-ai/provider-<id>": "workspace:*"` in `apps/backend/package.json` (+ `pnpm install`); two path aliases in `tsconfig.base.json`; import + `...<id>Modules` spread in `apps/backend/src/providers.generated.ts` (`providerModules` — the kernel's `all-providers.conformance.spec.ts` and `kernel.metadata.spec.ts` import this array directly, so an unregistered module skips the global gates). The kernel `vitest.config.ts` builds provider aliases by directory scan — no edit needed there.
4. Add a package conformance spec (`libraries/providers/<id>/src/v1/__tests__/conformance.spec.ts`, model on openai's) calling `runDomainConformance('ai', module, { requiredMethods: [...], capabilityKeys: ['text','image','vision','embeddings','speech','tools'] })`.
5. If the provider was built without a live key, add `'ai/<id>'` to `BETA_PROVIDER_KEYS` in `libraries/providers/kernel/src/verification.ts` (drives the settings "Beta" badge via `isProviderVerified`); remove it once smoke-tested against a live key.
6. Add the row to `libraries/providers/PROVIDERS_INVENTORY.md` (one row per module; bump the module/package counts and `ai=` domain count).

## Testing

- Package spec (`src/v1/__tests__/*.spec.ts`): `validateCredentials` ok/invalid/missing-key, `listModels` shape (static fallback and live-merge paths — mock the injected `SafeFetchPort`, never real HTTP), `createLanguageModel`/`createLangchainModel` return objects, optional model factories return the right type or `undefined`.
- Kernel-side coverage is automatic once registered: `all-providers.conformance.spec.ts` (manifest validity, domain match, pure `create()`, required methods present), `kernel.metadata.spec.ts` (metadata shape), plus `openai-compatible.adapter.spec.ts` for the shared fast-path class itself.
- Run: `vitest run --root libraries/providers/<id>` (each package also has `"test": "vitest run"`, so `pnpm --filter @postmill-ai/provider-<id> test` works); kernel gates via `vitest run --root libraries/providers/kernel`.

## Checklist

1. [ ] Decide path: OpenAI-compatible API ⇒ `OpenAICompatibleAdapter`; own `@ai-sdk/*` package or non-compatible API ⇒ bespoke `AiCapability` class.
2. [ ] Create `libraries/providers/<id>/` with `package.json`, `src/index.ts`, `src/v1/{index.ts,ai.adapter.ts,metadata.ts}`.
3. [ ] Implement the adapter + `ProviderModule` with the `create(ctx) → adapter.setSafeFetch(ctx.fetch); return adapter` shell; `create()` performs no network I/O.
4. [ ] Author `metadata.ts` with correct `kind`, `domains: ['ai']`, `modelCategories`, `modelHints`, `hasModelList`.
5. [ ] Register: `apps/backend/package.json` dep → `pnpm install`; two `tsconfig.base.json` aliases; import + spread in `apps/backend/src/providers.generated.ts`.
6. [ ] If endpoint-bringing: `{ requireBaseURL: true }` + add id to `BASE_URL_PROVIDERS` in `ai.descriptor.ts`; confirm `_assertBaseURLSafe` coverage.
7. [ ] Optional: icon entry in `apps/frontend/src/components/shared/provider-icon.tsx`.
8. [ ] If built without a live key: add `'ai/<id>'` to `BETA_PROVIDER_KEYS` in `kernel/src/verification.ts`.
9. [ ] Add package spec + conformance spec; update `PROVIDERS_INVENTORY.md`.
10. [ ] Run `vitest run --root libraries/providers/<id>` and `vitest run --root libraries/providers/kernel` — both green.
11. [ ] Never add an env-var key fallback; no active `AIOrgProviderConfig` must mean AI off for the org.
