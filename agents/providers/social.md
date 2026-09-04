# Adding a social channel provider

End-to-end recipe for adding a new social posting channel (`social` domain) to the provider framework: adapter package under `libraries/providers/<id>`, kernel registration, capabilities matrix, settings DTO, frontend composer component, and tests. Reference implementations: `libraries/providers/tumblr` (OAuth2) and `libraries/providers/pixelfed` (customFields/instance + token). Shared framework steps (workspace package wiring, metadata, kernel registration) are in `agents/providers/overview.md` — this file covers only the social-specific parts.

## 1. Provider contract

The adapter is a class that `extends SocialAbstract implements SocialProvider`, both imported from `@postmill-ai/provider-kernel`.

- Interface: `libraries/providers/kernel/src/domains/social-provider.ts` (`SocialProvider`, line 192) — composes `IAuthenticator` + `ISocialMediaIntegration` + `ISocialMediaComments`.
- Base class: `libraries/providers/kernel/src/domains/social-base.ts` (`SocialAbstract`, line 96) — provides `this.fetch()`, `runInConcurrent`, `checkScopes`, default `checkValidity`/`handleErrors`/`commentsCapabilities`.

Required members (enforced by the conformance gate, `kernel/src/__tests__/all-providers.conformance.spec.ts:22` — social requires `post`, `generateAuthUrl`, `authenticate`, `maxLength`, `checkValidity`):

| Member | Type | Meaning |
|---|---|---|
| `identifier` | `string` | Stable machine id, e.g. `'tumblr'`. Used as the key in `PROVIDER_CAPABILITIES`, the settings union, the frontend `Providers` array, and the icon filename. |
| `name` | `string` | Display name, e.g. `'Tumblr'`. |
| `editor` | `'none' \| 'normal' \| 'markdown' \| 'html'` | Composer editor flavour. `'normal'` = plain text; pick `'html'` only if the platform renders raw HTML (tumblr uses `'normal'` because NPF rejects raw tags). |
| `scopes` | `string[]` | OAuth scopes requested in `generateAuthUrl`; empty for customFields providers. |
| `isBetweenSteps` | `boolean` | `true` = two-step connect (user picks a page/company after OAuth, e.g. `linkedin-page`). `false` for direct connect. |
| `maxConcurrentJob` | `number` | Publish-pool concurrency for this channel (base default 1; tumblr/pixelfed use 3). |
| `maxLength(additionalSettings?)` | `() => number` | Max message characters. |
| `checkValidity(posts, settings, additionalSettings)` | `Promise<string \| true>` | Server-side media validation; `posts[0]` is the main post's media, subsequent entries are comments' media. Return an error string or `true`. |
| `generateAuthUrl(clientInformation?)` | `Promise<GenerateAuthUrlResponse>` | `{ url, codeVerifier, state }`. |
| `authenticate(params, clientInformation?)` | `Promise<AuthTokenDetails \| string>` | Exchange the code; returning a string surfaces it as an error message. |
| `refreshToken(refreshToken, clientInformation?)` | `Promise<AuthTokenDetails>` | Return a stub with empty strings when the platform has no refresh flow. |
| `post(id, accessToken, postDetails, integration, clientInformation?)` | `Promise<PostResponse[]>` | Publish. |

Optional flags on `SocialProvider`: `toolTip`, `refreshWait`, `refreshCron`, `convertToJPEG`, `stripLinks()`, `oneTimeToken`, `isWeb3`, `isChromeExtension`, `externalUrl()`, `mention()`/`mentionFormat()`, `fetchPageInformation()`, `analytics()`/`postAnalytics()`, `changeNickname()`/`changeProfilePicture()`/`missing()`, `reConnect()`, `dto`.

