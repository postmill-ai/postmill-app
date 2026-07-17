# Glossary

> Verified against v1.0.0

Terminology reference for the Postmill platform.

## Core concepts

**Postmill**
The application itself — a social media and chat post scheduling platform supporting 36 channels.

**Organization**
A tenant / workspace. All data (posts, channels, media, analytics, AI config) belongs to exactly one organization. Every request is org-scoped.

**Channel / Provider**
A social media platform or chat service integration (e.g., X, LinkedIn, Discord, Telegram). "Provider" is the platform; "channel" is the conceptual endpoint. See [Supported Channels](../user-guide/supported-channels.md) for the full capability matrix.

**Integration**
A single connected channel instance — credentials and settings for one account on one platform. Stored as an `Integration` row, encrypted at rest via `EncryptionService`.

**Inngest**
The durable job engine that schedules and executes background work. Postmill uses Inngest Cloud (or the local Inngest dev server) for event-driven and cron-triggered functions: post publishing, analytics collection, comment syncing, email delivery, autopost processing, and token refresh. Functions are served by the backend at `/api/inngest`.

**Orchestrator** (legacy)
The former Temporal worker application (`apps/orchestrator`) that hosted workflow and activity implementations. Removed in v3.9.0; all background jobs now run through Inngest inside the backend.

**Durable Execution**
An execution model where job state is persisted on every step. Inngest provides retries, concurrency controls, and idempotency so that background work resumes reliably after restarts or failures.

---

## Post lifecycle

**Post**
A scheduled content item. Has content (text, media, poll settings), a target set of channels, a scheduled date/time, and optional campaign, first-comment, and signature settings.

**Posts** (previously Schedule/Launches/Calendar)
The post scheduling interface at `/posts`. A grid/calendar view where users create, schedule, and manage posts.

**Workflow**
The Inngest `post-publish` function that executes post publishing. It handles: preflight validation, media upload, post creation per channel, optional first comment, and state management (draft → publishing → published / failed).

**First Comment**
An auto-posted comment that follows immediately after a successful publish. Configured per-post via `settings.firstComment`. Idempotent (records `firstCommentPostedAt` so retries cannot double-post). Gated on `providerCapabilities.firstComment`.

**Preflight**
Pre-publish validation that checks content limits, media formats, poll option validity, provider capability constraints, and platform-specific requirements. Runs client-side in the composer and server-side in the workflow before any publish attempt.

---

## Provider framework

**ProviderKernel**
The domain-agnostic registry that every provider domain resolves through. Providers are registered by `(domain, providerId, version)` and addressed as `domain/providerId@version`.

**Identity triple**
The qualified provider address: `domain/providerId@version`. Examples: `ai/openai@v1`, `social/x@v1`, `media/runway@v1`.

**Pin-on-write**
Every provider config and ledger row stores a non-null `version` column. The version is pinned at write time and does not change until an admin explicitly upgrades the row.

**ProviderModule**
The unit a provider package exports for each `(domain, version)` it participates in. Contains `metadata`, `manifest`, `create`, and optional `validateCredentials`.

**ProviderMetadata**
Static declaration in each provider package (`src/v1/metadata.ts`) describing `kind`, `domains`, supported categories, model hints, and model lists.

---

## Analytics

**AnalyticsSnapshot**
A daily aggregated metric row per channel/provider. Collected by the Inngest `analytics-collection` function (daily cron). Contains follower counts, engagement metrics, and reach data.

**PostAnalyticsSnapshot**
A daily aggregated metric row per individual post. Contains views, likes, comments, shares, and other post-specific engagement data.

**Rollup**
Daily `AnalyticsSnapshot` rows older than ~18 months (configurable via `ANALYTICS_DAILY_RETENTION_DAYS`) are rolled up into one weekly row per (integration, metric, ISO week). Flow metrics are summed; stock metrics keep the week's latest value. `PostAnalyticsSnapshot` rows are pruned after 90 days (`ANALYTICS_POST_RETENTION_DAYS`).

**Watchlist**
Competitor account monitoring. `WatchedAccount` rows track public metrics for competitor accounts, collected during the same analytics sweep. Probe failures (403/unsupported) auto-disable the capability. Gated on `providerCapabilities.watchlist`.

---

## AI

**AIModelProvider**
The central AI facade. A single injection point that resolves models per scope/category and organization. Precedence: per-org stub → per-scope → global active → provider default. Provides `generateText`, `generateObject`, and `imageModel` wrappers.

**Model category**
The AI model classification used by defaults resolution: `low-reasoning`, `high-reasoning`, `vision`, `workflow`. The legacy scopes `utility`, `generator`, `agent`, `mcp` map to these categories.

**Media category**
The Content / Media Defaults classification, e.g. `text-to-image`, `text-to-video`, `image-upscale`, `video-caption`, `text-to-speech`.

**Adapter**
A provider-specific implementation of `AIProviderAdapter`. Each supported AI provider implements `createLanguageModel`, `createLangchainModel`, and optionally `createImageModel`, `createEmbeddingModel`, or `createSpeechModel`.

