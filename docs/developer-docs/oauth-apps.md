# OAuth Apps

Postmill supports OAuth 2.0 Authorization Code flow with PKCE, allowing third-party developers to build applications that act on behalf of Postmill organizations.

## Data models

Two Prisma models support the OAuth system:

- **`OAuthApp`**: a registered application. One per org. Stores `clientId` (prefix `pca_`), hashed `clientSecret` (prefix `pcs_`, shown once at creation), name, description, picture, redirect URL, and scope.
- **`OAuthAuthorization`**: a granted authorization. Links a user to an app. Stores the authorization code hash, access token hash, refresh token hash, token expiry, PKCE challenge, and approved scope.

## OAuth App management

All endpoints under `/user/oauth-app` require the `oauth_apps:manage` RBAC permission. Only one app per org is supported.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/user/oauth-app` | Get the current org's OAuth app |
| POST | `/user/oauth-app` | Create an OAuth app |
| PUT | `/user/oauth-app` | Update name, description, picture, redirect URL |
| DELETE | `/user/oauth-app` | Delete the app (revokes all existing authorizations) |
| POST | `/user/oauth-app/rotate-secret` | Rotate the client secret |

### Creating an OAuth app

```http
POST /user/oauth-app
Content-Type: application/json

{
  "name": "My App",
  "description": "...",
  "pictureId": "...",
  "redirectUrl": "https://my-app.com/callback"
}
```

Response:

```json
{
  "id": "...",
  "name": "My App",
  "description": "...",
  "pictureId": "...",
  "clientId": "pca_...",
  "clientSecret": "pcs_...",
  "redirectUrl": "https://my-app.com/callback"
}
```

The `clientSecret` is returned **once** at creation and stored as a SHA-256 hash in the database. If lost, rotate it.

## Authorization code flow

### Step 1: Redirect user to authorize

```http
GET /oauth/authorize?client_id=<pca_...>&redirect_uri=<url>&response_type=code&state=<opaque>&code_challenge=<challenge>&code_challenge_method=S256&scope=mcp:read
```

`GET /oauth/authorize` returns the app metadata and the provided state so the client can render a consent screen.

### Step 2: User approves or denies

```http
POST /oauth/authorize
Content-Type: application/json

{
  "client_id": "pca_...",
  "redirect_uri": "https://my-app.com/callback",
  "state": "...",
  "code_challenge": "...",
  "code_challenge_method": "S256",
  "scope": "mcp:read",
  "action": "approve"
}
```

Response on approval:

```json
{
  "redirect": "https://my-app.com/callback?code=<auth_code>&state=<state>"
}
```

If the user denies (`action: "deny"`), the redirect includes `error=access_denied`.

This endpoint requires a cookie session (the authenticated user must approve the grant).

### Step 3: Exchange code for tokens

```http
POST /oauth/token
Content-Type: application/json

{
  "grant_type": "authorization_code",
  "code": "<auth_code>",
  "client_id": "pca_...",
  "client_secret": "<pcs_...>",
  "redirect_uri": "https://my-app.com/callback",
  "code_verifier": "<verifier>",
  "scope": "mcp:read"
}
```

Response:

```json
{
  "id": "<org-id>",
  "cus": "<payment-id>",
  "access_token": "pos_<base64>",
  "token_type": "bearer",
  "expires_in": 3600,
  "refresh_token": "posr_<base64>",
  "scope": "mcp:read"
}
```

Only `grant_type=authorization_code` is supported. The endpoint is throttled to 20/min.

### PKCE

- **Challenge method**: `S256` only.
- `code_challenge` = `base64url(sha256(code_verifier))` (padded stripped).
- The `code_verifier` is validated against the stored `code_challenge` during token exchange.
- `redirect_uri`, if supplied during authorization, must match exactly on token exchange.

### Tokens

| Token | Prefix | Expiry | Storage |
|-------|--------|--------|---------|
| Access token | `pos_` | 1 hour | SHA-256 hash in DB |
| Refresh token | `posr_` | 30 days | SHA-256 hash in DB |

Access tokens are opaque strings. They are resolved by `OAuthService.getOrgByOAuthToken()`.

Authorization codes expire after **10 minutes**.

## Approved apps

Endpoints under `/user/approved-apps` allow users to manage apps they have authorized.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/user/approved-apps` | List apps the user has approved |
| DELETE | `/user/approved-apps/:id` | Revoke an app authorization |

Revoking deletes the `OAuthAuthorization` row and invalidates all tokens for that authorization.

## Scopes

| Scope | Description |
|-------|-------------|
| `mcp:read` | Read-access to MCP tools |
| `mcp:posts:write` | Create and manage posts via MCP |
| `mcp:admin` | Administrative operations (reserved) |

Scopes are requested during the authorization flow and enforced on every authenticated MCP request. The authorization server metadata only advertises `mcp:read` and `mcp:posts:write`.

## Token resolution (for MCP)

In the MCP server, token resolution works as follows:

1. The token is extracted from the `Authorization: Bearer <token>` header.
2. If the token starts with `pos_`, it is resolved via `OAuthService.getOrgByOAuthToken()` → returns the org and user.
3. OAuth-resolved tokens get scopes from the granted authorization, floored at `mcp:read`.
4. Write operations via OAuth require `mcp:posts:write` in the granted scope.

## Security notes

- Client secrets are stored as SHA-256 hashes; the plaintext is shown only at creation and rotation.
- Authorization codes, access tokens, and refresh tokens are all stored as SHA-256 hashes.
- Redirect URIs are matched exactly.
- PKCE is required for new authorizations; legacy authorizations without a code challenge still work for token exchange but cannot verify a verifier.

> Verified against v1.0.0
