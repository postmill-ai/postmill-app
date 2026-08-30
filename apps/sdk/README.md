# Postmill NodeJS SDK

This is the NodeJS SDK for [Postmill](https://postmill.ai).

You can start by installing the package:

```bash
npm install @postmill-ai/postmill-sdk
```

## Usage

```typescript
import Postmill from '@postmill-ai/postmill-sdk';

const postmill = new Postmill('your api key', 'your self-hosted instance (optional)');
```

The second constructor argument is optional and defaults to `https://api.postmill.ai`. Pass your own base URL when self-hosting.

## Available methods

### Posts
- `post(posts: CreatePostDto)` — Schedule a post to Postmill
- `postList(filters: GetPostsDto)` — Get a page of posts (always returns `{ posts, cursor }`; `cursor` is `null` on the last page)
- `deletePost(id: string)` — Delete a post by ID
- `deletePostGroup(group: string)` — Delete all posts in a group
- `changePostStatus(id: string, status: ChangePostStatusDto)` — Change a post's status (`draft` or `schedule`)
- `updateReleaseId(id: string, releaseId: UpdateReleaseIdDto)` — Update the release id of a post
- `postMissingContent(id: string)` — Get missing content for a post

### Channels / integrations
- `integrations(group?: string)` — Get a list of connected channels, optionally filtered by group
- `connectChannel(integration: string, opts?: { refresh?: string; version?: string })` — Generate an OAuth URL to connect a channel. **An explicit provider version is required**: pass the integration as `"providerId@version"` (e.g. `"x@v1"`) or set `opts.version`; the SDK throws before any request otherwise.
- `deleteChannel(id: string)` — Delete a connected channel
- `integrationSettings(id: string)` — Get settings and rules for a channel
- `isConnected()` — Check whether the organization has any connected channels
- `groups()` — List integration groups

### Media
- `upload(file: BlobPart | Buffer, extension: string)` — Upload a file to Postmill
- `uploadFromUrl(url: string)` — Import a file from a public URL
- `generateVideo(body: VideoDto)` — Start an async video generation job
- `getVideoJob(id: string)` — Poll the status of a video generation job
- `generateVideoAndWait(body: VideoDto, opts?)` — Start a video job and poll until it completes or fails
- `loadVoices(identifier: string)` — Load available voices for a video provider

### Analytics
- `analyticsOverview({ from, to, integrations?, compare? })` — Get an analytics overview
- `campaignAnalytics(id, { from?, to? })` — Get analytics for a campaign
- `anomalies({ limit?, includeDismissed? })` — List anomaly alerts

> **Removed in v2.0.0:** `channelAnalytics()` and `postAnalytics()` were
> deleted — the `GET /public/v1/analytics/:integration` and
> `/analytics/post/:postId` routes no longer exist. The replacement analytics
> API is cookie-session based, not API-key based, and is therefore out of SDK
> scope.

### Utilities
- `findSlot(integrationId?: string)` — Find the next free publishing slot
- `notifications(page?: number)` — Get paginated notifications
- `triggerIntegrationTool(id: string, body: TriggerIntegrationToolDto)` — Trigger a tool on an integration

## Async video generation example

```typescript
const job = await postmill.generateVideoAndWait({
  type: 'text-to-video',
  output: 'vertical',
  customParams: { prompt: 'A calm ocean sunset' },
});

if (job.status === 'completed') {
  console.log('Video URL:', job.artifactUrl);
} else {
  console.error('Video failed:', job.error);
}
```

Alternatively you can use the SDK with curl, check the [Postmill API documentation](https://docs.postmill.ai/public-api) for more information.
