# Integrations

Postmill's **Integrations** pillar covers every social channel, messaging destination, and content network the app can post to. This page describes the integration model, how credentials are resolved, the capability matrix that drives the composer UI, the OAuth/token/cookie auth paths, and how per-channel VPN egress works.

## Integration model

A social integration is a connection between an organization and an external platform. The runtime pieces are:

- **`Integration` row** — a connected channel (`providerIdentifier`, `internalId`, encrypted token/refresh token, posting times, groups, etc.).
- **Provider adapter** — a versioned package under `libraries/providers/<provider>/` that implements the social domain contract (`@gitroom/provider-kernel`).
- **`IntegrationManager`** — the central service (`libraries/nestjs-libraries/src/integrations/integration.manager.ts`) that enumerates providers, resolves credentials, builds the channel list, generates OAuth URLs, and dispatches provider tools.

Resolution always goes through the [provider framework](./provider-framework.md): the manager asks `ProviderResolutionService` for the exact `(social, providerId, version)` module, and the adapter's pinned version is respected for already-connected channels even when the provider is later disabled for new connections.

## Credential resolution: two paths

Channel credentials resolve along two paths, in strict precedence:

1. **Per-org `OrgProviderConfiguration`** (Settings → Channels) — the organization's own OAuth app or API tokens, encrypted at rest with `EncryptionService` (AES-GCM). This is the **override**: when an org has its own app for a provider it always wins.
2. **Platform OAuth app from deployment env** — when the operator sets a provider's app keys in the environment, every org gets one-click **Connect** with no key entry. Env keys are resolved live, per-request, and never persisted to a tenant row.

The funnel is `IntegrationManager.getClientInformation(integration, orgId, configId?)`:

- Explicit `configId` → named org config by id.
- No `configId` → org's primary config for that provider.
- No org config → env platform app (`getEnvClientInfo`).
- No org context → global `ProviderConfiguration` → env.

If neither path yields credentials, `requireClientInformation` throws `ProviderNotConfiguredError` and the channel cannot be connected.

### Env platform apps

`libraries/nestjs-libraries/src/integrations/channel-env-credentials.ts` maps provider identifiers to environment variable pairs. Examples:

| Provider | Client ID env | Client secret env |
|---|---|---|
| `x` | `X_API_KEY` | `X_API_SECRET` |
| `linkedin` | `LINKEDIN_CLIENT_ID` | `LINKEDIN_CLIENT_SECRET` |
| `facebook`, `instagram` | `FACEBOOK_APP_ID` | `FACEBOOK_APP_SECRET` |
| `discord` | `DISCORD_CLIENT_ID` | `DISCORD_CLIENT_SECRET` |
| `telegram` | `TELEGRAM_TOKEN` | — (token-only) |

Token-only providers (e.g. Telegram bots) carry a single token instead of an id/secret pair. Id-only providers (e.g. `vk`, `whop`) require only the primary env var. See `CHANNEL_ENV_MAPPINGS` for the full list.

The add-channel list and `isEnabled`/`getSocialIntegration` gates union `getEnvEnabledIdentifiers()` so env-backed providers always stay connectable.

## Capability matrix

`ProviderCapability` is the single source of truth for what each provider supports:

```ts
interface ProviderCapability {
  analytics: boolean;
  comments: boolean;
  firstComment: boolean;
  poll: boolean;
  video: boolean;
  carousel: boolean;
  altText: boolean;
  maxMedia: number;
  linkPreview: boolean;
  refreshToken: boolean;
  watchlist: boolean;
  richText?: boolean;
}
```

The matrix lives in `libraries/providers/kernel/src/domains/social-capabilities.ts` and is exposed through `IntegrationManager.getSocialProviderCatalog()` at `GET /integrations/`. The composer, preflight, and channel list read it to hide or disable unsupported controls (polls, video, carousel, alt text, first comment, etc.) consistently. A user-facing summary is in [Supported channels](../user-guide/supported-channels.md).

Key call-outs:

- `maxMedia: 0` means the provider does not accept uploaded media (e.g. Kick, Nostr).
- `richText: false` suppresses the rich-text toolbar for providers whose markup flavour lacks links/bullets/headings (e.g. Telegram).
- `analytics: true` means the provider feeds the analytics surface; for some providers this is post-level only.

## OAuth vs token/cookie auth

### OAuth flow

Most social providers use OAuth 2.0 or OAuth 1.0a:

