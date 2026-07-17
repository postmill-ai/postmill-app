# MCP Server

Postmill exposes an MCP (Model Context Protocol) server with multiple entrypoints for AI agent integration. The server is bootstrapped in `libraries/nestjs-libraries/src/chat/start.mcp.ts` and provides access to the Mastra chat agent's tools and sub-agents.

MCP startup is gated by feature flags: `DEV_DISABLE_MCP` and `DEV_DISABLE_AGENT` both skip mounting the surface.

## Entrypoints

### Primary MCP entrypoints

| Entrypoint | Auth method | Transport | Notes |
|-----------|-------------|-----------|-------|
| `/mcp-oauth` | OAuth2 (`authorization_code` + PKCE) | Streamable HTTP | Full OAuth flow via `@reaatech/a2a-reference-auth` |
| `/mcp` | Bearer token | Streamable HTTP | `Authorization: Bearer <token>` |
| `/mcp/:id` | API key in path | Streamable HTTP | `GET /mcp/<apiKey>` |
| `/sse/:id` + `/message/:id` | API key in path | SSE | Server-Sent Events transport |
| `/media-mcp` | Bearer token | Streamable HTTP | Media operations; gated by `mediaEnabled` in MCP settings |

### Supporting infrastructure endpoints

| Entrypoint | Auth method | Notes |
|-----------|-------------|-------|
| `/.well-known/openai-apps-challenge` | None | Serves `OPENAI_APP_CHALLENGE` env var as plain text |
| `/.well-known/oauth-protected-resource` | Optional Bearer | OAuth resource metadata; enforces `mcp:read` when a token is present |
| `/.well-known/oauth-authorization-server` | None | OAuth server metadata (public) |

`/a2a` is intentionally **not mounted**. The previous implementation depended on an incompatible version of the A2A bridge package and returned 500 for every request. A correct A2A layer is tracked as a future feature.

## Authentication

Token resolution uses a two-layer strategy:

1. **Token type detection**: tokens starting with `pos_` resolve via `OAuthService.getOrgByOAuthToken`. All other tokens resolve as per-user API keys (`ApiKeysService.findActiveByHash`).
2. **Scope enforcement**: via `@reaatech/a2a-reference-auth` `AuthStrategy`. The resolved identity is checked against required scopes.

### Scopes

| Scope | API-key default | OAuth default | Description |
|-------|-----------------|---------------|-------------|
| `mcp:read` | Yes | Yes | Read-access to all MCP tools |
| `mcp:posts:write` | Owner/Admin only | No | Create posts via MCP |
| `mcp:admin` | No | No | Administrative operations (currently no tool enforces this) |

For API keys, `mcp:posts:write` is granted only when the user's role in the org is `owner` or `admin`. For OAuth tokens, the granted scopes come from the authorization's `scope` field, intersected with the known scopes, and floored at `mcp:read`.

Admin-configured `mcpsettings.allowedScopes` are merged with the defaults.

## Subscription gating

Every MCP request checks `SubscriptionService` for the org's tier. If Stripe is configured (`STRIPE_PUBLISHABLE_KEY` is set) and the org's plan does not include MCP (`plan.mcp: false`), the request returns `402 PaymentRequired`. Self-hosted instances without Stripe configured allow MCP for all orgs.

## Rate limiting

Redis-backed with an in-memory fallback:

- **Window**: 60 seconds
- **Max requests**: 200 per window per key
- **Key pattern**: `ratelimit:mcp:{entrypoint}:{identifier}`

Keys are per-entrypoint (e.g. `mcp-oauth:{ip}`, `mcp:{ip}`, `mcp-id:{apiKey}`, `sse:{id}`, `media-mcp:{orgId}`). When Redis is unavailable, the rate limiter falls back to an in-memory `Map` with the same window.

`/media-mcp` uses its own rate limiter: 30 requests per 60-second window.

## Idempotency

Requests can include an `x-idempotency-key` header. Duplicate keys within 24h return `409 idempotency_conflict`.

- **Redis-backed**: via `IdempotencyFactory` from the AI governance module when available.
- **In-memory fallback**: 24h TTL `Map` when the factory is unavailable.

## CORS

- **Development** (`NODE_ENV=development`): `Access-Control-Allow-Origin: *`
- **Production**: origin must match `FRONTEND_URL` exactly.

## Relationship to AI facade

The MCP server is linked to the AI provider system via the `mcp` scope (`AIScope`). The `AIModelProvider` resolves model configurations per-scope, per-org. MCP tool execution that involves AI generation uses the active AI provider configured for the org.

## Media MCP server

When `mediaEnabled` is `true` in MCP settings, a second MCP server is mounted at `/media-mcp`. This uses `@reaatech/media-pipeline-mcp-server` and `@reaatech/media-pipeline-mcp-security` for:

- RBAC middleware (`pipeline:run`, `pipeline:define`, `artifact:read`, `cost:read`)
- Rate limiting (60s window, 30 requests max)
- Audit logging to `MEDIA_MCP_AUDIT_LOG_PATH` (default `/tmp/media-mcp-audit.log`)
- Multi-tenant resolution and budget caps

`JWT_SECRET` is required before `/media-mcp` is mounted.

## OAuth server metadata

`/.well-known/oauth-authorization-server` returns:

```json
{
  "issuer": "<BACKEND_URL>",
  "authorization_endpoint": "<FRONTEND_URL>/oauth/authorize",
  "token_endpoint": "<BACKEND_URL>/oauth/token",
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code"],
  "code_challenge_methods_supported": ["S256"],
  "scopes_supported": ["mcp:read", "mcp:posts:write"]
}
```

`mcp:admin` is not advertised because no tool currently enforces it; existing granted rows still keep it for backward compatibility.

## Errors

Common MCP error responses:

- `401 unauthorized` — missing or invalid token.
- `403 insufficient_scope` — token lacks the required scope.
- `402 PaymentRequired` — MCP not included in the org's subscription plan.
- `429 too_many_requests` — rate limit exceeded.
- `409 idempotency_conflict` — duplicate idempotency key.
- `403 mcp_disabled` — MCP or agent surface is disabled by feature flag.

> Verified against v1.0.0
