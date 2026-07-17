# Adding a social channel provider

> Verified against v1.0.0

Social channel providers are now package-per-provider like every other domain. This guide walks through adding a new social provider to Postmill. The system currently supports 36 social providers. Recent reference implementations include **Tumblr**, **Pixelfed**, and **PeerTube**.

## Step 1: Create a provider package

Create a new workspace package at `libraries/providers/<id>/` with the standard layout:

```
libraries/providers/yourprovider/
  package.json
  src/
    index.ts
    v1/
      index.ts
      metadata.ts
      social.adapter.ts
```

A minimal `package.json`:

```json
{
  "name": "@gitroom/provider-yourprovider",
  "version": "1.0.0",
  "private": true,
  "main": "src/index.ts",
  "types": "src/index.ts",
  "dependencies": {
    "@gitroom/provider-kernel": "workspace:*"
  },
  "license": "AGPL-3.0",
  "engines": {
    "node": ">=22.12.0 <23.0.0"
  },
  "scripts": {
    "test": "vitest run"
  }
}
```

## Step 2: Implement the provider class

Create `src/v1/social.adapter.ts`. Your class must extend `SocialAbstract` and implement `SocialProvider` from `@gitroom/provider-kernel`:

```typescript
import {
  SocialAbstract,
  SocialProvider,
  ClientInformation,
  GenerateAuthUrlResponse,
  AuthTokenDetails,
  PostDetails,
  PostResponse,
} from '@gitroom/provider-kernel';
import { Integration } from '@prisma/client';
import { metadata as providerMetadata } from './metadata';

export class YourProvider extends SocialAbstract implements SocialProvider {
  identifier = 'yourprovider';
  name = 'Your Provider';
  editor = 'normal' as const;
  scopes = ['scope1', 'scope2'];
  isBetweenSteps = false;
  maxConcurrentJob = 1;

  maxLength(additionalSettings?: any): number {
    return 500;
  }

  async generateAuthUrl(
    clientInformation?: ClientInformation
  ): Promise<GenerateAuthUrlResponse> {
    return {
      url: 'https://provider.com/oauth/authorize?...',
      codeVerifier: '<random-verifier>',
      state: '<random-state>',
    };
  }

  async authenticate(
    params: { code: string; codeVerifier: string; refresh?: string },
    clientInformation?: ClientInformation
  ): Promise<AuthTokenDetails | string> {
    return {
      id: '<account-id>',
      name: '<account-name>',
      accessToken: '<token>',
      refreshToken: '<refresh>',
      expiresIn: 3600,
      picture: '<avatar-url>',
      username: '<handle>',
    };
  }

  async refreshToken(
    refreshToken: string,
    clientInformation?: ClientInformation
  ): Promise<AuthTokenDetails> {
    // Refresh the access token
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration,
    clientInformation?: ClientInformation
  ): Promise<PostResponse[]> {
    return [
      {
        id: postDetails[0].id,
        postId: '<platform-post-id>',
        releaseURL: '<platform-url>',
        status: 'published',
      },
    ];
  }

  async checkValidity(
    posts: Array<{ path: string; thumbnail?: string }[]>,
    settings: any,
    additionalSettings: any[]
  ): Promise<string | true> {
    // Validate media count, size, dimensions
    return true;
  }
}
```

### Required properties

| Property | Type | Purpose |
|---|---|---|
| `identifier` | `string` | Unique provider id. Must match the package id and `metadata.id`. |
| `name` | `string` | Display name in the UI. |
| `editor` | `'none' \| 'normal' \| 'markdown' \| 'html'` | Composer editor mode. |
| `scopes` | `string[]` | OAuth scopes requested during connect. |
| `isBetweenSteps` | `boolean` | Whether the provider uses a two-step (app → page) flow. |
| `maxConcurrentJob` | `number` | Publish concurrency limit for this provider. |
| `maxLength` | `(additionalSettings?) => number` | Character limit for the composer. |
| `checkValidity` | `async (posts, settings, additionalSettings) => string \| true` | Server-side media/content validation. |

