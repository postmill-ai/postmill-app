---
name: add-ai-provider
description: Add a new AI/LLM provider (BYOK language-model provider, OpenAI-compatible endpoint, bespoke AI adapter) to the Postmill provider kernel. Use when asked to add an AI provider, LLM adapter, chat-model provider, or OpenAI-compatible gateway.
---

# Add an AI provider

Register a new `ai`-domain provider package under `libraries/providers/<id>` and wire it into the kernel.

## Read first
- `agents/providers/overview.md` — kernel mechanics: package layout, manifest, lifecycle, conformance gate, registration edits.
- `agents/providers/ai.md` — AI-specific: `AiCapability` contract, fast vs bespoke path, credential invariants, baseURL gates.

## Procedure

1. **Decide the path — check the fast path FIRST.** If the provider speaks the OpenAI Chat Completions API, instantiate the shared `OpenAICompatibleAdapter` from `libraries/providers/kernel/src/domains/ai-helpers.ts` — 14 of the 30 AI providers are config-only (`siliconflow`, `deepinfra`, `minimax`, `qwen`, `meta-llama`, `gmihub`, `bitdeer`, `lightning`, `vultr`, `kimi`, `zai`, `apertus`, `nvidia`, `openai-compatible`). Constructor: `(identifier, name, baseURL, capabilities?, models?, type='hub', opts?{ requireBaseURL? })`. Bespoke path (model on `libraries/providers/openai/src/v1/ai.adapter.ts`) only when the API deviates or has its own `@ai-sdk/*` package.
2. **Scaffold the package** `libraries/providers/<id>/`: `package.json` (`@postmill-ai/provider-<id>`, `"main": "src/index.ts"`, dep `@postmill-ai/provider-kernel: workspace:*`, `"test": "vitest run"`), `src/index.ts` default-exporting `ProviderModule[]`, and `src/v1/{index.ts, ai.adapter.ts, metadata.ts}` (layout: `agents/providers/overview.md` § Package layout).
3. **Implement the module.** Required `AiCapability` members (conformance-enforced): readonly `identifier`, `name`, `type`, `credentialFields`, `capabilities`; `listModels`, `validateCredentials`, `createLanguageModel`, `createLangchainModel`. Optional: `createImageModel`/`createEmbeddingModel`/`createSpeechModel`. The module shell must be:
   ```ts
   create: (ctx) => { adapter.setSafeFetch(ctx.fetch); return adapter as any; },
   validateCredentials: async (ctx) => { adapter.setSafeFetch(ctx.fetch); return adapter.validateCredentials(ctx.credentials); },
   ```
   `create()` performs no network I/O (conformance swaps in a throwing fetch to prove it). Never call the global `fetch` on tenant URLs — only the injected `SafeFetchPort`.
4. **Author `src/v1/metadata.ts`** (`ProviderMetadata`, `kernel/src/domains/metadata.ts`): `id` = `manifest.providerId`, `displayName`, `kind: 'direct'|'hub'` (`'action'` = no model list), `domains: ['ai']`, `modelCategories` a strict subset of `AI_MODEL_CATEGORIES` (`low-reasoning, high-reasoning, vision, workflow` — `libraries/nestjs-libraries/src/ai/defaults/default-categories.ts`), `hasModelList`, `modelHints`, `website`, `description.en`. Shape enforced by `kernel/src/__tests__/kernel.metadata.spec.ts`. Reference: `libraries/providers/kimi/src/v1/metadata.ts`.
5. **Register — 3 hand edits + install** (order in each file is alphabetical):
   - `apps/backend/package.json` — add `"@postmill-ai/provider-<id>": "workspace:*"` to `dependencies`, then `pnpm install`.
   - `tsconfig.base.json` — two path aliases: `"@postmill-ai/provider-<id>": ["libraries/providers/<id>/src"]` and `"@postmill-ai/provider-<id>/*": ["libraries/providers/<id>/src/*"]`.
   - `apps/backend/src/providers.generated.ts` — despite the name, **hand-maintained**: add `import <id>Modules from '@postmill-ai/provider-<id>';` and spread `...<id>Modules,` into `providerModules` (alphabetical). The kernel conformance and metadata specs import this array — an unregistered module skips the global gates.
6. **If endpoint-bringing** (no canonical base URL): pass `{ requireBaseURL: true }` to the adapter; add the id to `BASE_URL_PROVIDERS` in `apps/frontend/src/components/settings/shared/kit/descriptors/ai.descriptor.ts` (otherwise the Settings form filters the `baseURL` field out); the backend `_assertBaseURLSafe` in `libraries/nestjs-libraries/src/database/prisma/ai-settings/org-ai-settings.service.ts` already rejects private/loopback/non-HTTPS URLs with 400 on save and test-connection.
7. **Optional icon:** add an `ICONS` entry in `apps/frontend/src/components/shared/provider-icon.tsx`; omitting it falls back to a two-letter tile.
8. **Verification flag:** new providers are live-verified by default. Only if built without a live key, add `'ai/<id>'` to `BETA_PROVIDER_KEYS` in `libraries/providers/kernel/src/verification.ts` (shows a "Beta" badge via `isProviderVerified`); remove after a live smoke test.
9. **Tests:** add `src/v1/__tests__/` specs — `validateCredentials` ok/invalid/missing, `listModels` static + live-merge (mock the injected `SafeFetchPort`, never real HTTP), model factories. Model the conformance spec on `libraries/providers/openai/src/v1/__tests__/`.
10. **Inventory:** add a row to `libraries/providers/PROVIDERS_INVENTORY.md` (alphabetical in the ai section) and bump header counts (Modules, Packages, `ai=` domain count).

## Invariants (do not break)
- **No env-key fallback, ever.** Credentials live only in `AIOrgProviderConfig` (per-org, `@@unique([organizationId, identifier, version])`, encrypted at rest via `EncryptionService`). No active provider ⇒ AI is off for that org on all four surfaces (`utility`, `generator`, `agent`, `mcp`).
- `AIProviderConfig` is deprecated-global — do not read it.

## Verify
- `vitest run --root libraries/providers/<id>` — package specs.
- `vitest run --root libraries/providers/kernel` — `all-providers.conformance.spec.ts` + `kernel.metadata.spec.ts` gates.
- Or both: `pnpm --filter @postmill-ai/provider-<id> test` then the kernel command above.

## Pitfalls
- **Hardcoding a static model list without `listModels`.** The fast path is live-first (`fetchOpenAIStyleModels` + `mergeLiveModels`); static `models` is a curated fallback, not the catalog.
- **Misreading `BETA_PROVIDER_KEYS`:** verification is opt-out — verified by default; add a key only for built-without-a-live-key providers, and remove it after smoke-testing.
- **Reintroducing an env `OPENAI_API_KEY`-style fallback** — removed by design; never add one.
- **Skipping the metadata category constraint** — `modelCategories` outside `AI_MODEL_CATEGORIES` fails `kernel.metadata.spec.ts`.
- **Forgetting the second `tsconfig.base.json` alias** (the `/*` variant) or mis-alphabetizing `providers.generated.ts` imports/spreads.
- **Network in `create()`** — conformance proves purity with a throwing fetch; build clients lazily in the model factories instead.