1. `GET /integrations/social/:integration` calls `IntegrationManager.generateAuthUrl`, which binds state in Redis (`login:`, `organization:`, optional `config:`, `campaign:`, `redirect:`) and returns the provider's authorization URL.
2. The user approves the provider's consent screen.
3. The provider redirects to the backend OAuth callback, which posts to `POST /integrations/social-connect/:integration` (`NoAuthIntegrationsController.connectSocialMedia`).
4. The backend validates state, exchanges the code for tokens via the adapter's `authenticate`, and creates or updates the `Integration` row.

`redirectUrl` values are allowlisted via `INTEGRATION_RETURN_URL_ALLOWLIST` before persist/return.

### Token/cookie auth

Some providers do not use OAuth:

- **API-token providers** (e.g. Telegram bots, Nostr) connect by pasting a token. The token is encrypted at rest and used directly.
- **Browser-extension providers** (e.g. Instagram standalone) authenticate by extracting cookies via the Postmill browser extension. `POST /integrations/extension-refresh` accepts a signed JWT, verifies the integration id, and refreshes the stored cookie token.
- **Custom-instance providers** (e.g. Mastodon, Lemmy, PeerTube) may ask for an instance URL plus an access token.

All stored credentials — OAuth tokens, refresh tokens, API tokens, cookies, and custom instance details — are encrypted with `EncryptionService` (AES-GCM, `v2:` prefix) before being written to the database.

## Per-channel VPN egress

An `OrgProviderConfiguration` can opt into routing **all outbound posting requests for that channel** through a VPN region's proxy. This is configured in Settings → Channels per credential config.

### How it works

- `OrgVpnConfig` (Settings → VPN) stores encrypted VPN credentials and enabled regions.
- VPN providers expose either a static `proxyRegions` catalog or a dynamic `resolveRegions(config)` (used by the generic `custom` proxy adapter).
- The channel config stores the non-secret `vpnSelection` JSON: `{ enabled, identifier, regionId, vpnVersion }`.
- At publish time, `PostActivity.postSocial` resolves the selection and calls `VpnDispatcherService.get`, which returns a pooled undici dispatcher.
- The provider's `post()` runs inside `runWithVpnDispatcher` (AsyncLocalStorage). `SocialAbstract.fetch()` reads `getVpnDispatcher()` and uses it in place of the default `ssrfSafeDispatcher`.

### Security posture

- The proxy host is validated as a public address.
- The proxy-connect leg keeps the private-IP DNS pin.
- The destination URL is re-checked with `isSafePublicHttpsUrl` before dispatch.
- Dispatchers are keyed by `(org, provider, region, creds-fingerprint)` and invalidated on any VPN config change.

Only **SOCKS5 / HTTP-CONNECT** providers route per-request. WireGuard/OpenVPN tunnels are out of scope. Providers that bypass `SocialAbstract.fetch()` with raw `fetch` or `axios` (e.g. parts of Medium, LinkedIn auth, Bluesky) are not currently proxied.

## Controllers and routes

The main integration routes live in two controllers:

- **`IntegrationsController`** (`apps/backend/src/api/routes/integrations.controller.ts`) — authenticated org-scoped routes for listing, connecting, disabling, deleting, updating settings, posting times, and invoking provider tools.
- **`NoAuthIntegrationsController`** (`apps/backend/src/api/routes/no.auth.integrations.controller.ts`) — the public OAuth callback receiver and extension-refresh endpoint.

Key routes:

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/integrations/list` | Connected channels for the org |
| `GET` | `/integrations/social/:integration` | Begin OAuth connect |
| `POST` | `/integrations/social-connect/:integration` | OAuth callback / finish connect |
| `POST` | `/integrations/provider/:id/connect` | Save selected page/profile for two-step providers |
| `POST` | `/integrations/function` | Call a `@Tool`-decorated provider method |
| `POST` | `/integrations/:id/time` | Set posting schedule for a channel |
| `POST` | `/integrations/enable` / `/disable` / `DELETE /` | Toggle or remove a channel |

Tool dispatch is whitelisted: only methods decorated with `@Tool` plus the special `mention` helper can be invoked through `/integrations/function`.

## Caching

`IntegrationManager.getIntegrationListResponse` caches the rendered channel list in Redis (`integrations:list:{orgId}`) for 60 seconds. Mutations (connect, disable, delete, settings changes, nickname, group, customer name) invalidate the cache.

## Related docs

- [Provider framework](./provider-framework.md)
- [Adding a provider](./adding-a-provider.md)
- [Supported channels](../user-guide/supported-channels.md)
- [Webhooks](./webhooks.md)
- [Public API](./public-api.md)
- [Operations: configuration](../operations-guide/configuration.md)

> Verified against v1.0.0
