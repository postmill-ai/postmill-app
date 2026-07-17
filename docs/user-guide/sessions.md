# Sessions & Devices

Postmill authenticates users with short-lived JWT access tokens and longer-lived rotating refresh tokens. The **Session** model tracks every refresh token, so you can review and revoke active devices from the UI.

## Access and refresh tokens

When you log in, register, or complete OAuth, the backend issues two cookies:

| Cookie | Token type | Lifetime | Notes |
|--------|------------|----------|-------|
| `auth` | JWT access token (HS256) | 30 days | Sent with API requests. |
| `refresh_token` | Opaque refresh token | 30 days | Used to obtain a new access token. |

Both cookies are `HttpOnly`, `Secure`, and `SameSite=None` in production unless `NOT_SECURED` is set.

## Refresh-token rotation

Calling `POST /auth/refresh` rotates the refresh token:

1. The incoming token is hashed with SHA-256 and looked up in `Session.tokenHash`.
2. If the session is revoked or expired, the request fails with **401**.
3. A new refresh token and hash are generated; the old hash is stored in `Session.previousTokenHash`.
4. A new JWT access token is issued and both cookies are updated.

### Reuse detection

If a rotated-out refresh token is reused, the backend finds it via `previousTokenHash` and **revokes the entire session**. This prevents replay attacks: once a token is rotated, the previous token becomes a revocation trigger.

## Active sessions list

Open the avatar menu → **Profile** → **Security** tab to see every active session for your account. Each row shows:

- browser and operating system (parsed from the user-agent string),
- whether it is the current device,
- the IP address (when available),
- the last-used timestamp.

You can revoke any session except the current one with `POST /user/sessions/:id/revoke`. To revoke every other session, use **Log out all other sessions** (`POST /user/sessions/revoke-all`). Logging out (`POST /user/logout`) revokes **all** of your sessions and clears the cookies.

## Session cleanup

A daily cron job at 03:00 UTC (`SessionCleanupService`) removes stale session rows to keep the table small:

- sessions whose `expiresAt` is more than 30 days ago, and
- sessions whose `revokedAt` is more than 7 days ago.

In a multi-replica deployment the job grabs a distributed lock so only one instance runs the sweep.

## Security notes

- Refresh tokens are stored as SHA-256 hashes; the plaintext token only exists in the cookie.
- JWT verification pins `HS256`; legacy tokens without an `exp` claim are still accepted.
- Cross-origin cookie behaviour is controlled by the `FRONTEND_URL` domain and the `NOT_SECURED` development flag.

> See also [Settings](./settings.md) for the settings layout, [Operations Guide → Security](../operations-guide/security.md) for the full security model, and [Operations Guide → Configuration](../operations-guide/configuration.md) for authentication environment variables.

> Verified against v1.0.0
