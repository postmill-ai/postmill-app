# SDK

> Verified against v1.0.0

The `@postmill-ai/postmill-sdk` is the official Node.js SDK for the Postmill Public API. It provides typed methods for creating posts, uploading media, listing integrations, and more.

## Installation

```bash
npm install @postmill-ai/postmill-sdk
```

The SDK depends on `@gitroom/nestjs-libraries` for DTO types and uses the global `fetch` implementation (Node 18+, or a polyfill in older environments).

## Quick start

```typescript
import Postmill from '@postmill-ai/postmill-sdk';

const client = new Postmill('your-api-key');

// Optionally specify a custom API base URL:
// const client = new Postmill('your-api-key', 'https://your-instance.com');

// Create a post
const post = await client.post({
  integrations: [{ id: 'integration-id' }],
  value: [{ message: 'Hello from the SDK!' }],
  scheduledAt: new Date(),
});

// List posts
const posts = await client.postList({ page: 1 });

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
| `path` | `string` | `https://api.postiz.com` | Custom API base URL for self-hosted instances. |

### Methods

#### `post(posts)`

Create one or more posts.

```typescript
post(posts: CreatePostDto): Promise<any>
```

- **Endpoint**: `POST /public/v1/posts`
- **Body**: `CreatePostDto` (`integrations`, `value`, `scheduledAt`, etc.)
- **Returns**: Created post data

#### `postList(filters)`

List posts with optional filters.

```typescript
postList(filters: GetPostsDto): Promise<any>
```

- **Endpoint**: `GET /public/v1/posts`
- **Query**: `GetPostsDto` (`page`, `filters`, etc.)
- **Returns**: Paginated post list

#### `upload(file, extension)`

Upload a media file for use in posts.

```typescript
upload(file: BlobPart | Buffer, extension: string): Promise<any>
```

- **Endpoint**: `POST /public/v1/upload`
- **Content-Type**: `multipart/form-data`
- **Supported extensions**: `png`, `jpg`, `jpeg`, `gif`
- **Returns**: Saved media metadata

#### `integrations()`

List all connected channel integrations.

```typescript
integrations(): Promise<any>
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

## API key setup

1. Go to **Settings → Developers** in the Postmill app.
2. Create an API key or use an existing org key.
3. Pass the key as the first argument to the `Postmill` constructor.

## Package details

- **Package name**: `@postmill-ai/postmill-sdk`
- **Version**: 1.0.0
- **License**: AGPL-3.0
- **Build**: Uses `tsup` for bundling.
- **Workspace dependency**: `@gitroom/nestjs-libraries`

## Analytics access

The SDK does not currently expose analytics methods. For analytics data (overview, per-post, per-channel, best-time recommendations), use the [Analytics API v2](./analytics-api.md) endpoints directly via HTTP.

See [Public API v1](./public-api.md) for the full REST reference.
