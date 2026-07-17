# Security

This page documents the security controls built into Postmill. It covers defense-in-depth layers
from HTTP headers through encryption at rest, and is intended for operators who need to understand
or audit the security posture of their deployment.

## HTTP security headers (Helmet)

Applied in production via `helmet()` middleware. **Bypassed entirely when `NOT_SECURED` is set**
(dev-only — never set in production).

```typescript
// apps/backend/src/main.ts:80-108
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      connectSrc: ["'self'", 'https://api.github.com'],
      frameSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  frameguard: { action: 'deny' },
  hsts: {
    maxAge: 31536000,        // 1 year
    includeSubDomains: true,
    preload: true,
  },
  noSniff: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));
```

| Header / Policy            | Value                                 | Purpose |
|----------------------------|---------------------------------------|---------|
| HSTS                       | 1 year, includeSubDomains, preload    | Force HTTPS |
| Content-Security-Policy    | See directives above                  | Restrict script/style/media sources |
| X-Frame-Options            | `DENY` (via frameguard)               | Prevent clickjacking |
| X-Content-Type-Options     | `nosniff`                             | Prevent MIME sniffing |
| Referrer-Policy            | `strict-origin-when-cross-origin`     | Limit referrer leakage |
| Cross-Origin-Embedder-Policy | `false`                             | Disabled for CopilotKit/Swagger CDN assets |

## CSRF protection

Applied to all mutating requests (`POST`, `PUT`, `PATCH`, `DELETE`) on authenticated routes.

### Mechanism

1. On authentication, the server issues a `csrf_token` cookie (64 hex characters from CSPRNG
   random, 30-day expiry).
2. In production (`NOT_SECURED` unset), the cookie is `secure` + `sameSite: none`, `httpOnly: false`
   (must be JavaScript-readable to be forwarded as a header).
