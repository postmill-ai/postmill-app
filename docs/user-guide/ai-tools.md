# AI Tools

Postmill includes a pluggable AI layer that powers content generation, media creation, comment management, compliance checks, and brand intelligence. All AI features are gated on having at least one AI provider configured for your organisation — if no provider is active, AI features are disabled and the CopilotKit assistant does not mount in the frontend.

Configure AI providers in **Settings → AI**. See [AI Architecture](../developer-docs/ai-architecture.md) for technical details, [AI Agent](./agent.md) for the conversational agent, and [Media Studios](./media/index.md) for the canvas tools.

## No-provider behaviour

When no active AI provider exists for an organisation:

- AI assist in the composer and the CopilotKit chat assistant are not shown.
- The `/agents` conversational agent prompts you to configure a provider.
- AI-driven features (repurposing, variants, comment sentiment, best-time analysis, etc.) return a "not configured" state.

There is no deployment-wide `OPENAI_API_KEY` fallback — each organisation uses its own configured keys.

## Four AI surfaces

The same AI facade resolves the right provider across four user-facing surfaces:

1. **Utility AI** — inline composer assist, general CopilotKit chat, content repurposing, variants, translation, hashtags, comment tools, compliance checks, best-time analysis, and brand-voice generation.
2. **`/agents` generator** — the LangGraph-based conversational agent that can schedule posts, generate media, check analytics, manage campaigns, and reply to comments. See [AI Agent](./agent.md).
3. **Mastra chat agent** — the function-form model used by the MCP server and tool-calling paths.
4. **CopilotKit runtime** — the `/copilot/chat` and `/copilot/agent` endpoints that build an `OpenAIAdapter` from the organisation's resolved AI credentials, gated by policy and budget.

## Text generation

### Composer AI assist

The composer text editor integrates with CopilotKit for inline AI assistance. With an active AI provider, a chat panel appears alongside the text editor where you can prompt the assistant to write, refine, or shorten post content.

### CopilotKit chat assistant

The general-purpose AI assistant is available at `/copilot/chat`. It can answer questions about your scheduled content, suggest posting strategies, and help draft posts. The assistant resolves the active AI provider per organisation and is gated by both policy (`Create + Sections.AI`) and per-request budget checks.

### Content repurposing

`POST /ai/repurpose` rewrites a piece of content for multiple platforms simultaneously:

```json
{
  "content": "Original post content here...",
  "platforms": ["twitter", "linkedin", "instagram"]
}
```

The response includes one result per requested platform, adapted to each platform's native tone and format conventions.

### A/B variants

`POST /ai/variants` generates content variants with different tones for A/B testing:

```json
{
  "content": "Original post content here...",
  "count": 3
}
```

Each variant includes a `tone` label and the rewritten content.

### Translation

`POST /ai/translate` translates content into multiple locales:

```json
{
  "content": "Content to translate...",
  "locales": ["es", "fr", "de"]
}
```

Returns one translation per locale with idioms and cultural references adapted for each target language.

## Hashtag suggestions

`POST /ai/hashtags` generates 15–20 platform-optimised hashtags:

```json
{
  "content": "Your post content...",
  "platform": "instagram"
}
```

The response includes a mix of popular and niche tags suited to the specified platform.

## Comment tools

`POST /ai/comment-reply` supports three actions:

| Action | Mode | Returns |
|--------|------|---------|
| `reply` (default) | Draft a reply from the social media manager's perspective. | `{ suggestion: "..." }` |
| `sentiment` | Analyse sentiment of all comments in a thread. | Per-comment sentiment with confidence scores, plus overall thread sentiment. |
| `summary` | Summarise a comment thread discussion. | Concise summary, key points, and suggested action items. |

```json
{
  "commentId": "cmt_abc123",
  "postContent": "The original post content for context...",
  "action": "sentiment"
}
```

## Content compliance

`POST /ai/compliance` checks post content against platform rules, brand safety concerns, and regulatory requirements:

```json
{
  "content": "Post content to check...",
  "platform": "linkedin"
}
```

The response includes a `passed` boolean, an array of `violations` (type, severity: high/medium/low, description), and remediation `suggestions`.

## Best time to post

`POST /ai/best-time` analyses your analytics data to suggest optimal posting time slots per channel. It uses post timing patterns and channel engagement metrics to produce an LLM-generated recommendation. When analytics data is sparse, the response falls back to evidence-based general best practices and indicates that no org-specific data was available via `hasAnalyticsData: false`.

## Brand voice

### Brands (multiple per organisation)

The `AIBrandProfile` model stores brand writing instructions. An organisation can have **multiple brands** with one default; manage them in **Settings → AI → Brands** (`GET/POST /brands`, `PUT/DELETE /brands/:id`, `POST /brands/:id/default`) and pick a brand per post in the composer.

The legacy single-profile endpoints remain as an alias for the **default** brand:

`PUT /ai/brand-profile` upserts the default brand profile:

```json
{
  "instructions": "Always use a friendly, approachable tone. Avoid corporate jargon.",
  "language": "en",
  "enabled": true,
  "platformInstructions": {
    "linkedin": "Maintain professional tone but be conversational.",
    "x": "Be witty and concise."
  }
}
```

`GET /ai/brand-profile` returns the current profile.