Optional `setupDescriptor?: ChannelSetupDescriptor` (declared on `SocialAbstract` and `SocialProvider`, kernel `social-provider.ts`; bridged via `social-bridge.ts`): beginner-friendly metadata for the per-tenant "Add channel" config form — `authType` (`'oauth1' | 'oauth2' | 'token' | 'direct'`; every social adapter declares one — completeness and authType/flow consistency are grep-guarded in `kernel/src/__tests__/channel-setup-descriptors.spec.ts`), provider-terminology `credentialFields` (mapped onto the unchanged `clientId`/`clientSecret` DTO; an extra key marked `optional: true` — e.g. Meta FBfB `configId` — is folded into the DTO's `additionalConfig` JSON and persisted on the org config's encrypted `additionalConfig` column, then surfaced on `ClientInformation` by `OrgProviderConfigManager.#buildClientInfo` (currently `botToken`→`token`, `configId`→`configId`); empty values are never persisted), `portalUrl`/`portalLabel`, `callbackInstructions` (oauth types only), and 3–5 `setupSteps`. Semantics: oauth1/oauth2 = BYO developer app + callback registration; `token` = user/portal-issued credential(s) on the org config with no callback (telegram, wrapcast); `direct` = no developer app — connect happens in the composer flow (customFields, `externalUrl` dynamic registration, extension cookies, or agent claim) and the form shows guidance only. `IntegrationManager.getSocialProviderCatalog()` exposes it as `setup` plus a computed default `callbackUrl` (`${FRONTEND_URL}/integrations/social/<identifier>`, trailing slash stripped) — descriptors must NOT hardcode the callback URL, and an org-level `redirectUri` override still wins at connect time. Reference implementations: `libraries/providers/x` (OAuth 1.0a), `threads` (oauth2), `telegram` (token), `bluesky`/`mastodon` (direct).

### Auth models