### Auth models

**OAuth 2.0** (most common): implement `generateAuthUrl`, `authenticate`, and optionally `refreshToken`.

**Custom fields** (API key, instance URL, etc.): implement `customFields()`:

```typescript
async customFields(): Promise<
  { key: string; label: string; defaultValue?: string; validation: string; type: 'text' | 'password' }[]
> {
  return [
    { key: 'apiKey', label: 'API Key', type: 'password', validation: '/^.+$/' },
    { key: 'instanceUrl', label: 'Instance URL', type: 'text', validation: '/^https?:\\/\\/.+$/' },
  ];
}
```

**Two-step providers** (app auth → page/company selection): set `isBetweenSteps = true` and implement either `pages()` or `companies()`.

### Post details

`postDetails` contains:

- `message` — post text.
- `media` — array of `{ type: 'image' | 'video', path, alt?, thumbnail?, thumbnailTimestamp? }`.
- `poll` — `{ options: string[], duration: number }` if polls are supported.
- `firstComment` — optional first comment text.
- `settings` — provider-specific settings.

### Token refresh / error handling

If the provider supports token refresh, handle it in `handleErrors()`:

```typescript
override handleErrors(body: string, status: number) {
  if (status === 401) {
    return { type: 'refresh-token', value: 'Retrying with refreshed token' };
  }
  return undefined;
}
```

The publish pipeline automatically handles `RefreshTokenError` by refreshing the token and retrying. Non-retryable provider errors such as `BadBodyError` stop retries and fail the post.

### Outbound HTTP

All outbound HTTP calls must use `this.fetch()` from `SocialAbstract` or `safeFetch` from `@gitroom/provider-kernel`. Never use bare `fetch()` — these provide SSRF protection and per-channel VPN egress support.

```typescript
import { safeFetch } from '@gitroom/provider-kernel';

const response = await safeFetch('https://api.provider.com/endpoint', {
  method: 'POST',
  headers: { Authorization: `Bearer ${accessToken}` },
  body: JSON.stringify(payload),
});
```

## Step 3: Export the provider module

At the bottom of `social.adapter.ts`, wrap the provider in a `ProviderModule` using `SocialProviderKernelAdapter`:

```typescript
import {
  ProviderModule,
  SocialProviderKernelAdapter,
  PROVIDER_CAPABILITIES,
} from '@gitroom/provider-kernel';

const adapter = new YourProvider();

export const yourproviderSocialModule: ProviderModule<any, any> = {
  metadata: providerMetadata,
  manifest: {
    domain: 'social',
    providerId: adapter.identifier,
    version: 'v1',
    displayName: adapter.name,
    status: 'active',
    credentialFields: [],
    capabilities: (PROVIDER_CAPABILITIES as any)[adapter.identifier] || {},
  },
  create: (ctx) => new SocialProviderKernelAdapter(adapter, ctx),
};
```

Export it from `src/v1/index.ts`:

```typescript
export { yourproviderSocialModule, YourProvider } from './social.adapter';
```

And from `src/index.ts`:

```typescript
export * from './v1';
import { yourproviderSocialModule } from './v1';
const yourproviderProviderModules = [yourproviderSocialModule];
export default yourproviderProviderModules;
```

## Step 4: Add metadata

Create `src/v1/metadata.ts`:

```typescript
import { ProviderMetadata } from '@gitroom/provider-kernel';

export const metadata: ProviderMetadata = {
  id: 'yourprovider',
  displayName: 'Your Provider',
  kind: 'action',
  domains: ['media'],
  hasModelList: false,
};
```

For social providers `kind` is usually `'action'` and `domains` is `['media']`.

## Step 5: Register in the provider capabilities matrix

Add an entry for the new provider in `libraries/providers/kernel/src/domains/social-capabilities.ts`:

