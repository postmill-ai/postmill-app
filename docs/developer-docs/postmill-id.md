# Postmill ID (first-party SSO)

**Postmill ID** lets first-party Postmill apps — starting with the **template store** —
offer "Sign in with Postmill" against **any** Postmill instance: Postmill Cloud or any
self-hosted deployment. The app receives verified identity claims: user id, name,
email, avatar, and the org the user was working in when they consented.

It is deliberately separate from [OAuth Apps](./oauth-apps.md) (which issue
org-scoped `pos_` API tokens to registered third-party clients). Postmill ID has **no
client registration and no client secrets**: the first-party client is pinned in the
product, and the code exchange is protected by PKCE alone.

## How it works

1. Every instance auto-generates an RS256 keypair on first use. The private key is
   stored encrypted at rest (`EncryptionService`, AES-256-GCM) in the
   `InstanceIdentity` table; the public key is published at the JWKS endpoint. No
   operator configuration is required — this is what makes self-hosted instances
   work out of the box.
2. The store asks the user for their instance URL, fetches the instance's discovery
   document, and starts an authorization-code + PKCE (S256) flow in the browser.
3. The user logs in (if needed) and approves a consent screen on **their own
   instance**. The grant (`FederationGrant`) is bound to the user **and the org
   active at consent time** — id, name, and the user's role in it are what the store
   receives.
4. The store exchanges the code at the instance's token endpoint (public client —
   PKCE verifier instead of a secret) and receives an RS256-signed `id_token` plus a
   short-lived `posf_` access token for the userinfo endpoint.
5. The store verifies the `id_token` against the instance's JWKS: signature, `iss`,
   fixed audience `postmill-template-store`, `exp`, and the `nonce` it sent.

::: warning Reachability requirement
The store backend must be able to reach the instance over HTTPS (token exchange +
JWKS fetch). Self-hosted instances on private networks cannot use a cloud-hosted
store — this is inherent to any SSO-with-self-hosted design.
:::

## Endpoints

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /.well-known/postmill-identity` | none | Discovery document (endpoints, scopes, JWKS URI, fixed audience) |
| `GET /federation/jwks` | none | Public keys for `id_token` verification |
| `GET /federation/authorize` | none | Validates the request; drives the consent screen |
| `POST /federation/authorize` | session + CSRF | User approve/deny (from the consent screen) |
| `POST /federation/token` | PKCE | Code → `id_token` + `posf_` access token (20 req/min throttle) |
| `GET`/`POST /federation/userinfo` | `Bearer posf_…` | Scope-gated claims (1 h token lifetime) |

The consent screen lives on the instance's frontend at
`/oauth/authorize?client=federation&redirect_uri=…&code_challenge=…&code_challenge_method=S256&scope=…&state=…&nonce=…`.

## Scopes and claims

Only these scopes exist in federation; anything else is rejected (`invalid_scope`).

| Scope | Claims |
|---|---|
| `profile` | `name`, `picture` (avatar URL) |
| `email` | `email`, `email_verified` (true when the account is activated) |
| `org` | `org: { id, name, role }` — the consent-context org and the user's role key in it (`owner`/`admin`/`editor`/`member`/`viewer`) |

`sub` (the Postmill user id) is always present. The same scope gating applies to both
the `id_token` claims and `/federation/userinfo`.

## Login flow (store side)

```text
1. User enters their instance URL (Postmill Cloud is pre-filled).
2. GET <instance>/.well-known/postmill-identity
3. Generate PKCE verifier + state + nonce; redirect the browser to
   authorization_endpoint with redirect_uri, scope="profile email org",
   code_challenge, code_challenge_method=S256, state, nonce.
4. On the callback, POST token_endpoint:
     grant_type=authorization_code, code, redirect_uri, code_verifier
5. Verify id_token (RS256 against jwks_uri, iss, aud="postmill-template-store",
   exp, nonce) and create the local session.
6. Optionally refresh profile data later via GET userinfo_endpoint with the
   access token.
```

Example token exchange:

```bash
curl -X POST https://instance.example.com/federation/token \
  -H 'Content-Type: application/json' \
  -d '{
    "grant_type": "authorization_code",
    "code": "…",
    "redirect_uri": "https://templates.postmill.ai/auth/callback",
    "code_verifier": "…"
  }'
```

```json
{
  "id_token": "eyJhbGciOiJSUzI1NiIs…",
  "access_token": "posf_…",
  "token_type": "bearer",
  "expires_in": 3600,
  "scope": "profile email org"
}
```

## Revocation

Users see active sign-ins under **Settings → Approved apps → Postmill ID sign-ins**
and can revoke them there (`GET`/`DELETE /user/approved-apps/federation`). Revoking
immediately invalidates the access token; outstanding `id_token`s expire within an
hour.

## Instance configuration

| Variable | Default | Purpose |
|---|---|---|
| `FEDERATION_TRUSTED_REDIRECT_URIS` | `https://templates.postmill.ai/auth/callback` | Comma-separated allow-list of redirect URIs codes may be sent to. Exact match. Add staging/dev store URLs here. |
| `FEDERATION_ISSUER` | `BACKEND_URL` / `NEXT_PUBLIC_BACKEND_URL` | Explicit `iss` override (e.g. behind a path-rewriting proxy). |

To rotate the signing key, delete the `InstanceIdentity` row — a fresh keypair is
generated on next use. Rotation invalidates outstanding `id_token`s (they expire
within an hour anyway).
