# AI Architecture

Postmill ships a pluggable, multi-provider AI layer. Every AI surface resolves its provider through a single injection point (`AIModelProvider`) — there are no hardcoded provider calls, and **no `OPENAI_API_KEY` env-var fallback** (removed in v3.6.3). If an organization has no active provider, AI is off.

> For the end-user view, see [AI Tools](../user-guide/ai-tools.md).

> Verified against v1.0.0

---

## Resolution Precedence

`AIModelProvider._resolveConfig(scope, orgId?)` walks this chain and stops at the first match that has valid credentials:

| Priority | Source | Description |
|---|---|---|
| 1 | Per-org category default | `OrgDefaultModel` row for domain `ai` and the category mapped from the scope (or `high-reasoning` when `reasoning: true`) |
| 2 | Per-org active provider | `AIOrgProviderConfig` with `isActive: true` for the org |
| 3 | Per-scope override | `scopeModels[scope]` in `AISystemSettings` (legacy, consulted only when category defaults are kill-switched) |
| 4 | Surface default | Hardcoded `SURFACE_DEFAULTS` map |

There is **no env-key fallback** — the pre-v3.6.3 `OPENAI_API_KEY` fallback was removed. When resolution fails, `resolveConfigForScope` returns `null`, the caller surfaces "AI not configured," and the frontend routes the user to **Settings → AI**.

Category defaults can be disabled with `AI_MODEL_DEFAULTS_ENABLED=false`; the system then falls back to the legacy org-active / scoped-models chain. `AISystemSettings.activeProvider` is deprecated and no longer participates in runtime resolution.

---

## Model Categories

The legacy AI scopes are re-pointed onto four model categories:

| Category | Legacy scopes | Typical use |
|---|---|---|
| `low-reasoning` | `utility` | Text generation, prompt help, slide content, daily brief |
| `high-reasoning` | `generator`, `agent`, `mcp` | LangGraph generator, Mastra chat agent, CopilotKit runtime |
| `vision` | — | Vision-capable calls |
| `workflow` | — | Reserved for future workflow-specific routing |

A caller can pass `reasoning: true` to request the `high-reasoning` category regardless of scope. Known reasoning models are matched by prefix in `libraries/nestjs-libraries/src/ai/reasoning-models.ts`.

---

## Four AI Surfaces

| Surface | Scope | Default text model | Used by |
|---|---|---|---|
| Utility AI | `utility` | `gpt-4.1` | `OpenaiService` — text generation, structured output, image generation, TTS/STT via `AiMediaService` |
| Agent Generator | `generator` | `gpt-4.1` | `AgentGraphService` — LangGraph-based agent builder at `/agents` |
| Mastra Chat Agent | `agent` | `gpt-5.2` | `LoadToolsService` — function-form `model: () => facade.languageModel('agent')` |
| CopilotKit Runtime | `mcp` | `gpt-4.1` | `CopilotController` — `/copilot/chat` and `/copilot/agent`, policy- and budget-gated |

---

## Provider Registry & Adapters

AI adapters live in provider packages under `libraries/providers/<id>/src/v1/ai.adapter.ts`. They are registered into the `ProviderKernel` at backend boot by `ProvidersBootstrap` (`apps/backend/src/providers.bootstrap.ts`) from the generated manifest in `apps/backend/src/providers.generated.ts`.

25 providers total:

**16 bespoke adapters:** `openai`, `anthropic`, `google`, `bedrock`, `vertex`, `azure`, `groq`, `fireworks`, `togetherai`, `deepseek`, `mistral`, `cohere`, `perplexity`, `xai`, `gateway`, `openrouter`

**9 OpenAI-compatible adapters** via `OpenAICompatibleAdapter` from `@gitroom/provider-kernel`: `siliconflow`, `deepinfra`, `minimax`, `qwen`, `meta-llama`, `gmihub`, `bitdeer`, `lightning`, `vultr`

Each adapter implements the `AiCapability` interface from the kernel:

