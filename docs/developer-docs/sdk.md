# SDK

> Verified against v1.4.0

The `@postmill-ai/postmill-sdk` is the official Node.js SDK for the Postmill Public API. It provides typed methods for creating posts, uploading media, listing integrations, and more.

## Installation

```bash
npm install @postmill-ai/postmill-sdk
```

The SDK has no runtime dependencies: its request/response types are local mirrors of the public API DTOs (`apps/sdk/src/types.ts`), and it uses the global `fetch` implementation. The package declares `engines.node` `>=24.0.0 <25.0.0`.

## Quick start

```typescript
import Postmill from '@postmill-ai/postmill-sdk';

const client = new Postmill('your-api-key');

// Optionally specify a custom API base URL:
// const client = new Postmill('your-api-key', 'https://your-instance.com');

// Create a post
const post = await client.post({
  type: 'schedule',
  date: '2027-01-01T10:00:00Z',
  shortLink: false,
  tags: [],
  posts: [/* one entry per channel — see Public API v1 */],
});

// List posts (always paged as { posts, cursor })
const { posts, cursor } = await client.postList({
  startDate: '2027-01-01T00:00:00Z',
  endDate: '2027-01-31T23:59:59Z',
});

// List integrations
const integrations = await client.integrations();

// Upload media
const media = await client.upload(fileBuffer, 'png');

// Delete a post
await client.deletePost('post-id');
```

## API reference

### Constructor

```typescript
new Postmill(apiKey: string, path?: string)
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `apiKey` | `string` | required | Org API key (sent as `Authorization` header). |
| `path` | `string` | `https://api.postmill.ai` | Custom API base URL for self-hosted instances. |

### Methods

#### `post(posts)`

Create one or more posts.

```typescript
post(posts: CreatePostDto): Promise<unknown>
```

- **Endpoint**: `POST /public/v1/posts`
- **Body**: `CreatePostDto` (`type`, `date`, `shortLink`, `tags`, `posts`, optional `campaignId`/`brandId`, etc.)
- **Returns**: Created post data

#### `postList(filters)`

List posts with optional filters.

```typescript
postList(filters: GetPostsDto): Promise<PostListResponse>
```

- **Endpoint**: `GET /public/v1/posts`
- **Query**: `GetPostsDto` (`startDate`, `endDate`, optional `limit`, `cursor`, `display`)
- **Returns**: `{ posts, cursor }` — `cursor` is the offset of the next page, `null` on the last page

#### `upload(file, extension)`

Upload a media file for use in posts.

```typescript
upload(file: BlobPart | Buffer, extension: string): Promise<unknown>
```

- **Endpoint**: `POST /public/v1/upload`
- **Content-Type**: `multipart/form-data`
- **Extensions**: `png`, `jpg`/`jpeg`, `gif` set the matching MIME type; anything else is sent as `image/jpeg`
- **Returns**: Saved media metadata

#### `integrations()`

List all connected channel integrations.

```typescript
integrations(): Promise<unknown>
```

- **Endpoint**: `GET /public/v1/integrations`
- **Returns**: List of connected integrations

#### `deletePost(id)`

Delete a post by ID.

```typescript
deletePost(id: string): Promise<Response>
```

- **Endpoint**: `DELETE /public/v1/posts/:id`
- **Returns**: Raw `Response` object

#### Other methods

| Method | Endpoint |
|---|---|
| `uploadFromUrl(url)` | `POST /public/v1/upload-from-url` |
| `findSlot(integrationId?)` | `GET /public/v1/find-slot/:id` |
| `deletePostGroup(group)` | `DELETE /public/v1/posts/group/:group` |
| `changePostStatus(id, { status })` | `PUT /public/v1/posts/:id/status` |
| `updateReleaseId(id, { releaseId })` | `PUT /public/v1/posts/:id/release-id` |
| `postMissingContent(id)` | `GET /public/v1/posts/:id/missing` |
| `isConnected()` | `GET /public/v1/is-connected` |
| `connectChannel(integration, opts?)` | `GET /public/v1/social/:integration` — requires an explicit version (`"x@v1"` or `opts.version`); throws before any request otherwise |
| `deleteChannel(id)` | `DELETE /public/v1/integrations/:id` |
| `integrationSettings(id)` | `GET /public/v1/integration-settings/:id` |
| `triggerIntegrationTool(id, body)` | `POST /public/v1/integration-trigger/:id` |
| `notifications(page?)` | `GET /public/v1/notifications` |
| `generateVideo(body)` / `getVideoJob(id)` | `POST /public/v1/generate-video`, `GET /public/v1/generate-video/:id` |
| `generateVideoAndWait(body, opts?)` | Starts a video job and polls until `completed`/`failed` (defaults: 3 s interval, 5 min timeout) |
| `loadVoices(identifier)` | `POST /public/v1/video/function` |

## API key setup

1. Go to **Settings → Developers** in the Postmill app.
2. Create an API key or use an existing org key.
3. Pass the key as the first argument to the `Postmill` constructor.

## Package details

- **Package name**: `@postmill-ai/postmill-sdk`
- **Version**: 2.0.1
- **License**: AGPL-3.0
- **Build**: Uses `tsup` for bundling.
- **Dependencies**: none at runtime (types are local to `apps/sdk/src/types.ts`)

## Analytics access

The SDK's analytics methods — `analyticsOverview(query)`, `campaignAnalytics(id, query?)`, and `anomalies(query?)` — target the unified analytics surface (`/public/v1/analytics/*`). Routes without a dedicated SDK method (best-time, export, watchlist, alert rules, etc.) can be called directly over HTTP against the same surface; see the [Analytics API](./analytics-api.md) reference.

See [Public API v1](./public-api.md) for the full REST reference.
