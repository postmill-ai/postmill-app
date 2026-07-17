# API Keys

Postmill uses per-user, per-organization API keys for programmatic access. The old single org-level key (`Organization.apiKey`) was retired in v3.8.8; all integrations and MCP clients must use the new keys.

## Key format

Keys follow the format:

```
pm_live_<43 base62 characters>
```

Example: `pm_live_ABC123...`

## Security model

- Keys are SHA-256-hashed at rest (never stored in plaintext).
- The plaintext is shown exactly once at creation and rotation.
- Each key is owned by a specific user within a specific organization.
- Authentication inherits the user's actual role in that organization.
- Keys can have an optional expiry date (`expiresAt`).
- Keys can be revoked (soft-delete via `revokedAt`).

## Usage

Include the key in the `Authorization` header as a raw string (no `Bearer` prefix):

```http
Authorization: pm_live_abc123...
```

This applies to:

- Public API v1 (`/public/v1/*`)
- MCP (`/mcp`, `/mcp/:id`, `/sse/:id`, `/media-mcp`)

The middleware resolves the key to the owning user and organization. On hosted instances with Stripe configured, the org must have an active subscription; otherwise the request returns `401`.

## Management endpoints

All endpoints under `/user/api-keys` are cookie-authenticated and org-scoped. Users can manage only their own keys within the current org.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/user/api-keys` | List my API keys for this org |
| POST | `/user/api-keys` | Create a new API key |
| POST | `/user/api-keys/:id/rotate` | Rotate an API key |
| DELETE | `/user/api-keys/:id` | Revoke an API key |

### Create a key

```http
POST /user/api-keys
Content-Type: application/json

{
  "name": "n8n production",
  "expiresAt": "2027-01-01T00:00:00Z"
}
```

Response:

```json
{
  "plaintext": "pm_live_xxxxxxxx...",
  "prefix": "pm_live_xxxx",
  "name": "n8n production"
}
```

`expiresAt` is optional and must be a valid ISO 8601 string.

### Rotate a key

```http
POST /user/api-keys/:id/rotate
Content-Type: application/json

{
  "name": "n8n production",
  "expiresAt": "2027-01-01T00:00:00Z"
}
```

Rotation revokes the old key and returns a new plaintext key with the same ownership.

### Revoke a key

```http
DELETE /user/api-keys/:id
```

Response:

```json
{
  "success": true
}
```

## Listing response

`GET /user/api-keys` returns the key metadata without the hash:

```json
[
  {
    "id": "...",
    "name": "n8n production",
    "prefix": "pm_live_xxxx",
    "expiresAt": "2027-01-01T00:00:00Z",
    "revokedAt": null,
    "lastUsedAt": "2026-06-09T12:00:00Z",
    "createdAt": "2026-06-01T00:00:00Z"
  }
]
```

## MCP scopes

When an API key is used with the MCP server, the resolved scopes depend on the user's org role:

- `owner`, `admin`, or a **super-admin with no membership in the target org** (resolved to `owner`, `start.mcp.ts:323-329`): `mcp:read`, `mcp:posts:write`
- `editor`, `member`, `viewer`: `mcp:read`

These scopes are intersected with `mcpsettings.allowedScopes` if configured.

## Migration from legacy org-level keys

If you have integrations still using the old `Organization.apiKey`, generate a new per-user key from **Settings → API Keys** and update the `Authorization` header. The old key type is no longer accepted by the Public API or MCP.

> Verified against v1.0.0