```ts
interface AiCapability {
  readonly identifier: string;
  readonly name: string;
  readonly type: 'hub' | 'direct';
  readonly credentialFields: AiCredentialField[];
  readonly capabilities: AiCapabilities;
  readonly privacy?: AiPrivacyInfo;
  readonly health?: AiHealth;

  listModels(creds: Record<string, string>): Promise<AiModelInfo[]>;
  validateCredentials(creds: Record<string, string>): Promise<{ ok: boolean; error?: string }>;

  createLanguageModel(creds, modelId, opts?): LanguageModel;
  createLangchainModel(creds, modelId, opts?): BaseChatModel;
  createImageModel?(creds, modelId): ImageModel | undefined;
  createEmbeddingModel?(creds, modelId): EmbeddingModel | undefined;
  createSpeechModel?(creds, modelId): SpeechModel | undefined;
}
```

Adapters receive decrypted credentials at call time and never store or log them. Outbound validation calls use the kernel-injected `SafeFetchPort` so tenant-supplied base URLs are SSRF-checked.

---

## Two-Step Config & Reasoning Split

Per-org provider configuration is a two-step flow:

1. **Auth** — API credentials (encrypted at rest; OAuth where a provider offers it).
2. **Model defaults** — the tenant picks a standard default (`defaultModel`) and an optional reasoning default (`reasoningModel`).

`imageModel` columns were dropped in v3.8.10. Image, video, audio, and avatar generation belong to the **Media provider system**, not the AI-provider config. Embeddings remain an internal capability for RAG only.

Tenants may configure multiple providers (`enabled` per row); one row per org is `isActive`. Category defaults (`OrgDefaultModel`) override the active row's `defaultModel` when `AI_MODEL_DEFAULTS_ENABLED` is true.

---

## Media Provider System

Media generation is a separate, pluggable per-org system in `libraries/nestjs-libraries/src/media/`:

- **`MediaProviderAdapter`** interface — each adapter declares `identifier`, `name`, a capability matrix (`image`/`video`/`audio`/`avatar`/`tts`/`stt`/`upscale`/`bgRemove`/`inpaint`), and implements generation per media type.
- **Registered adapters** — `fal`, `openai`, `elevenlabs`, `heygen`, `runway`, `black-forest-labs`, `vertex`, `replicate`, `stability-ai`, `tavus`, `d-id`, `hedra`, `minimax`, `deepgram`, `luma`, `ltx`, `suno`, `qwen`, `wan`, `higgsfield`, `genviral`, `reelfarm`, `sora`, `google-ai`, `recraft`, `ideogram`, `leonardo`, `togetherai`, `siliconflow`, `groq`, `openrouter`, `fireworks`, `deepinfra`, `gateway`, `bedrock`, `azure`.
- **Delivery semantics** — images are synchronous; video/audio/avatar are asynchronous, tracked in `AIMediaJob` with webhook-preferred completion and a `pollJob` fallback.
- **`MediaProviderConfig`** — per-org config row with encrypted credentials and a storage binding (`storageProviderId`, `storageRootFolderId`).
- **API** — `/settings/media` routes are gated with `@RequirePermission('media-config', 'manage')`.
- **Auto-config** — OpenAI and MiniMax credentials are live-linked between AI provider config and `MediaProviderConfig`.

`AiMediaService` (`libraries/nestjs-libraries/src/ai/governance/media.service.ts`) is the internal wrapper that routes image/video/TTS/STT/upscale/bg-remove/inpaint operations through the media provider system. Media operations are credit-gated (`ai_images`, `ai_videos`). C2PA provenance signing is available for visual operations, and a cost ledger records per-job USD estimates in `AIMediaJob.costUsd`.

---

## Governance Layer

All governance services live in `libraries/nestjs-libraries/src/ai/governance/`.

### GuardrailService

Input and output guardrails via `@reaatech/guardrail-chain` and `GuardrailSettingsConfig` from `AISystemSettings`. Each guardrail has a `sensitivity` level, optional custom patterns, and categories. Actions: `block`, `redact`, `warn`.