**Governance**
The AI compliance layer: `GuardrailService` (prompt-injection, PII, brand-safety, NSFW filtering), `BudgetService` (per-scope spend caps with threshold alerts), `TelemetryService` (OpenTelemetry GenAI tracing), and `ProviderHealthService` (connection health tracking).

**RAG**
Retrieval Augmented Generation — semantic search over the organization's past content. Uses pgvector with HNSW ANN indexes for similarity search, a Redis-based indexing queue for durability, and org-scoped search. All raw SQL is confined to `AiRagRepository`.

**Media Pipeline**
AI-powered media operations: image generation, video generation, text-to-speech, speech-to-text, upscale, background removal, and inpainting. Wired through provider adapters and `AiMediaService`, each gated on its configured provider. Includes C2PA provenance and cost ledger.

**CopilotKit**
An in-app AI copilot framework that provides `/copilot/chat` and `/copilot/agent` endpoints. The frontend runtime is unmounted when an org has no active AI provider, routing users to Settings → AI instead.

**C2PA**
Coalition for Content Provenance and Authenticity. A standard for embedding provenance metadata in AI-generated media, ensuring generated images and videos carry tamper-evident origin claims.

---

## Social

**SocialComment**
A synced platform comment from a social provider. Stored in the `SocialComment` table with platform ID, parent tracking (threading), status, sentiment, priority, and assignment. Synced periodically by the Inngest `comments-collection` function.

**PostCommentRead**
Per-user read-state tracking for the comment inbox. Records which comments each user has seen, enabling unread counts and the unified inbox.

**Comment Inbox**
The unified cross-channel comment view at `/comments`. Filters by unread, assigned, and status. Supports bulk mark-read, quick replies, and sentiment/priority badges.

**Plug**
An automation hook attached to a social provider. Auto plugs run on a schedule; post plugs run once immediately after a successful publish.

---

## Architecture

**safeFetch**
The SSRF-safe HTTP client. All outbound HTTP on user-influenced URLs goes through `safeFetch`, which performs `isSafePublicHttpsUrl` validation followed by an `ssrfSafeDispatcher` that re-validates every hop on a redirect chain. Covers webhook dispatch, provider fetches, and watchlist probes. No bare `fetch(userUrl)` in the codebase.

**EncryptionService**
AES-256-GCM at-rest encryption for secrets (OAuth tokens, Nostr keys, integration credentials). Uses versioned `v2:` prefix with an expand-contract read fallback for legacy plaintext data. Uses `ENCRYPTION_KEY` env var, falling back to derivation from `JWT_SECRET`.

**CSRF**
Cross-Site Request Forgery protection via a cookie + header token pair. Required on all cookie-authenticated mutating routes. Header/API-key clients are unaffected. Bypassed under `NOT_SECURED` (dev-only).

**Repository Pattern**
The database access layer. Only repositories (under `nestjs-libraries/src/database/prisma/<domain>/`) may touch Prisma. Controllers and services must go through repositories — never call Prisma directly.

**useFetch**
The SWR-based data fetching hook for the frontend (`libraries/helpers/src/utils/custom.fetch.tsx`). Every SWR call must be its own hook and comply with `react-hooks/rules-of-hooks`.

**Prisma**
The TypeScript ORM and database toolkit used as the data access layer. The single schema file at `libraries/nestjs-libraries/src/database/prisma/schema.prisma` is the source of truth; migrations are applied with `prisma migrate deploy`.

**Helmet**
An Express middleware that sets secure HTTP response headers (HSTS, CSP, `noSniff`, `frameguard`). Applied globally in `main.ts`, skipped in dev via the `NOT_SECURED` env var.

**NOT_SECURED**
A dev-only environment variable that disables security hardening: skips Helmet, HSTS, CSRF middleware, and CopilotKit policy gating. Must never be set in production.

---

## Identity & access

**AppRole**
An RBAC role assigned to an org membership (v3.8.10). Five system roles are seeded — `owner`, `admin`, `editor`, `member`, `viewer` — and organizations can define custom roles. A role carries fine-grained `(resource, action)` permissions; routes gate on them with `@RequirePermission` (HTTP 403 on failure).

**Super-admin**
The platform operator flag (`User.isSuperAdmin`) — a different axis from the org `owner` role. Grants access to the super-admin `/admin/*` backend APIs (consumed by the separate administration app — this repo ships no `/admin` UI), AI admin settings, and impersonation, and bypasses RBAC, but not billing gates.

**Session**
A login session backing refresh-token rotation (v3.8.10). Stores only the SHA-256 hash of the refresh token; rotated on every refresh, revoked on logout or token reuse. Backs the per-user device list.

**Brand**
A brand voice profile (`AIBrandProfile`) — instructions, language, and per-platform overrides injected into AI generation. Since v3.8.10 an org can have many brands with one default; individual posts can select a brand (`Post.brandId`).

**Media Provider**
An AI media-generation backend (Runway, ElevenLabs, HeyGen, …) configured per organization via `MediaProviderConfig` (v3.8.10), with credentials encrypted at rest and output bound to the tenant's own storage under typed folders.

**Content Pack**
A premium, BYOK stock-media provider (Adobe Stock, Envato Elements, Magnific, Vecteezy) configured per organization. Resolved per capability; falls back to the free stock provider for any capability the active pack does not cover.