```typescript
'yourprovider': {
  analytics: false,
  comments: false,
  firstComment: true,
  poll: false,
  video: false,
  carousel: false,
  altText: false,
  maxMedia: 4,
  linkPreview: false,
  refreshToken: false,
  watchlist: false,
  richText: true,
},
```

| Capability | Meaning |
|---|---|
| `analytics` | Provider supports fetching analytics data. |
| `comments` | Provider supports comment read/reply/like. |
| `firstComment` | Provider supports posting a first comment after the main post. |
| `poll` | Provider supports poll posts. |
| `video` | Provider supports video uploads. |
| `carousel` | Provider supports multi-image carousels. |
| `altText` | Provider supports alt text on images. |
| `maxMedia` | Maximum number of media items per post. |
| `linkPreview` | Provider generates link previews. |
| `refreshToken` | Provider supports token refresh. |
| `watchlist` | Provider supports public-metric probing for competitor tracking. |
| `richText` | Provider's editor supports links, bullets, and headings (`false` when absent means supported). |

## Step 6: Register in the kernel

Add the import to `apps/backend/src/providers.generated.ts`:

```typescript
import yourproviderModules from '@gitroom/provider-yourprovider';
```

And spread it into `providerModules`:

```typescript
export const providerModules: ProviderModule<any, any>[] = [
  // ...existing providers...
  ...yourproviderModules,
];
```

If your provider fits one of the generator templates, you can instead re-run `scripts/generate-provider-packages.mjs`.

## Step 7: Optional — implement social comments

If the provider supports comment reading/reply/liking, implement the optional `ISocialMediaComments` methods:

```typescript
commentsCapabilities = { read: true, reply: true, like: false };

async fetchComments(
  id: string,
  accessToken: string,
  postId: string,
  cursor: string | undefined,
  integration: Integration,
  clientInformation?: ClientInformation
): Promise<{ comments: SocialCommentDTO[]; nextCursor?: string }> {
  return { comments: [], nextCursor: undefined };
}

async replyToComment(/* ... */): Promise<SocialCommentDTO> { /* ... */ }

async likeComment(/* ... */): Promise<{ liked: boolean; likeCount?: number }> { /* ... */ }
```

## Step 8: Frontend composer component

Create a provider-specific editor component in `apps/frontend/src/components/new-launch/` (for example `yourprovider.component.tsx`). The component should render any provider-specific settings fields and integrate with the shared composer form. Register the component so the composer picks it up by `identifier`.

## Step 9: Provider icon

Add the provider's brand SVG icon to the frontend icon registry (`apps/frontend/src/components/shared/provider-icon.tsx` or the equivalent registry). The icon is referenced by `identifier` in channel lists and the composer.

## Step 10: Tests

Add a test file such as `src/v1/social.adapter.spec.ts` inside the provider package:

- Export a mock config.
- Test the auth flow.
- Test posting with various media types.
- Verify error handling.
- Add a kernel conformance test that asserts the package exports a `social/v1` module.

Use `vitest run --root libraries/providers/yourprovider` to run the package tests.

## Summary checklist

1. [ ] Create provider package `libraries/providers/<id>/`.
2. [ ] Implement provider class extending `SocialAbstract` and implementing `SocialProvider`.
3. [ ] Export a `ProviderModule` through `SocialProviderKernelAdapter`.
4. [ ] Add `src/v1/metadata.ts`.
5. [ ] Add an entry to `PROVIDER_CAPABILITIES` in the kernel.
6. [ ] Register the package in `apps/backend/src/providers.generated.ts`.
7. [ ] Optional: implement `ISocialMediaComments` for comment support.
8. [ ] Add frontend composer component and icon.
9. [ ] Use `this.fetch()` or `safeFetch` for all outbound HTTP.
10. [ ] Write tests.

See [Provider Framework](./provider-framework.md) for kernel architecture and [Provider Versions](./provider-versions.md) for the live catalog.