### BudgetService

Token/cost tracking with three cap levels:

- **Global** — instance-wide monthly/daily spend caps
- **Per-org** — per-tenant caps via `perOrgCaps`
- **Per-scope** — per-AI-scope caps via `scopeCaps` (legacy; unified onto `agent` for MCP/chat/agent surfaces)

Writes to `AISpendLog` for every AI call. Uses an in-memory accumulator with a 60s TTL. Fires threshold alerts at `alertThresholdPct` (default 80%). Returns 429 when budget is exceeded.

### ProviderHealthService

In-memory health tracking for every provider. Records success/error counters, consecutive errors, and timestamps.

### CircuitBreakerService

Per-provider state machine:

```
CLOSED ──(5 consecutive failures)──▶ OPEN
OPEN ──(30s cooldown)──▶ HALF_OPEN
HALF_OPEN ──(success)──▶ CLOSED
HALF_OPEN ──(failure)──▶ OPEN
```

While a breaker is OPEN, `AIModelProvider._withFallback` skips the primary provider and routes to the configured `fallbackProvider`.

### SemanticCacheService (OPT-IN)

Two-tier caching: exact hash + embedding similarity. Per-org scoped. Off by default.

### ModelRouterService (OPT-IN)

Budget-aware model routing, cheapest-first. Off by default.

### ToolFirewallService

Agent/MCP tool allow/deny lists. Enforces a 256 KB max input size for tool calls.

### RagService

pgvector-based RAG: content chunking, embedding computation via `AIModelProvider.embeddingModel()`, HNSW ANN index, dual vector store (pgvector + Qdrant), reciprocal-rank fusion, Redis index queue, per-org scoped search + admin backfill. Raw SQL is confined to `AiRagRepository`.

### AI rate limiting

Per-org AI rate limiting is enforced at the policy/budget layer (`BudgetService` / `BudgetMiddleware`); no NestJS throttler guard is currently wired.

### IdempotencyFactory

Redis-backed deduplication middleware with a 24-hour TTL.

### TelemetryService

OpenTelemetry via OTLP. Structured GenAI spans with attributes (`gen_ai.system`, `gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`).

---

## No-Provider Behaviour

`resolveConfigForScope` returns `null` when no active AI provider exists for the org. AI is off across all surfaces; the frontend does not mount CopilotKit and routes the user to **Settings → AI**. A deployment's env key must never be silently used as a tenant's AI provider.

---

## Admin API

`/admin/ai-settings` — super-admin-gated endpoints for:

- Provider management (CRUD, test connection, set active)
- Governance settings (guardrails, budget, rate limits, observability)
- Spend log and audit log
- Provider health dashboard

---

## Data Model

| Model | Purpose |
|---|---|
| `AIOrgProviderConfig` | Per-org provider credentials (encrypted), active flag, `defaultModel` + `reasoningModel` |
| `AISpendLog` | Cost ledger — input/output tokens, cost, provider, model, scope |
| `AIBrandProfile` | Brand voice instructions + language; many per org (`name`/`isDefault`/`slug`), selectable per-post via `Post.brandId` |
| `AIPromptTemplate` | Editable prompt templates (org-scoped or global) |
| `AISettingsAudit` | Append-only audit log of AI-settings changes |
| `AIMediaJob` | Media pipeline job/artifact tracking + provenance |
| `AIPromptLibraryItem` | User-created reusable prompts |
| `AIContentIndex` | RAG index — chunk metadata + BM25 text (embeddings in side table) |
| `AIProviderConfig` | **Deprecated** — replaced by `AIOrgProviderConfig` |
| `AISystemSettings` | Global scope models, fallback config, governance toggles |
| `OrgDefaultModel` | Per-org default for AI category or media category (`domain`, `category`, `providerId`, `version`, `model`, `settings`) |

Two related models live outside the AI group: `MediaProviderConfig` (per-org media provider + storage binding) and `Post.brandId` (per-post brand selection). See [Data Model](./data-model.md).