- **OAuth2** (tumblr): implement `generateAuthUrl` (build the authorize URL from `clientInformation?.client_id`, `this.scopes`, and a redirect URI `${process.env.FRONTEND_URL}/integrations/social/<identifier>`), `authenticate` (exchange code → tokens, fetch profile, return `AuthTokenDetails`), `refreshToken`.
- **customFields / API-key / instance** (pixelfed): implement `customFields()` returning `{ key, label, defaultValue?, validation, type: 'text'|'password' }[]`. The connect UI submits the fields base64-encoded as `code`; `authenticate` decodes them and verifies against the API. Per-integration field values are stored encrypted on `Integration.customInstanceDetails` — pixelfed reads them via `AuthService.fixedDecryption(integration.customInstanceDetails!)` (from `@postmill-ai/helpers/auth/auth.service`).
- **Dynamic per-instance client registration** (`externalUrl`, mastodon): for federated/variable-host channels where OAuth apps are per-instance. Implement `externalUrl(url)` returning `{ client_id, client_secret }` — register the app on the user-supplied instance (e.g. Mastodon's `POST {instance}/api/v1/apps`). Rules:
  - Normalize/validate the URL with `normalizeExternalInstanceUrl` (kernel `domains/social-external-url.ts`): https only, bare host, no path/query/credentials. `IntegrationManager.generateAuthUrl` normalizes before calling the hook and merges the result (`{ ...clientInformation, client_id, client_secret, instanceUrl }`, dynamic wins) into `generateAuthUrl`, stashing the same blob in Redis `external:<state>`.
  - The outbound registration call is user-influenced HTTP — route it through the kernel `safeFetch` port (never bare `fetch`).
  - The callback (`no.auth.integrations.controller.ts`) merges the stashed blob over static client info for `authenticate` and persists it encrypted on `Integration.customInstanceDetails`; adapters must resolve the per-integration instance from that blob (decrypt-on-read, like pixelfed) in `post`/`comment`/comment-read methods. Reference: `kernel/src/domains/social-families/mastodon-base.ts` (`externalUrl`, `resolveInstanceUrl`).
- **Two-step** (`isBetweenSteps = true`): after OAuth the user selects a target — Facebook/Instagram family exposes `pages(token)` (`kernel/src/domains/social-families/instagram-base.ts:490`), LinkedIn Page exposes `companies(accessToken)` (`libraries/providers/linkedin-page/src/v1/social.adapter.ts:141`), then `reConnect(id, requiredId, accessToken)` binds the chosen target and `fetchPageInformation()` resolves its details.

**OAuth `state` rule:** always `const state = makeOauthState();` (from `@postmill-ai/provider-kernel`, `kernel/src/domains/social-make-id.ts`). The state doubles as the CSRF token / Redis capability key and must be ≥128-bit. `kernel/src/__tests__/oauth-state.guard.spec.ts` grep-guards every `social.adapter.ts` and family base: any `const state|nonce = …` must be `makeOauthState()` or `makeId(>=32)`; inline `makeId(n)` state with `n < 32` also fails.

## 2. PostDetails / PostResponse shapes

Defined in `kernel/src/domains/social-provider.ts`:

```ts
export type PostDetails<T = any> = {
  id: string;                    // DB internal id — echo it back in PostResponse.id
  message: string;
  settings: T;                   // the provider's settings DTO (section 5)
  media?: MediaContent[];        // { type: 'image'|'video', path, alt?, thumbnail?, thumbnailTimestamp? }
  poll?: PollDetails;            // { options: string[], duration: number /* hours */ }
  firstComment?: string;
};

export type PostResponse = {
  id: string;         // == PostDetails.id
  postId: string;     // platform-side post id
  releaseURL: string; // public URL of the published post
  status: string;     // e.g. 'completed'
};
```

`postDetails` is an array: index 0 is the main post; extra entries appear only for threaded/commented posts. Media paths may be relative (`uploads/x.png`) or absolute URLs — download them with `safeFetch(m.path)` (never bare `fetch`).

## 3. Package layout and module export

One workspace package per provider, `@postmill-ai/provider-<id>`, `main: "src/index.ts"`, dependency only on `@postmill-ai/provider-kernel` (see `libraries/providers/tumblr/package.json`):

```
libraries/providers/<id>/
  package.json
  src/index.ts                 # export * from './v1'; default-exports [<id>SocialModule]
  src/v1/index.ts              # export { <id>SocialModule, <Id>Provider } from './social.adapter'
  src/v1/metadata.ts           # ProviderMetadata
  src/v1/social.adapter.ts     # adapter class + module export
```

The kernel module export wraps the singleton adapter in `SocialProviderKernelAdapter` (`kernel/src/domains/social-bridge.ts`), which maps `ProviderRuntimeContext` credentials onto the legacy `ClientInformation` shape and conditionally exposes optional capabilities:

```ts
// tail of src/v1/social.adapter.ts (exact tumblr pattern)
import {
  ProviderModule, SocialProviderKernelAdapter, PROVIDER_CAPABILITIES,
} from '@postmill-ai/provider-kernel';

const __adapter = new TumblrProvider();

export const tumblrSocialModule: ProviderModule<any, any> = {
  metadata: providerMetadata,
  manifest: {
    domain: 'social',
    providerId: __adapter.identifier,
    version: 'v1',
    displayName: __adapter.name,
    status: 'active',
    credentialFields: [],
    capabilities: (PROVIDER_CAPABILITIES as any)[__adapter.identifier] || {},
  },
  create: (ctx) => new SocialProviderKernelAdapter(__adapter, ctx),
};
```

Register the package in `apps/backend/src/providers.generated.ts` (committed, alphabetically sorted; no generator script — add the `import <id>Modules from '@postmill-ai/provider-<id>'` line and the `...<id>Modules,` spread by hand). Boot wiring is `apps/backend/src/providers.bootstrap.ts` (`ProvidersBootstrap`).

**API-family bases** (`kernel/src/domains/social-families/`): if the platform speaks the Mastodon, Instagram/Facebook-Graph, or LinkedIn API, extend `MastodonProvider` (`mastodon-base.ts:19`), `InstagramProvider` (`instagram-base.ts:33`), or `LinkedinProvider` (`linkedin-base.ts:32`) instead of `SocialAbstract` and override only the deltas (see `libraries/providers/mastodon/src/v1/social.adapter.ts`, which just re-exports the base, and `linkedin-page` which subclasses `LinkedinProvider`).

## 4. Capabilities matrix

Add an entry keyed by `identifier` to `PROVIDER_CAPABILITIES` in `kernel/src/domains/social-capabilities.ts` (`ProviderCapability`, line 1). This feeds the module manifest `capabilities` and the composer UI.

| Field | Type | Meaning |
|---|---|---|
| `analytics` | `boolean` | Provider feeds the analytics surface (channel `analytics()` and/or post-level `postAnalytics()` — the flag cannot distinguish; see the `reddit` entry's comment). |
| `comments` | `boolean` | Channel supports the comments surface (implies `ISocialMediaComments` implementation). |
| `firstComment` | `boolean` | Composer offers "first comment" (`PostDetails.firstComment`). |
| `poll` | `boolean` | Supports `PostDetails.poll`. |
| `video` | `boolean` | Accepts `MediaContent.type === 'video'`. |
| `carousel` | `boolean` | Multi-image carousel posts. |
| `altText` | `boolean` | Forwards `MediaContent.alt` to the platform. |
| `maxMedia` | `number` | Max media items per post (`0` = text-only). |
| `linkPreview` | `boolean` | Platform renders link previews from URLs in the message. |
| `refreshToken` | `boolean` | Tokens expire and `refreshToken()` must work; `false` for static API keys (pixelfed) or non-expiring OAuth (mastodon). |
| `watchlist` | `boolean` | Eligible for the watchlist/ingestion surface. |
| `richText?` | `boolean` | Optional; absent = supported. Set `false` only when the editor lacks link/bullet/heading constructs (telegram). |

## 5. Settings DTO

`PostDetails.settings` is validated by a class-validator DTO. Canonical location: `libraries/providers/kernel/src/domains/social-dtos/<id>.dto.ts`, re-exported through the shim `libraries/nestjs-libraries/src/dtos/posts/providers-settings/<id>.dto.ts`:

```ts
// libraries/nestjs-libraries/src/dtos/posts/providers-settings/<id>.dto.ts
export { <Id>Dto } from '@postmill-ai/provider-kernel/domains/social-dtos';
```

Register in `libraries/nestjs-libraries/src/dtos/posts/providers-settings/all.providers.settings.ts` — both places, lockstep:

- the `AllProvidersSettings` union: `| ProviderExtension<'<id>', <Id>Dto>` (line 29), and
- the `allProviders()` array: `{ value: <Id>Dto, name: '<id>' }` (line 69).

Providers with no settings use the literal `None` type in the union and `{ value: setEmpty, name: '<id>' }` in the array (tumblr/pixelfed pattern). Providers with a real DTO also set `dto = <Id>Dto` on the adapter class (e.g. `libraries/providers/reddit/src/v1/social.adapter.ts:42`).

How settings are validated and cleaned at create time (`POST /posts`):

- `Post.settings` (`create.post.dto.ts`) is checked by `ProviderSettingsConstraint`
  (`dtos/posts/provider.settings.constraint.ts`): a present `__type` must be a known
  provider identifier; a missing one is injected server-side. Unknown settings keys are
  NOT rejected by the pipe.
- `PostsService.mapTypeToPost` pins `settings.__type` to the integration's real
  `providerIdentifier` and runs `sanitizeProviderSettings`
  (`dtos/posts/providers-settings/sanitize.settings.ts`), which keeps only the keys the
  provider's DTO declares (derived from class-validator metadata), the cross-cutting keys
  `color` and `firstComment` (platform features stored in settings), and dynamic
  internal-plug keys (`plug-` prefix). Everything else is stripped before persistence —
  the composer's shared fields (first comment, thread finisher) leak foreign keys into
  every provider's form, so both the client (`high.order.provider.tsx` `getValues()`) and
  the server sanitize.
- Value validation still happens per provider in `PostsService.validatePosts` via the
  adapter's `dto`.

## 6. Optional: env OAuth mapping (click-connect)

To let the deployment operator ship a platform OAuth app via env vars, add a row to `CHANNEL_ENV_MAPPINGS` in `libraries/nestjs-libraries/src/integrations/channel-env-credentials.ts:24`:

```ts
{ identifier: '<id>', clientIdEnv: '<ID>_CLIENT_ID', clientSecretEnv: '<ID>_CLIENT_SECRET' },
```

`isTokenOnly: true` for token-only providers (telegram pattern); `clientSecretEnv` may be omitted (vk/whop pattern); `configIdEnv` carries a Meta FBfB Configuration ID (facebook/instagram pattern — the OAuth dialog then uses `config_id` instead of `scope`). Resolution order per connect call is the bound org credential set (explicit `providerConfigId`) → platform env app (`IntegrationManager.getClientInformation`, `libraries/nestjs-libraries/src/integrations/integration.manager.ts:361`) — two scopes only; the legacy global `ProviderConfiguration` DB table, its super-admin `/admin/channel-configs` endpoints, and the by-identifier "primary org config" fallback for unbound integrations were removed in v1.0.0. This mapping is channels-only — never add env fallbacks for AI/shortlink providers.

## 7. Optional: comments surface

Implement `ISocialMediaComments` (`social-provider.ts:147`) on the same adapter class:

- `commentsCapabilities` getter — override the `SocialAbstract` default `{ read: false, reply: false, like: false }` to declare what you implement.
- `fetchComments(id, accessToken, postId, cursor, integration, clientInformation?)` → `{ comments: SocialCommentDTO[], nextCursor? }`.
- `replyToComment(id, accessToken, postId, parentCommentId, message, integration, clientInformation?)` → `SocialCommentDTO`.
- `likeComment(id, accessToken, postId, commentId, like, integration, clientInformation?)` → `{ liked, likeCount? }`.

The bridge exposes these on the kernel capability only when present (presence-probing consumers do `!!provider.fetchComments`). Also set `comments: true` in `PROVIDER_CAPABILITIES`.

## 8. Outbound HTTP and error semantics

- **All** platform HTTP goes through `this.fetch(url, options, identifier?)` (inherited from `SocialAbstract`, `social-base.ts:189`). It enforces the SSRF dispatcher, per-channel VPN egress, a 30s default timeout (`OUTBOUND_HTTP_TIMEOUT_MS`), and 429/5xx retry (max 2 retries, 5s backoff). **Never bare `fetch()`.**
- Downloading user/stored media URLs uses `safeFetch` from `@postmill-ai/provider-kernel` (port-bound to the real SSRF-safe implementation): `await safeFetch(m.path).then((r) => r.blob())`.
- Override `handleErrors(body: string, status: number)` to map platform error payloads; return `undefined` to fall through to defaults:
  - `{ type: 'refresh-token', value }` → throws `RefreshTokenError` → the publish pipeline refreshes the token and retries (401 with no handler also becomes `RefreshTokenError`).
  - `{ type: 'bad-body', value }` → throws `BadBodyError` → post marked failed with `value` as the user-facing message; no retry (devto example: `libraries/providers/devto/src/v1/social.adapter.ts:37`).
  - `{ type: 'retry', value }` → 5s sleep then retry (≤2).
- Throw `RefreshTokenError`/`BadBodyError` via the deprecated kernel aliases `RefreshToken`/`BadBody` (Proxy constructors in `social-base.ts`) only in legacy-style code; new code should let `handleErrors` + `this.fetch()` raise them.
- `runInConcurrent(fn)` wraps a call with the same `handleErrors` mapping for code paths that bypass `this.fetch()`.

## 9. Frontend (required)

1. Composer component at `apps/frontend/src/components/composer/providers/<id>/<id>.provider.tsx`, built with `withProvider` from `@postmill-ai/frontend/components/composer/providers/high.order.provider` (params at `high.order.provider.tsx:41`):

```tsx
'use client';
import { withProvider, PostComment } from
  '@postmill-ai/frontend/components/composer/providers/high.order.provider';

export default withProvider({
  comments: false,                 // or true / 'no-media'
  postComment: PostComment.POST,   // POST | COMMENT | ALL (post-comment.enum.ts)
  minimumCharacters: [],
  SettingsComponent: null,         // FC<{ values?: any }> when the provider has a settings DTO
  CustomPreviewComponent: undefined,
  dto: undefined,                  // the settings DTO class, when applicable
  maximumCharacters: 4096,         // or (settings) => number
});
```

2. Register in the `Providers` array in `apps/frontend/src/components/composer/providers/show.all.providers.tsx:46` — add the import and `{ identifier: '<id>', component: <Id>Provider }`. This is the current path; the older `components/new-launch/` location no longer exists.
3. Icon: square PNG at `apps/frontend/public/icons/platforms/<identifier>.png`; referenced throughout the UI as `/icons/platforms/${identifier}.png` (e.g. `apps/frontend/src/components/launches/information.component.tsx:228`, `channels.tab.tsx:131`). The filename must equal `identifier` exactly.

See `agents/frontend.md` and `agents/ui-standards.md` for composer/editor conventions.

## 10. Database

No schema change is needed to add a channel — both models are generic (`libraries/nestjs-libraries/src/database/prisma/schema.prisma`):

- `Integration` (line 265) — one row per connected account: `providerIdentifier`, `token`, `refreshToken`, `tokenExpiration`, `additionalSettings`, `customInstanceDetails` (encrypted customFields blob), `providerConfigId`, `providerVersion`.
- `OrgProviderConfiguration` (line 864) — per-org named OAuth-app credential sets (`clientId`/`clientSecret` AES-GCM-encrypted, `version`, and `vpnSelection` JSON `{ enabled, identifier, regionId, vpnVersion }` for optional per-channel VPN egress). Managed via Settings → Channels; credentials funnel through `IntegrationManager.getClientInformation`.

## 11. Universal steps (compressed)

Per `agents/providers/overview.md`, the full add-a-provider sequence is: create the workspace package + `metadata.ts` → implement the versioned module (`src/v1`) → default-export the module array from `src/index.ts` → register in `apps/backend/src/providers.generated.ts` → add domain-specific surfaces (this file) → tests → docs. Boot-time registration happens in `ProvidersBootstrap` via the kernel; no NestJS module edit is needed for the provider itself.

## 12. Tests

- Package tests run with Vitest: `vitest run --root libraries/providers/<id>` (the package `test` script is `vitest run`). Mock `this.fetch`/`safeFetch`; never hit the network — see `libraries/providers/facebook/src/v1/social.adapter.spec.ts`.
- Kernel conformance (`libraries/providers/kernel/src/__tests__/all-providers.conformance.spec.ts`) automatically picks up the new module from `providerModules` and asserts: valid manifest, pure `create()` (no network at construction), and that the created capability exposes `post`, `generateAuthUrl`, `authenticate`, `maxLength`, `checkValidity`. Run it with `vitest run --root libraries/providers/kernel` after registering.
- The OAuth-state grep-guard (`oauth-state.guard.spec.ts`) scans every `social.adapter.ts` — using anything but `makeOauthState()` / `makeId(>=32)` for `state`/`nonce` fails the kernel suite.

## Checklist

1. [ ] Create `libraries/providers/<id>` workspace package (`@postmill-ai/provider-<id>`, depends only on `@postmill-ai/provider-kernel`) with `src/index.ts`, `src/v1/{index.ts,metadata.ts,social.adapter.ts}`.
2. [ ] Implement the adapter: `extends SocialAbstract implements SocialProvider` (or a family base for Mastodon/Instagram/LinkedIn APIs) with all required members; `makeOauthState()` for OAuth state; `this.fetch()`/`safeFetch` only for HTTP; `handleErrors` override for platform error mapping.
3. [ ] Export `<id>SocialModule` via `ProviderModule` + `SocialProviderKernelAdapter`, and default-export `[<id>SocialModule]` from `src/index.ts`.
4. [ ] Add the `PROVIDER_CAPABILITIES['<id>']` entry in `kernel/src/domains/social-capabilities.ts`.
5. [ ] If the provider has per-post settings: add the DTO in `kernel/src/domains/social-dtos/<id>.dto.ts`, the re-export shim in `nestjs-libraries/src/dtos/posts/providers-settings/<id>.dto.ts`, set `dto` on the adapter, and register in **both** the `AllProvidersSettings` union and `allProviders()` array; otherwise use `None` + `setEmpty` entries.
6. [ ] Optionally add the `CHANNEL_ENV_MAPPINGS` row in `channel-env-credentials.ts` for env-based click-connect.
7. [ ] Optionally implement `ISocialMediaComments` + `commentsCapabilities` for the comments surface.
8. [ ] Register the package in `apps/backend/src/providers.generated.ts` (import + spread, alphabetical).
9. [ ] Frontend: create `apps/frontend/src/components/composer/providers/<id>/<id>.provider.tsx` with `withProvider`, register in `show.all.providers.tsx` `Providers` array, and add `apps/frontend/public/icons/platforms/<identifier>.png`.
10. [ ] Add adapter unit tests; run `vitest run --root libraries/providers/<id>` and `vitest run --root libraries/providers/kernel` (conformance + oauth-state guards).
11. [ ] Update the maintained docs site per repo policy (channels count, new env vars if any).
