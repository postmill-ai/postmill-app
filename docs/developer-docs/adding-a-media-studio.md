# Adding a media studio

Most generative media providers in Postmill are implemented through the **Studio Kit**: a descriptor-driven scaffold that lets you add a new `/media/<provider>` studio with a frontend descriptor, a backend adapter, and a route page. This page walks through the recipe using Qwen as the worked example.

For the bespoke studios that do not fit the kit — Designer, AI Designer, HeyGen, Replicate, and Deepgram — see their dedicated docs and source paths.

## What the Studio Kit provides

The kit is three shared pieces under `apps/frontend/src/components/media-tools/studio-kit/`:

- `studio-shell.tsx` — full-height studio chrome (header, tabs, fullscreen, render queue, not-configured landing).
- `studio-form.tsx` — renders descriptor fields and submits generation requests.
- `render-queue.tsx` — polls `/media/studio/:provider/jobs` and offers Edit in Designer / Post handoffs.

A new studio is mostly a **descriptor** plus a **backend adapter**. The generic `MediaStudioController` and `MediaStudioService` handle credentials, job creation, polling, and file storage — no per-provider controller code is required.

## Step 1: write the descriptor

Create `apps/frontend/src/components/media-tools/<provider>/descriptor.ts` and export a `StudioDescriptor`.

```ts
export interface StudioDescriptor {
  provider: string;        // registry/config identifier, e.g. 'qwen'
  title: string;           // shown in the studio header
  tabs: StudioTab[];
  landing?: StudioLanding; // "not configured yet" marketing content
}

export interface StudioTab {
  key: string;
  label: string;
  operation: 'video' | 'image' | 'audio';
  model?: string;          // fixed model id, or omit and add a select named 'model'
  description?: string;
  fields: StudioField[];
  custom?: React.ComponentType<StudioCustomProps>; // escape hatch
}
```

Field types:

| Type | Use |
|---|---|
| `prompt` | Primary generation prompt (required for most tabs). |
| `text` | Free-text native params such as `negative_prompt`. |
| `select` | Native enums; add `source: 'models'` to populate dynamically from `/media/studio/:provider/models`. |
| `number` | Numeric native params (`seed`, `duration`, etc.). |
| `toggle` | Boolean native params. |
| `media` | Source image/video/audio from `/files`; resolved server-side to a provider-reachable URL. |

Field names are the provider's **native API parameter names**. They are sent straight through to the adapter's `input` object, so the descriptor is the feature surface.

### Example: Qwen descriptor

```ts
export const qwenDescriptor: StudioDescriptor = {
  provider: 'qwen',
  title: 'Qwen',
  landing: {
    website: 'https://qwen.ai',
    tagline: "Alibaba's Qwen image & Wan video models",
    description: '...',
    badges: ['Image', 'Video'],
    highlights: ['...'],
  },
  tabs: [
    {
      key: 'text-to-image',
      label: 'Text → Image',
      operation: 'image',
      fields: [
        { type: 'select', name: 'model', label: 'Model', default: 'qwen-image-plus', options: [...] },
        { type: 'prompt', name: 'prompt', label: 'Prompt', required: true },
        { type: 'text', name: 'negative_prompt', label: 'Negative prompt' },
        { type: 'select', name: 'size', label: 'Size', default: '1328*1328', options: [...] },
        { type: 'toggle', name: 'prompt_extend', label: 'Prompt extend', default: true },
        { type: 'number', name: 'seed', label: 'Seed (optional)' },
      ],
    },
    {
      key: 'text-to-video',
      label: 'Text → Video',
      operation: 'video',
      fields: [
        { type: 'select', name: 'model', label: 'Model', default: 'wan2.2-t2v-plus', options: [...] },
        { type: 'prompt', name: 'prompt', label: 'Prompt', required: true },
        { type: 'select', name: 'size', label: 'Resolution', default: '1280*720', options: [...] },
        { type: 'number', name: 'duration', label: 'Duration (s)', min: 3, max: 10, step: 1, default: 5 },
      ],
    },
    {
      key: 'image-to-video',
      label: 'Image → Video',
      operation: 'video',
      fields: [
        { type: 'select', name: 'model', label: 'Model', default: 'wan2.2-i2v-plus', options: [...] },
        { type: 'media', name: 'img_url', label: 'Source image', accept: 'image', required: true },
        { type: 'prompt', name: 'prompt', label: 'Prompt' },
      ],
    },
  ],
};
```