The brand profile is automatically injected into AI prompts that generate content — repurposing, variants, translations, and hashtag generation all respect your brand voice settings.

### Brand memory / RAG

The RAG (Retrieval Augmented Generation) system indexes your top-performing posts into a vector store for semantic search:

- `POST /ai/brand-memory/index` — indexes your 10 top-performing posts (by engagement) into the vector store.
- `POST /ai/brand-memory/search` — semantic search of only brand-memory-indexed content.
- `GET /ai/search` — general semantic search across all RAG-indexed content in your organisation.

The RAG system supports both `pgvector` (PostgreSQL ANN index via HNSW) and Qdrant as vector store backends. Configure it via `/rag/settings` or **Settings → AI → Brands → Knowledge Base**.

## Model defaults

**Settings → AI → Model Defaults** lets you choose the default model per AI category:

- **Low Reasoning** — utility text, prompts, slide breakdowns, and embeddings.
- **High Reasoning** — generation, agents, MCP, and reasoning-heavy tasks.
- **Vision** — image understanding and focal-point detection.
- **Workflow** — reserved for future agentic workflow steps.

For each category you can pick a provider/version/model from the live catalog, or leave it on **Auto** to let Postmill pick from your enabled providers. The legacy AI scopes (`utility`, `generator`, `agent`, `mcp`) map to these categories: `utility` → low-reasoning, the rest → high-reasoning.

API endpoints:

- `GET /settings/ai/defaults` — current defaults.
- `PUT /settings/ai/defaults/:category` — set a default.
- `DELETE /settings/ai/defaults/:category` — reset to Auto.
- `GET /settings/ai/defaults/catalog?category=` — selectable models for that category.

Operators can disable the new resolution with `AI_MODEL_DEFAULTS_ENABLED=false` (default `true`), which falls back to the legacy `orgActive` / surface-defaults chain.

## Image and media generation

`POST /ai/media` supports 7 media operations. Each operation routes through the per-organisation **media providers** configured in **Settings → Media** — an operation is available when a configured, enabled provider supports that capability:

| Operation | Description |
|-----------|-------------|
| `image` | AI image generation from a text prompt (synchronous) |
| `video` | Video generation from a text prompt (asynchronous job) |
| `tts` | Text-to-speech audio synthesis |
| `stt` | Speech-to-text transcription (base64 audio) |
| `upscale` | Image upscaling |
| `bg-remove` | Background removal from an image |
| `inpaint` | Image inpainting (fill masked region from prompt) |

```json
// Example: generate an image
{
  "operation": "image",
  "prompt": "A scenic mountain landscape at sunset",
  "size": "1024x1024"
}
```

All media operations are governed by the same budget, guardrails, and rate limits as text operations. Each media provider is configured independently in **Settings → Media** (with a storage location for generated output — see [Settings](./settings.md#media-tab)), allowing you to mix providers. Async results (video, audio, avatar) are saved into your organisation's storage and appear in the Media library.

### Media defaults

**Settings → Content → Media Defaults** lets you choose the default provider/model/settings for each media category, such as **Text to Image**, **Image to Video**, **Text to Speech**, **Avatar Video**, **Caption Burn-in**, etc. Like AI model defaults, you can pick a specific provider/version/model or leave a category on **Auto**. The settings form exposes only the tunables that the selected provider/model supports.

API endpoints:

- `GET /settings/content/media-defaults` — current defaults.
- `PUT /settings/content/media-defaults/:category` — set a default.
- `DELETE /settings/content/media-defaults/:category` — reset to Auto.
- `GET /media/studio/:provider/models?operation=` — live model catalog for kit studios.

### C2PA provenance

When C2PA provenance signing is enabled in Media Provider settings, generated media files are signed with Content Authenticity Initiative (C2PA) metadata, embedding cryptographically verifiable provenance information directly into the output file.

## Agents page

The `/agents/[id]` page provides a LangGraph-based post generator powered by the `AgentGraphService`. Each agent resolves the configured AI provider per-call. Agents can be configured with custom prompts and workflows to automate post generation at scale. See [AI Agent](./agent.md).

## Usage dashboard

`GET /ai/usage` returns spend metrics across all AI operations:

```json
{
  "byScope": [...],           // spend grouped by scope (utility, generator, agent, mcp)
  "totalSpendUsd": 12.34,     // all-time total
  "monthlySpendUsd": 5.67,    // current calendar month
  "dailySpendUsd": 0.42,      // today
  "budget": {
    "monthlyCap": 50.00,      // null if no cap set
    "dailyCap": 10.00,
    "remainingMonthly": 44.33,
    "remainingDaily": 9.58
  }
}
```

The spend tab in **Settings → AI** provides a visual dashboard of this data.

## Governance

All AI operations are subject to three governance layers:

1. **Guardrails** — input and output content filtering (toxicity, PII, prompt injection detection). Violations block the operation and return a `CapabilityNotAvailable` error.
2. **Budgets** — per-scope spending caps (monthly and daily). Exceeding a cap returns HTTP 429 for the offending scope. Configure caps in **Settings → AI → Spend**.
3. **Rate limits** — throttle limits apply per endpoint (typically 30 requests per 60 seconds for most AI endpoints, lower for intensive operations like brand memory indexing).

All AI operations log to the spend ledger (`AISpendLog`) for audit and cost tracking.

> Verified against v1.0.0