3. The frontend reads the `csrf_token` cookie and forwards it as the `x-csrf-token` header on
   every mutating request (via `useFetch`'s `custom.fetch.func.ts` and `csrf.header.ts`).
4. The CSRF middleware validates that the cookie and header values match.

### Exemptions

CSRF enforcement is **skipped** when:

- The method is `GET`, `HEAD`, or `OPTIONS`
- Authentication came from an `auth` header or API key (not a cookie) — typical for n8n/Zapier/API clients
- The request body contains a JWT `params` field — used by the browser extension
- `NOT_SECURED` is set (dev-only)

```typescript
// apps/backend/src/services/auth/csrf.middleware.ts:24
// Exempt: header/API-key auth, body-JWT (extension), or no auth
if (!authFromCookie || authFromHeader || hasBodyJwt) {
  next();
  return;
}
```

### Cookie attributes

| Attribute    | Prod (`NOT_SECURED` unset) | Dev (`NOT_SECURED` set) |
|--------------|---------------------------|------------------------|
| `secure`     | `true`                    | not set |
| `sameSite`   | `none`                    | default (lax) |
| `httpOnly`   | `false`                    | `false` |
| `expires`    | 30 days                   | 30 days |

## SSRF protection (safeFetch)

All outbound HTTP to user-influenced URLs goes through `safeFetch`
(`libraries/nestjs-libraries/src/dtos/webhooks/safe.fetch.ts`). This covers webhook dispatch,
provider fetches, watchlist probes, and any code path that constructs a URL from user input.

### Defense layers

1. **`isSafePublicHttpsUrl(url)`** — pre-validates the URL before every hop:
   - Rejects non-HTTPS URLs
   - Resolves the hostname via DNS and rejects private/internal/reserved IPs:
     - Loopback: `127.0.0.0/8`, `::1`
     - Link-local: `169.254.0.0/16`, `fe80::/10`
     - Private: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `fc00::/7`
     - Other reserved ranges
   - `SSRF_ALLOWED_PRIVATE_CIDRS` can opt-in specific CIDRs for self-hosted provider instances
2. **`ssrfSafeDispatcher`** — an undici `Agent` that blocks connections to private IPs at the
   network layer (second line of defense against DNS rebinding).
3. **Per-hop redirect re-validation** — `safeFetch` follows redirects manually (up to 5 hops),
   re-validating each redirect target through `isSafePublicHttpsUrl` before following.

```typescript
// libraries/nestjs-libraries/src/dtos/webhooks/safe.fetch.ts
export async function safeFetch(url: string, init?: RequestInit): Promise<Response> {
  let currentUrl = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!(await isSafePublicHttpsUrl(currentUrl))) {
      throw new Error('Blocked URL');
    }
    response = await fetch(currentUrl, {
      ...init,
      redirect: 'manual',
      dispatcher: ssrfSafeDispatcher,
    });
    if (response.status >= 300 && response.status < 400) {
      currentUrl = new URL(response.headers.get('location'), currentUrl).toString();
      continue;
    }
    return response;
  }
  throw new Error('Too many redirects');
}
```

**Never use bare `fetch()` on user-supplied URLs.** DTO validation alone does not survive DNS
rebinding or 30x redirects.

### Self-hosted media over `http://` (Pinterest video, LOCAL storage)

Because `safeFetch` enforces **HTTPS + public IP**, a self-hosted instance that serves its own media
over plain `http://` or from a private/internal address will now get a `Blocked URL` error where the
fetch previously worked. The concrete case is **Pinterest video posting**: the provider fetches the
media URL server-side through `safeFetch`, so a LOCAL-storage instance exposing media at
`http://<private-host>/uploads/...` fails the pre-flight validation.

To keep self-hosted media working with providers that re-fetch it:

- **Serve media over HTTPS** with a publicly resolvable hostname (the recommended fix), **or**
- Add the private range to `SSRF_ALLOWED_PRIVATE_CIDRS` (opt-in) so the internal media host is
  reachable. This narrows the SSRF posture — scope it to the exact CIDR your media host uses.

Managed/cloud storage (S3/R2/B2/etc.) is unaffected — those already serve HTTPS public URLs.

## Encryption at rest

Secrets stored in the database are encrypted with AES-256-GCM.

### Algorithm

- **Primary**: AES-256-GCM with the `v2:` prefix
- **Legacy fallback**: AES-256-CBC (decryption only — new values are always GCM)
- **Legacy deterministic**: AES-256-CBC (used for API keys and OAuth state parameters that must
  be compared without decryption)

```typescript
// libraries/helpers/src/auth/auth.service.ts:36-39
const GCM_ALGORITHM = 'aes-256-gcm';
const GCM_IV_LENGTH = 12;
const GCM_TAG_LENGTH = 16;
const V2_PREFIX = 'v2:';
```

### Key derivation

1. If `ENCRYPTION_KEY` is set:
   - Accepts 44-character base64 (decodes to 32 bytes) or 64-character hex (decodes to 32 bytes)
   - Pads or hashes shorter values with SHA-256
2. If `ENCRYPTION_KEY` is not set:
   - Falls back to `SHA-256(JWT_SECRET)`

```typescript
function getEncryptionKey(): Buffer {
  if (process.env.ENCRYPTION_KEY) {
    const raw = process.env.ENCRYPTION_KEY;
    if (raw.length === 44 && /^[A-Za-z0-9+/=]+$/.test(raw)) {
      const buf = Buffer.from(raw, 'base64');
      if (buf.length === 32) return buf;
    }
    if (raw.length === 64 && /^[0-9a-fA-F]+$/.test(raw)) {
      const buf = Buffer.from(raw, 'hex');
      if (buf.length === 32) return buf;
    }
    return crypto.createHash('sha256').update(raw).digest();
  }
  return crypto.createHash('sha256').update(process.env.JWT_SECRET || '').digest();
}
```

### What is encrypted

- `Integration.token` and `Integration.refreshToken` — OAuth access/refresh tokens
- `OrgProviderConfiguration` credentials — `clientId`, `clientSecret`, per-provider config
- `AIOrgProviderConfig` credentials — AI provider API keys
- `StorageProviderConfig` credentials — storage access keys
- `OrgShortLinkConfig` credentials — short-link provider API keys
- `MediaProviderConfig` credentials — media-generation provider API keys (v3.8.10)
- `AuthProviderConfig` — login provider `clientId`/`clientSecret` (v3.8.10)
- Nostr private keys
- Browser extension cookies (Skool)
- Third-party API keys

Login refresh tokens are **hashed** (`sha256`), not encrypted — see Sessions below.

### Key rotation

The deployment uses a **single** at-rest key (`ENCRYPTION_KEY`, or `SHA-256(JWT_SECRET)`
when unset). Because there is one key, rotating it requires re-encrypting every stored
secret in a controlled migration:

1. Add a one-time, ledger-gated `BackfillService` step (see the migration runbook in the
   [Upgrading guide](./upgrading.md#schema-changes-rollback)) that reads each encrypted
   column with the **old** key, then re-encrypts and writes it back with the **new** key.
2. Deploy with **both** keys available to that step, run it once (the migration ledger
   ensures it runs exactly once), then drop the old key.
3. Until multi-key support exists, do **not** rotate `ENCRYPTION_KEY` (or `JWT_SECRET`
   when it is the fallback) without this re-encryption step — every existing ciphertext
   would otherwise fail to decrypt. The `v2:` envelope can carry a key-id prefix in a
   future release to support overlapping keys; that is not implemented today.

> Startup safeguard: if `ENCRYPTION_KEY` is unset, the `ConfigurationChecker` logs a
> warning at boot (secrets are then keyed from `JWT_SECRET`). Set a dedicated 32-byte
> key in production.

## JWT security

| Property   | Value                                              |
|------------|----------------------------------------------------|
| Algorithm  | `HS256` (pinned — no `alg: none` or algorithm confusion) |
| Expiry     | 30 days (`expiresIn: '30d'`)                       |
| Renewal    | Sliding — new `exp` on each authenticated request  |
| Legacy     | Exp-less tokens still verify (no forced re-auth)   |
| IDs/secrets| CSPRNG-generated (`crypto.randomBytes`)            |

```typescript
// libraries/helpers/src/auth/auth.service.ts:93-98
static signJWT(value: object) {
  return sign(value, process.env.JWT_SECRET!, { expiresIn: '30d' });
}
static verifyJWT(token: string) {
  return verify(token, process.env.JWT_SECRET!, { algorithms: ['HS256'] });
}
```

### Sessions & refresh tokens (v3.8.10)

Login also issues a **refresh token** backed by a `Session` row. The token itself is never
stored — only its SHA-256 hash (`Session.tokenHash`). `POST /auth/refresh` rotates the hash on
every use; **reuse of an already-rotated token revokes the session** (theft detection). Logout
revokes all of the user's sessions. Users see an active-device list (user agent, IP, last used)
with per-session revoke under Profile → Security (`GET /user/sessions`,
`POST /user/sessions/:id/revoke`, `POST /user/sessions/revoke-all`). The JWT access token above
is unchanged.

## Sentry scrubbing

Error and breadcrumb data sent to Sentry is scrubbed of secrets and PII before transmission.

### Scrubbed fields

| Category       | Fields / patterns scrubbed                             |
|----------------|-------------------------------------------------------|
| Auth headers   | `Authorization`, `auth`, `cookie`, `showorg`, `impersonate` |
| API tokens     | `apiKey`                                               |
| Platform tokens| `pos_*`, `pca_*`, `pcs_*` patterns                     |
| Passwords      | Any field named `password`                             |
| Prompt bodies  | Full AI prompt/response text                           |
| Request data   | Request body and query string                          |

### PII capture

- OpenAI integration: `recordInputs: false`, `recordOutputs: false`
- Frontend: `sendDefaultPii: false`
- `consoleLoggingIntegration` gated behind `allowLogs` flag; only `warn`/`error` when enabled

## Throttling

Applied via `ThrottlerBehindProxyGuard`, which respects `X-Forwarded-For` headers.

- **Global default**: all routes are throttled by the default limit
- **Per-route**: `@Throttle()` decorators set specific limits (e.g. 30 req/min on AI user endpoints)
- **Store**: Redis-backed via `@nest-lab/throttler-storage-redis` (shared across replicas)
- **Public API**: `API_LIMIT` env var (default 30 requests/hour)

The throttler guard applies its default limit to all routes — per-route `@Throttle` caps
actually take effect (unlike earlier versions where most routes bypassed the throttler).

## Additional security invariants

### RBAC (v3.8.10)

Member actions inside an organisation are gated by role-based access control: five seeded system
roles (`owner`/`admin`/`editor`/`member`/`viewer`) plus per-org custom roles, enforced by
`@RequirePermission` → HTTP **403**. This is orthogonal to the billing/tier gate
(`@CheckPolicies` → HTTP **402**). The platform super-admin flag (`isSuperAdmin`) bypasses RBAC
only — it is a separate axis from the org owner role. See
[Backend Conventions](../developer-docs/backend-conventions.md#two-orthogonal-access-gates-v3-8-10).

### OAuth 2.0 / PKCE

OAuth flows enforce redirect-URI matching, PKCE code challenges, scope validation, and token
hashing. See [OAuth / SSO](./oauth-sso.md).

> **Operator action (AI-agent remediation).** Two behavior changes ship without a schema migration:
> (1) **expired `pos_` OAuth access tokens now return `401`** — any external MCP client presenting a
> past-dated token must re-authenticate through the normal OAuth flow (refresh / re-issue) to get a
> fresh token; (2) **AI budget caps unified onto `scopeCaps.agent`** — `scopeCaps.mcp` and
> `scopeCaps.generator` are retired, so migrate any values you had set under those keys onto
> `scopeCaps.agent`. Both the MCP entrypoints and the LangGraph generator now gate by and accrue to
> the single `agent` scope (the generator previously recorded `$0` and enforced nothing).

### Open-redirect allowlisting

Return URLs in integration/OAuth flows are validated against `INTEGRATION_RETURN_URL_ALLOWLIST`
(a comma-separated list of allowed partner origins) before persisting or redirecting.

### Multipart upload ownership

Media multipart/presigned operations are **org-bound** via an upload ownership ledger. Files are
never signed, listed, or completed by client-supplied `key`/`uploadId` alone — the server
verifies ownership.

### Validation pipe

Global `ValidationPipe` with `whitelist: true` and `forbidNonWhitelisted: true` rejects unknown
fields on all DTOs. Declare new optional fields explicitly on their DTO.

### Frontend

- CSP headers (see Helmet section above)
- `HttpOnly` auth cookies
- Production builds ship without source maps
- `dangerouslySetInnerHTML` content is sanitized with DOMPurify

## Related

- [Backend Conventions](../developer-docs/backend-conventions.md) — security invariants in the
  application layer
- [Configuration](./configuration.md) — `ENCRYPTION_KEY`, `SSRF_ALLOWED_PRIVATE_CIDRS`,
  `INTEGRATION_RETURN_URL_ALLOWLIST`, `NOT_SECURED`

> Verified against v1.0.0