## Step 2: implement the backend adapter

Create `libraries/providers/<provider>/src/v1/media.adapter.ts`. It must implement `MediaProviderAdapter` from `@gitroom/provider-kernel` and export a `ProviderModule`.

Required shape:

```ts
export interface MediaProviderAdapter {
  identifier: string;
  name: string;
  capabilities: MediaProviderCapabilities;
  credentialFields?: MediaCredentialField[];

  generateImage?(prompt: string, options: MediaGenerateOptions): Promise<MediaGenerationResult>;
  generateVideo?(prompt: string, options: MediaGenerateOptions): Promise<MediaJobSubmission>;
  generateAudio?(prompt: string, options: MediaGenerateOptions): Promise<MediaJobSubmission>;
  generateAvatar?(prompt: string, options: MediaGenerateOptions): Promise<MediaJobSubmission>;

  pollJob?(jobId: string, options: MediaCredentialOptions): Promise<MediaPollResult>;
  listModels?(operation: MediaOperation, options: MediaCredentialOptions): Promise<MediaModelOption[]>;
  testConnection?(options: MediaCredentialOptions): Promise<{ ok: boolean; message?: string }>;
}
```

Capability flags tell the UI which operations to offer:

```ts
interface MediaProviderCapabilities {
  image: boolean;
  video: boolean;
  audio: boolean;
  avatar: boolean;
  tts: boolean;
  stt: boolean;
  upscale: boolean;
  bgRemove: boolean;
  inpaint: boolean;
}
```

### Sync vs async completion

- **`image`** and **`audio`** are expected to complete synchronously (or via bounded internal polling). The adapter returns a finished artifact URL inline.
- **`video`** and **`avatar`** are usually async. Return `{ jobId }` and implement `pollJob`. The shared `MediaJobLifecycleService` drives completion via webhooks first, with `media-jobs-poll` as the fallback.

### Example: Qwen adapter

The Qwen adapter (`libraries/providers/qwen/src/v1/media.adapter.ts`) shows the typical pattern:

1. `generateImage` POSTs to DashScope with `X-DashScope-Async: enable`, then polls `GET /tasks/{id}` up to a bounded limit and returns the image URL.
2. `generateVideo` POSTs the same way but returns only `{ jobId }`; `pollJob` is invoked later by the lifecycle.
3. `pollJob` maps provider status strings (`SUCCEEDED`, `FAILED`, `CANCELED`, `UNKNOWN`) to the shared `MediaPollResult` shape.
4. `testConnection` hits a cheap read-only endpoint (the models list) so the settings test does not bill a render.

Key rules:

- Use the injected `_fetch` (a `SafeFetchPort`) for all outbound HTTP.
- Resolve API keys with `resolveApiKey(options)`.
- On transient poll errors (429, 5xx), **throw** so the lifecycle retries; on terminal errors, return `{ status: 'failed', error }`.

## Step 3: add provider metadata

Every provider package must ship `src/v1/metadata.ts` exporting a `ProviderMetadata` object. For media studios the relevant fields are:

```ts
export interface ProviderMetadata {
  id: string;
  displayName: string;
  kind: 'direct' | 'hub' | 'action';
  domains: Array<'ai' | 'media'>;
  mediaCategories?: string[];   // e.g. 'text-to-image', 'text-to-video'
  mediaModels?: Record<string, MediaModel[]>; // static fallback catalog
  hasModelList: boolean;
  website?: string;
  description?: { en: string };
}
```

`mediaModels` is the static fallback used when the adapter has no `listModels` or when the live catalog is empty. The categories must be subsets of the known `AI_MEDIA_CATEGORIES` union.

## Step 4: create the route page and studio component

Create a 3-line studio component:

```tsx
// apps/frontend/src/components/media-tools/qwen/qwen-studio.tsx
'use client';
import { StudioShell } from '@gitroom/frontend/components/media-tools/studio-kit/studio-shell';
import { qwenDescriptor } from './descriptor';

export function QwenStudio() {
  return <StudioShell descriptor={qwenDescriptor} />;
}
```

And a Next.js page that lazy-loads it with `ssr: false` (the kit uses browser-only APIs):

