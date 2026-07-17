# Agent Architecture

Postmill's chat agent is a Mastra/CopilotKit agent that lives at `/agents`. It understands natural-language requests, delegates to domain specialists, calls tools, and asks for human confirmation before outward actions.

> For the end-user view of what the agent can do, see [Agent User Guide](../user-guide/agent.md).
> For the MCP/A2A surfaces that expose the same tools to external clients, see [MCP Server](./mcp.md).

> Verified against v1.0.0

---

## High-level flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                         User (browser)                              │
└──────────────────┬──────────────────────────────────────────────────┘
                   │  natural-language message
                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│  CopilotKit provider  ──►  /copilot/agent  ──►  CopilotRuntime      │
│                         (cookies + CSRF header)                     │
└──────────────────┬──────────────────────────────────────────────────┘
                   │  GraphQL / streaming
                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Mastra agent ("postmill")                                          │
│  ┌─────────────┐                                                    │
│  │ Supervisor  │  owns integrationList + groupList                  │
│  │   (when     │  routes intent to specialists                      │
│  │  AGENT_     │                                                    │
│  │ SUPERVISOR_ │                                                    │
│  │ ENABLED)    │                                                    │
│  └────┬──────┘                                                    │
│         │  delegates                                                │
│         ▼                                                           │
│  ┌─────────┬─────────┬──────────┬─────────┐                         │
│  │ content │  media  │ analytics │   ops   │  specialist agents     │
│  └────┬────┴────┬────┴─────┬────┴────┬────┘                         │
│       │         │          │         │                              │
│       ▼         ▼          ▼         ▼                              │
│  generatePost  media       analytics  posts/                          │
│  Content, run  studios,    tools,    campaigns,                      │
│  Generator,    search      watchlist comments                        │
│  runContentPipeline, brand memory                                    │
└─────────────────────────────────────────────────────────────────────┘
```

* When `AGENT_SUPERVISOR_ENABLED` is not `false`, a supervisor agent routes to domain specialists (`content`, `media`, `analytics`, `ops`).
* When the supervisor is disabled, a single flat agent owns all tools directly.
* The same tool set is exposed through the MCP/A2A server; agent tools are not duplicated for MCP callers.

---

## Specialist responsibilities

| Specialist | Domain | Tool ids |
|---|---|---|
| `content` | Drafts, rewriting, brand voice, RAG/brand-memory searches, content pipeline | `generatePostContent`, `runGenerator`, `runContentPipeline`, `ragSearch`, `brandMemorySearch`, `brandProfile`, `brandMemoryReindex` |
| `media` | Image/video/audio generation, media studios, stock/library search, Designer | `generateImageTool`, `generateVideoTool`, `mediaStudioGenerate`, `mediaJobStatus`, `listMediaProviders`, `listMediaModels`, `filesSearch`, `stockSearch`, `uploadFromUrlTool`, `designerDesign` |
| `analytics` | Analytics overviews, best-time heatmap, recommendations, per-post metrics, watchlist | `analyticsOverview`, `bestTime`, `recommendations`, `analyticsPost`, `watchlist` |
| `ops` | Scheduling posts, campaign management, comments inbox/replies, post operations | `integrationSchema`, `triggerTool`, `schedulePostTool`, `listPosts`, `getPost`, `reschedulePost`, `deletePost`, `approveDraft`, `campaignCreate`, `campaignUpdate`, `campaignDashboard`, `campaignTag`, `commentsInbox`, `commentReply` |

The supervisor only owns `integrationList` and `groupList` directly; everything else is delegated.

---

## Tool inventory

All tools live under `libraries/nestjs-libraries/src/chat/tools/` and are registered in `tool.list.ts`. Every tool that mutates state is wrapped by the `ToolFirewallService` before being handed to the agent.

| Tool id | Class | Kind | Requires write scope | Human-in-the-loop in UI |
|---|---|---|---|---|
| `integrationList` | `IntegrationListTool` | read | no | no |
| `groupList` | `GroupListTool` | read | no | no |
| `integrationSchema` | `IntegrationValidationTool` | read | no | no |
| `triggerTool` | `IntegrationTriggerTool` | read | no | no |
| `schedulePostTool` | `IntegrationSchedulePostTool` | write | yes | via composer modal |
| `generatePostContent` | `GenerateContentTool` | read/AI | no | no |
| `runGenerator` | `RunGeneratorTool` | read/AI | no | no |
| `runContentPipeline` | `RunContentPipelineTool` | read/AI | no | no |
| `generateImageTool` | `GenerateImageTool` | write/AI | yes | no |
| `generateVideoTool` | `GenerateVideoTool` | write/AI | yes | no |
| `uploadFromUrlTool` | `UploadFromUrlTool` | write | yes | no |
| `designerDesign` | `DesignerDesignTool` | write | yes | no |
| `analyticsOverview` | `AnalyticsOverviewTool` | read | no | no |
| `bestTime` | `AnalyticsBestTimeTool` | read | no | no |
| `recommendations` | `AnalyticsRecommendationsTool` | read | no | no |
| `analyticsPost` | `AnalyticsPostTool` | read | no | no |
| `watchlist` | `AnalyticsWatchlistTool` | read | no | no |
| `listMediaProviders` | `ListMediaProvidersTool` | read | no | no |
| `listMediaModels` | `ListMediaModelsTool` | read | no | no |
| `mediaStudioGenerate` | `MediaStudioGenerateTool` | write/AI | yes | yes |
| `mediaJobStatus` | `MediaJobStatusTool` | read | no | no |
| `campaignCreate` | `CampaignCreateTool` | write | yes | yes |
| `campaignUpdate` | `CampaignUpdateTool` | write | yes | yes |
| `campaignDashboard` | `CampaignDashboardTool` | read | no | no |
| `campaignTag` | `CampaignTagTool` | write | yes | yes |
| `commentsInbox` | `CommentsInboxTool` | read | no | no |
| `commentReply` | `CommentReplyTool` | write | yes | yes |
| `listPosts` | `PostsListTool` | read | no | no |
| `getPost` | `PostsGetTool` | read | no | no |
| `reschedulePost` | `PostsRescheduleTool` | write | yes | yes |
| `deletePost` | `PostsDeleteTool` | write | yes | yes |
| `approveDraft` | `PostsApproveTool` | write | yes | yes |
| `filesSearch` | `FilesSearchTool` | read | no | no |
| `stockSearch` | `StockSearchTool` | read | no | no |
| `ragSearch` | `RagSearchTool` | read | no | no |
| `brandMemorySearch` | `BrandMemorySearchTool` | read | no | no |
| `brandProfile` | `BrandProfileTool` | read | no | no |
| `brandMemoryReindex` | `BrandMemoryReindexTool` | write | yes | no |

---

## Content pipeline

`runContentPipeline` is not a single LLM call; it delegates to an in-process **agent mesh** (`libraries/nestjs-libraries/src/chat/content-pipeline/`). The pipeline registry (`pipeline-registry.data.ts`) defines four bundled agents — strategist, copywriter, brandCritic, finalizer — validated against `AgentRegistrySchema` at boot. The conductor runs them sequentially, applying brand voice, platform constraints, and a brand-critique pass before returning polished copy. The pipeline has a wall-clock deadline bounded by `CONTENT_PIPELINE_TOTAL_TIMEOUT_MS` (default 5 minutes); the deadline is checked between stages, not inside a stage.

---

## Human-in-the-loop

When the request originates from the UI (`/agents`), the frontend intercepts outward actions with `useCopilotAction`/`renderAndWaitForResponse` and shows a confirmation card before the action is finalized:

* `schedulePostTool` — opens the composer modal pre-filled with the draft.
* `commentReply` — shows the draft message + post/comment id; calls the social comments API directly on approval.
* `mediaStudioGenerate` — shows provider, operation, model, and prompt; calls `POST /media/studio/:provider/generate` on approval.
* `campaignCreate`, `campaignUpdate`, `campaignTag`, `reschedulePost`, `deletePost`, `approveDraft` — show a confirmation card with the proposed change.

MCP/headless callers do not get a UI card; they rely on tool annotations (`readOnlyHint`, `destructiveHint`, etc.) and the `mcp:posts:write` scope.

---

## Context injection

The frontend can push a compact "current view" payload via `setAgentUiContext()` (`apps/frontend/src/components/agent/agent-context-bridge.tsx`). The bridge forwards it to CopilotKit as a readable; the backend reads `requestContext.get('ag-ui')?.context` and appends a short "Current view" preamble to the agent instructions.

**Last-view (not live-co-mount) semantics.** The producers (`/launches`, `/campaigns/[id]`, the post-detail modal) do **not** co-exist on the page with the agent chat route, so the store would be empty by the time the chat reads it if unmount deleted the contributed keys. Instead, a producer **unmounting marks the snapshot stale** (`leftViewAt` timestamp) rather than clearing it, and a producer **mounting clears `leftViewAt`** (a fresh view wins). The preamble then reads "currently viewing…" when fresh and "most recently viewed… (may be stale)" when `leftViewAt` is set. Stale ids are context, never implicit targets — the instructions tell the model to confirm the intended target before acting.

Payload is intentionally tiny: ids + labels only, never full post bodies.

Supported fields:

| Field | Meaning |
|---|---|
| `view` | Surface name, e.g. `"launches"` |
| `calendarWeek` | ISO week or selected range |
| `visiblePostIds` | Post ids visible in the current calendar/list |
| `selectedCampaignId` | Selected campaign id |
| `currentCustomerId` / `currentGroupId` | Selected customer/group id |
| `currentPostId` | Post id when a post detail modal is open |

---

## Model resolution

The agent resolves its model per-call through `AIModelProvider.languageModel(...)`. There is no env-key fallback; if the org has no active AI provider, the agent surface is off and the frontend routes the user to **Settings → AI**.

* Flat agent: `model: () => facade.languageModel('agent', orgId)`
* Supervisor: `model: () => facade.languageModel('utility', orgId)`
* Specialists: `content`/`analytics` use `'agent'`; `media`/`ops` use `'utility'`

---

## MCP / A2A preservation

The same `LoadToolsService.loadTools()` output is used by:

1. The `/agents` chat surface (via CopilotKit + Mastra).
2. The MCP server (`/mcp`, `/mcp/:id`, `/mcp-oauth`, `/media-mcp`).

`start.mcp.ts` builds the MCP tool union **directly from `LoadToolsService.loadTools()`** (the authoritative flat inventory), not by reflecting a private Mastra internal — so a Mastra rename can no longer silently collapse the exposed surface. A deterministic parity test (`__evals__/routing.eval.ts`) asserts that `SUPERVISOR_TOOL_NAMES ∪` the four specialist `*_TOOL_NAMES` equals `loadTools()` **exactly**; `pickTools` throws on an unresolvable name. Adding a tool to `tool.list.ts` and assigning it to a specialist surfaces it everywhere automatically; forgetting to assign it fails the parity test.

> **A2A (`/a2a`) is deferred / not mounted.** The prior bridge was written against an `@reaatech/a2a-reference-mcp-bridge` API that does not exist in the installed version (`A2aAsMcpServer` has no `handleRequest`), so every request 500-ed. It is tracked as a future feature rather than shipped broken — a correct build needs an in-process MCP transport pair + an A2A JSON-RPC HTTP layer over `McpToolAdapter.executeTask`, verified against a live consumer.

The `ToolFirewallService` wraps every execution, so budget, guardrail, and permission checks apply regardless of caller. `DEV_DISABLE_AGENT` only skips the agent-graph startup in `start.mcp.ts`; the MCP endpoints themselves remain available unless explicitly disabled separately.

---

## Access model & governance

Every entrypoint stamps an **access mode** into the tool request context, and each tool enforces it in `execute` (defense-in-depth beyond the HTTP scope check):

| Mode | Set by | Read allowed | Write allowed |
|---|---|---|---|
| `user` | CopilotKit (`/copilot/*`) | yes | yes |
| `mcp` | `/mcp*`, `/sse` | with `mcp:read` | with `mcp:posts:write` |
| `headless` | weekly digest | yes | **never** (hard invariant) |

- `requireRead(context)` / `requireWrite(context)` (in `tool.helpers.ts`) gate every registered tool. A test (`tools/__tests__/guard-coverage.spec.ts`) asserts the guard is present **and precedes the first `await this._`** (so a commented-out or post-spend guard fails), for every tool in `tool.list.ts`.
- **Text generation stays on `requireRead`; only artifact-spend is `requireWrite`.** The artifact tools that create durable media (`generateImageTool`, `generateVideoTool`, `designerDesign`, `mediaStudioGenerate`) require write scope because an `mcp:read` token must not spend money on a stored artifact. The text-spend tools (`generatePostContent`, `runGenerator`, and `runContentPipeline`'s text path) deliberately stay on `requireRead`: ephemeral text is the core utility of a read-scoped chat session, it is already bounded by the org `agent` budget cap, and "write" scope means *outward / durable side effects*, which transient text is not.
- **Org context is fail-closed**: `parseOrg` throws when the resolved org has no `.id`, and `checkAuth` unwraps the MCP auth wrapper (`{ org, userId, role }`) to the bare org — otherwise `where: { organizationId: undefined }` would run cross-tenant queries.
- **Budget scope is unified onto `agent`**: MCP/A2A entrypoints, CopilotKit, and the LangGraph `/posts/generator` run all gate on `checkBudget('agent', orgId)` and record spend under `scope: 'agent'` (the retired `scopeCaps.mcp` / `scopeCaps.generator` are migrated onto `scopeCaps.agent`). The generator run is budget-gated up-front (before the first `res.write`, so a capped org gets a clean 4xx, not a truncated stream) and records spend against its **real resolved provider/model**.
- **OAuth `pos_` tokens**: expired-but-unrevoked tokens are rejected (`findByAccessToken` checks `tokenExpiresAt`), and the persisted `scope` string is mapped to MCP scopes (granted write scopes now honoured; `mcp:read` floor).

---

## Feature flags

| Env var | Default | Effect |
|---|---|---|
| `AGENT_SUPERVISOR_ENABLED` | `true` | Enables the supervisor + specialists model. Set to `false` for a flat single agent. Read once at agent-build time — a change requires a process restart. |
| `AGENT_DIGEST_ENABLED` | unset (off) | Weekly headless AI digest per org (requires `USE_INNGEST=true` + a member opting into the `agent` notification category). Skips cleanly for orgs with no active AI provider. |
| `CONTENT_PIPELINE_TOTAL_TIMEOUT_MS` | `300000` | Overall wall-clock deadline for a `runContentPipeline` run (checked between stages). |
| `BACKEND_URL` | falls back to `NEXT_PUBLIC_BACKEND_URL` | Server-side backend URL for the MCP surface; `start.mcp.ts` fails fast at boot if neither is set. |
| `MEDIA_MCP_AUDIT_LOG_PATH` | `/tmp/media-mcp-audit.log` | File path for the media-MCP audit logger. |
| `DEV_DISABLE_AGENT` | unset | When set, `/copilot/agent` and `/copilot/chat` return 422/empty and MCP skips the agent surface. |

> **Content-pipeline timeout is a caller-wait bound, not a hard cancel.** The `CONTENT_PIPELINE_TOTAL_TIMEOUT_MS` `Promise.race` bounds only how long the caller **waits**; it does not abort in-flight agent-mesh work or its spend (no `AbortSignal` reaches `dispatchToAgent`). The deadline is re-checked **between** stages, so a stage already dispatched runs to completion even past the deadline — the run just rejects before starting the next one. Plumbing a real `AbortSignal` through agent-mesh is a tracked follow-up.