```tsx
// apps/frontend/src/app/(app)/(site)/media/qwen/page.tsx
'use client';
import dynamic from 'next/dynamic';

const QwenStudio = dynamic(
  () => import('@gitroom/frontend/components/media-tools/qwen/qwen-studio').then((m) => m.QwenStudio),
  { ssr: false }
);

export default function QwenPage() {
  return <QwenStudio />;
}
```

## Step 5: wire the provider package

1. Ensure `libraries/providers/<provider>/` has a workspace `package.json` depending on `@gitroom/provider-kernel`.
2. Export the media module from `libraries/providers/<provider>/src/index.ts` and `src/v1/index.ts`.
3. Import the module in `apps/backend/src/providers.generated.ts` (or re-run `scripts/generate-provider-packages.mjs` if you are extending the generated set).
4. Add the backend dependency in `apps/backend/package.json` if it is not already workspace-linked.

## Step 6: add the nav entry

Add the studio to `apps/frontend/src/app/(app)/(site)/media/layout.tsx` under the correct group (Providers or Content Pack). The layout is the source of truth for the `/media` navigation order.

## How the generic backend works

`MediaStudioController` serves every kit studio:

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/media/studio/:provider/status` | Configured/enabled state |
| `GET` | `/media/studio/:provider/models?operation=` | Dynamic model catalog (cached ~60s) |
| `POST` | `/media/studio/:provider/generate` | Start a generation |
| `GET` | `/media/studio/:provider/jobs` | Render queue + drive completion on read |

`MediaStudioService.generate`:

1. Checks the provider is enabled for the operation via `OrgMediaProviderSettingsService`.
2. Resolves credentials (with universal-credential fallbacks where configured).
3. Resolves `mediaInputs` file references to provider-reachable URLs using the org's storage adapter.
4. Lifts `model` out of the input and passes the rest as `options.input`.
5. Creates a pending `AIMediaJob`, calls the adapter (`generateImage`/`generateAudio`/`generateVideo`), and either completes synchronously or attaches a provider job id for polling.

`MediaStudioService.listJobs` drives completion on read with bounded concurrency, so local/private deployments without webhooks still advance the queue.

## Credential modes

Three patterns exist depending on the provider:

1. **Own-key provider** — configured at Settings → Media (e.g. Runway, Qwen can also be configured there). The adapter declares `credentialFields` (or a single `apiKey` field by default).
2. **Universal-credential provider** — reuses the org's existing Settings → AI key (e.g. Qwen, Google Gemini). `OrgMediaProviderSettingsService.getConfigForProvider` falls back to the AI config when no dedicated media credential exists.
3. **Multi-field credential** — for providers that need more than one secret, such as Vertex (`project`, `location`, `googleCredentials`) or Higgsfield (`keyId`, `keySecret`). Declare `credentialFields` in the adapter/metadata and the settings modal renders them dynamically.

## Dynamic model discovery

If the adapter implements `listModels(operation, options)`, the kit can populate a model dropdown at runtime instead of relying on the static descriptor options. To opt in, add a select field with `source: 'models'`:

```ts
{ type: 'select', name: 'model', source: 'models', label: 'Model' }
```

The combobox accepts typed model ids as well, so an incomplete provider catalog never blocks a render.

## When not to use the kit

Use a bespoke studio when the workflow does not match "form inputs → media artifact in `/files`":

- **Deepgram** returns text/captions, not a media artifact.
- **HeyGen** has structured multi-scene avatar video, talking-photo, voiceover, and translate workflows.
- **Replicate** exposes a large catalog of community models and video-editing operations.
- **Designer / AI Designer** are canvas tools, not generative providers.

## Testing a new studio

1. Configure the provider at Settings → AI or Settings → Media.
2. Open `/media/<provider>` and verify the landing, tabs, and fields render.
3. Run a generation for each `operation` and confirm the job lands in `/files`.
4. Verify Edit in Designer and Post handoffs work.
5. For async providers, confirm `media-jobs-poll` or the on-read poll completes the job.

## Related docs

- [Provider framework](./provider-framework.md)
- [Adding a provider](./adding-a-provider.md)
- [Adding an AI adapter](./adding-an-ai-adapter.md)
- [Designer internals](./designer.md)
- [User Guide: Media studios](../user-guide/media/index.md)
- [Backend conventions](./backend-conventions.md)

> Verified against v1.0.0
