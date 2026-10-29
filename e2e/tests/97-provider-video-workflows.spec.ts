import { test, expect, type Page, type Route } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const DESIGN_ID = 'provider-video-workflows-e2e';
const PROMPT = 'A presenter walks through a sunlit studio';
const REELFARM_VIDEO_URL = '/mock-storage/reelfarm-completed.mp4';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwAEhgGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

interface StudioJob {
  id: string;
  operation: string;
  model?: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  artifactUrl: string | null;
  fileId: string | null;
  fileType: string | null;
  error: string | null;
  createdAt: string;
  metadata?: {
    dimensions?: { width: number; height: number };
    durationMs?: number;
    mime?: string;
  };
}

const apiPath = (rawUrl: string): string => {
  const pathname = new URL(rawUrl).pathname;
  return pathname.startsWith('/api/') ? pathname.slice(4) : pathname;
};

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });

const fileItem = (id: string, name: string) => ({
  id,
  name,
  originalName: name,
  path: `/mock-storage/${name}`,
  thumbnail: `/mock-storage/${name}`,
  alt: null,
  thumbnailTimestamp: null,
  fileSize: PNG.length,
  type: 'image/png',
  tags: null,
  description: null,
  folderId: null,
  createdAt: '2026-10-27T12:00:00.000Z',
  metadata: { dimensions: { width: 1, height: 1 } },
});

const FILES = [
  fileItem('file-subject', 'subject-portrait.png'),
  fileItem('file-reference-1', 'reference-one.png'),
  fileItem('file-reference-2', 'reference-two.png'),
  fileItem('file-reference-3', 'reference-three.png'),
  fileItem('file-reference-4', 'reference-four.png'),
];

class ProviderWorkflowMocks {
  private readonly posts = new Map<string, Record<string, unknown>[]>();
  private readonly generationErrors = new Map<string, Record<string, unknown>>();
  private readonly asyncFailures = new Map<string, { error: string; afterPoll: number }>();
  private readonly jobPolls = new Map<string, number>();
  private readonly jobs: Record<string, StudioJob[]> = {
    fal: [],
    kling: [],
    minimax: [],
    elevenlabs: [],
    reelfarm: [
      {
        id: 'reelfarm-completed-e2e',
        operation: 'video',
        model: 'slideshow',
        status: 'completed',
        artifactUrl: REELFARM_VIDEO_URL,
        fileId: 'file-reelfarm-completed',
        fileType: 'video',
        error: null,
        createdAt: '2026-10-27T12:00:00.000Z',
        metadata: { dimensions: { width: 720, height: 1280 }, durationMs: 4000, mime: 'video/mp4' },
      },
    ],
  };
  private doc: Record<string, unknown> = {
    version: 8,
    mode: 'video',
    outputs: [{ width: 1080, height: 1920, durationMs: 10_000, tracks: [] }],
  };
  private designName = 'Provider video workflows E2E';
  readonly unexpectedGenerationPosts: string[] = [];
  readonly externalProviderCalls: string[] = [];

  failGeneration(provider: string, body: Record<string, unknown>) {
    this.generationErrors.set(provider, body);
  }

  failAsyncJob(provider: string, error: string, afterPoll = 3) {
    this.asyncFailures.set(provider, { error, afterPoll });
  }

  async install(page: Page) {
    await page.context().route('**/*', async (route) => {
      const request = route.request();
      const method = request.method();
      const url = new URL(request.url());
      const pathname = apiPath(request.url());

      if (
        /^(api\.minimax\.io|api\.replicate\.com|api\.heygen\.com|api\.klingai\.com|api\.fal\.ai|queue\.fal\.run|api\.elevenlabs\.io|api\.reel\.farm)$/.test(
          url.hostname
        )
      ) {
        this.externalProviderCalls.push(`${method} ${url.href}`);
        await json(route, { message: 'External provider access blocked by E2E' }, 503);
        return;
      }
      if (url.hostname === 'www.gravatar.com') {
        await route.fulfill({ status: 204 });
        return;
      }
      if (url.hostname.endsWith('.ingest.us.sentry.io')) {
        await json(route, {});
        return;
      }
      if (pathname === REELFARM_VIDEO_URL && method === 'GET') {
        await fulfillVideo(route);
        return;
      }
      if (pathname.startsWith('/mock-storage/') && method === 'GET') {
        await route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
        return;
      }

      if (method === 'GET' && pathname === '/user/self') {
        await json(route, {
          id: 'e2e-user',
          email: 'qa@example.test',
          orgId: 'e2e-org',
          role: 'owner',
          isSuperAdmin: true,
          activated: true,
          setupCompleted: true,
          profile: {},
        });
        return;
      }
      if (method === 'GET' && pathname === '/settings/roles/me') {
        await json(route, { role: 'owner', permissions: [], isSuperAdmin: true });
        return;
      }
      if (method === 'GET' && pathname === '/user/organizations') {
        await json(route, [{ id: 'e2e-org', name: 'E2E Org', users: [{ disabled: false }] }]);
        return;
      }
      if (method === 'GET' && ['/announcements', '/notifications', '/brands', '/integrations/list'].includes(pathname)) {
        await json(route, []);
        return;
      }
      if (method === 'GET' && ['/settings/media/config', '/settings/ai/config', '/media/fonts'].includes(pathname)) {
        await json(route, pathname === '/media/fonts' ? [] : {});
        return;
      }

      if (pathname === '/media/tools/status' && method === 'GET') {
        await json(route, {
          operations: { tts: { available: true }, stt: { available: true } },
          tools: Object.fromEntries(
            [
              'text-to-video',
              'image-to-video',
              'video-upscale',
              'video-background',
              'video-to-video',
              'text-to-music',
              'video-avatar',
              'image-slide',
            ].map((tool) => [tool, { available: true }])
          ),
        });
        return;
      }
      if (pathname === '/dashboard/media-jobs' && method === 'GET') {
        await json(route, { jobs: [] });
        return;
      }
      if (pathname === '/media/designs' && method === 'POST') {
        const body = request.postDataJSON() as { name?: string; doc: Record<string, unknown> };
        this.designName = body.name ?? this.designName;
        this.doc = body.doc;
        await json(route, { id: DESIGN_ID, name: this.designName, doc: this.doc });
        return;
      }
      if (pathname === `/media/designs/${DESIGN_ID}` && method === 'GET') {
        await json(route, { id: DESIGN_ID, name: this.designName, doc: this.doc });
        return;
      }
      if (pathname === `/media/designs/${DESIGN_ID}` && method === 'PUT') {
        const body = request.postDataJSON() as { name?: string; doc: Record<string, unknown> };
        this.designName = body.name ?? this.designName;
        this.doc = body.doc;
        await json(route, { id: DESIGN_ID, name: this.designName, doc: this.doc });
        return;
      }
      if (pathname === '/media/generation-providers' && method === 'GET') {
        const avatar = url.searchParams.get('operation') === 'avatar';
        await json(route, {
          providers: avatar
            ? [{ identifier: 'heygen', name: 'HeyGen' }]
            : [
                { identifier: 'fal', name: 'fal.ai' },
                { identifier: 'kling', name: 'Kling AI' },
                { identifier: 'minimax', name: 'MiniMax' },
                { identifier: 'elevenlabs', name: 'ElevenLabs' },
                { identifier: 'replicate', name: 'Replicate' },
                { identifier: 'heygen', name: 'HeyGen' },
              ],
          default: { providerId: 'fal', model: 'kling-2.1' },
        });
        return;
      }

      const studioStatus = /^\/media\/studio\/(fal|kling|minimax|elevenlabs|reelfarm)\/status$/.exec(pathname);
      if (studioStatus && method === 'GET') {
        await json(route, { configured: true, enabled: true });
        return;
      }
      if (pathname === '/media/studio/kling/models' && method === 'GET') {
        await json(route, []);
        return;
      }
      const studioJobs = /^\/media\/studio\/(fal|kling|minimax|elevenlabs|reelfarm)\/jobs$/.exec(pathname);
      if (studioJobs && method === 'GET') {
        const provider = studioJobs[1];
        const poll = (this.jobPolls.get(provider) ?? 0) + 1;
        this.jobPolls.set(provider, poll);
        const failure = this.asyncFailures.get(provider);
        if (failure && poll >= failure.afterPoll) {
          for (const job of this.jobs[provider]) {
            if (job.status === 'pending' || job.status === 'processing') {
              job.status = 'failed';
              job.error = failure.error;
            }
          }
        }
        await json(route, this.jobs[provider]);
        return;
      }
      if (pathname === '/media/heygen/status' && method === 'GET') {
        await json(route, { configured: true });
        return;
      }
      if (pathname === '/media/heygen/voices' && method === 'GET') {
        await json(route, { voices: [{ voiceId: 'voice-e2e', name: 'E2E voice' }] });
        return;
      }
      if (pathname === '/media/voices' && method === 'GET') {
        await json(route, [{ id: 'voice-e2e', label: 'E2E voice' }]);
        return;
      }

      if (pathname === '/media/replicate/status' && method === 'GET') {
        await json(route, { configured: true });
        return;
      }
      if (pathname === '/media/replicate/categories' && method === 'GET') {
        await json(route, [
          { key: 'text-to-video', medium: 'video', label: 'Text to Video', execution: 'async' },
          { key: 'image-to-video', medium: 'video', label: 'Image to Video', execution: 'async' },
        ]);
        return;
      }
      if (/^\/media\/replicate\/categories\/(text|image)-to-video\/models$/.test(pathname) && method === 'GET') {
        await json(route, [
          {
            id: 'google/veo-3.1',
            name: 'Veo 3.1',
            description: '',
            coverImageUrl: null,
            runCount: 1,
            warm: true,
            pricing: 'usage',
            price: null,
          },
        ]);
        return;
      }
      if (pathname === '/media/replicate/models/google/veo-3.1' && method === 'GET') {
        await json(route, {
          id: 'google/veo-3.1',
          name: 'Veo 3.1',
          coverImageUrl: null,
          warm: true,
          versionId: 'veo-e2e-version',
          inputSchema: {
            required: ['prompt'],
            properties: {
              prompt: { type: 'string', title: 'Prompt' },
              aspect_ratio: {
                type: 'string',
                title: 'Aspect ratio',
                enum: ['16:9', '9:16'],
                default: '16:9',
              },
              duration: { type: 'integer', title: 'Duration', enum: [4, 6, 8], default: 6 },
              reference_images: {
                type: 'array',
                title: 'References',
                items: { type: 'string', format: 'uri' },
              },
            },
          },
        });
        return;
      }
      if (pathname === '/media/replicate/jobs/replicate-e2e-job' && method === 'GET') {
        await json(route, { status: 'processing', result: null, error: null });
        return;
      }

      if (pathname === '/files/folders' && method === 'GET') {
        await json(route, []);
        return;
      }
      if (pathname === '/files' && method === 'GET') {
        await json(route, { results: FILES, pages: 1 });
        return;
      }

      const studioGenerate = /^\/media\/studio\/(fal|kling|minimax|elevenlabs)\/generate$/.exec(pathname);
      if (method === 'POST' && (studioGenerate || pathname === '/media/replicate/run/async')) {
        const body = request.postDataJSON() as Record<string, unknown>;
        const bodies = this.posts.get(pathname) ?? [];
        bodies.push(body);
        this.posts.set(pathname, bodies);
        if (pathname === '/media/replicate/run/async') {
          await json(route, { jobId: 'replicate-e2e-job' });
          return;
        }
        const provider = studioGenerate![1];
        const generationError = this.generationErrors.get(provider);
        if (generationError) {
          await json(route, generationError, 502);
          return;
        }
        const jobId = `${provider}-e2e-job`;
        this.jobs[provider].push({
          id: jobId,
          operation: 'video',
          model: String(body.model),
          status: 'processing',
          artifactUrl: null,
          fileId: null,
          fileType: null,
          error: null,
          createdAt: '2026-10-27T12:00:00.000Z',
        });
        await json(route, { jobId });
        return;
      }

      if (
        method === 'POST' &&
        (/^\/media\/studio\/[^/]+\/generate$/.test(pathname) ||
          /^\/media\/generate-/.test(pathname) ||
          /^\/media\/replicate\/run\//.test(pathname) ||
          pathname === '/media/heygen/talking-photo')
      ) {
        this.unexpectedGenerationPosts.push(`${method} ${pathname}`);
        await json(route, { message: 'Unexpected generation POST blocked by E2E' }, 503);
        return;
      }

      const backendOrigin = process.env.E2E_BACKEND_ORIGIN;
      const backend = backendOrigin ? new URL(backendOrigin) : null;
      if (backend && (url.origin === 'https://api.postmill.ai' || url.origin === backend.origin)) {
        if (backend.protocol !== 'http:' || !['localhost', '127.0.0.1', '::1'].includes(backend.hostname)) {
          throw new Error('E2E_BACKEND_ORIGIN must be a loopback HTTP origin');
        }
        const headers = { ...request.headers() };
        delete headers.host;
        delete headers['content-length'];
        const localCookies = await page.context().cookies(page.url());
        headers.cookie = localCookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
        const response = await fetch(`${backendOrigin}${pathname}${url.search}`, {
          method,
          headers,
          body: request.postDataBuffer() ?? undefined,
        });
        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(key)) {
            responseHeaders[key] = value;
          }
        });
        if (headers.origin) responseHeaders['access-control-allow-origin'] = headers.origin;
        responseHeaders['access-control-allow-credentials'] = 'true';
        await route.fulfill({
          status: response.status,
          headers: responseHeaders,
          body: Buffer.from(await response.arrayBuffer()),
        });
        return;
      }

      await route.continue();
    });
  }

  bodies(pathname: string): Record<string, unknown>[] {
    return this.posts.get(pathname) ?? [];
  }

  generationCount(): number {
    return [...this.posts.values()].reduce((count, bodies) => count + bodies.length, 0) + this.unexpectedGenerationPosts.length;
  }

  savedClips(): Record<string, unknown>[] {
    const outputs = this.doc.outputs as Array<{ tracks: Array<{ clips: Record<string, unknown>[] }> }>;
    return outputs[0].tracks.flatMap((track) => track.clips);
  }

  expectNoExternalProviders() {
    expect(this.externalProviderCalls, 'no browser-to-provider calls').toEqual([]);
    expect(this.unexpectedGenerationPosts, 'no unmocked generation POSTs').toEqual([]);
  }
}

async function fulfillVideo(route: Route) {
  const body = fs.readFileSync(path.join(__dirname, '../fixtures/motion-rear-moov.mp4'));
  const range = route.request().headers()['range'];
  const headers = {
    'accept-ranges': 'bytes',
    'content-type': 'video/mp4',
    'cache-control': 'no-store',
  };
  if (!range) {
    await route.fulfill({ status: 200, headers, body });
    return;
  }
  const match = /^bytes=(\d+)-(\d*)$/.exec(range);
  const start = match ? Number(match[1]) : -1;
  const end = match ? Math.min(match[2] ? Number(match[2]) : body.length - 1, body.length - 1) : -1;
  if (start < 0 || start >= body.length || end < start) {
    await route.fulfill({ status: 416, headers: { 'content-range': `bytes */${body.length}` } });
    return;
  }
  await route.fulfill({
    status: 206,
    headers: { ...headers, 'content-range': `bytes ${start}-${end}/${body.length}` },
    body: body.subarray(start, end + 1),
  });
}

async function expectPreviewPlayback(page: Page) {
  const video = page.getByLabel('Generated video preview', { exact: true });
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(2);
  expect(await video.evaluate((element: HTMLVideoElement) => element.videoWidth)).toBeGreaterThan(0);
  const before = await video.evaluate((element: HTMLVideoElement) => element.currentTime);
  await video.click();
  await video.evaluate((element: HTMLVideoElement) => element.play());
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(before + 0.25);
  await video.evaluate((element: HTMLVideoElement) => {
    element.pause();
    element.currentTime = Math.min(1, element.duration / 2);
  });
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0.5);
}

async function openDesigner(page: Page) {
  await page.goto(`/media/designer?designId=${DESIGN_ID}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'AI Video', exact: true })).toBeEnabled({ timeout: 90_000 });
}

async function openVideoDialog(page: Page) {
  await page.getByRole('button', { name: 'AI Video', exact: true }).click();
  await expect(page.getByPlaceholder('Describe the video you want to generate...')).toBeVisible();
}

async function chooseKlingModel(page: Page) {
  const model = page.getByLabel('Model', { exact: true });
  await model.fill('Kling 2.6');
  await page.getByRole('button', { name: 'Kling 2.6', exact: true }).click();
}

async function pickFile(page: Page, name: string) {
  const picker = page.getByTestId('media-picker');
  await expect(picker).toBeVisible();
  await picker.getByRole('button', { name: new RegExp(name.replace('.', '\\.')) }).click();
}

test.describe('Provider video workflows (network stubbed)', () => {
  test('full-page fal Pika 2.2 submits the current duration string once without mount, tab, or reload generation', async ({ page }) => {
    const mocks = new ProviderWorkflowMocks();
    await mocks.install(page);
    await page.goto('/media/fal', { waitUntil: 'domcontentloaded' });
    const generate = page.getByRole('button', { name: 'Generate', exact: true });
    await expect(generate).toBeVisible({ timeout: 90_000 });
    expect(mocks.generationCount(), 'studio mount must not generate').toBe(0);
    await expect(page.getByText(/pikaffects/i)).toHaveCount(0);

    await page.getByRole('tab', { name: 'Pika Text → Video', exact: true }).click();
    await expect(page.getByLabel('Duration', { exact: true })).toHaveValue('5');
    expect(mocks.generationCount(), 'selecting Pika must not generate').toBe(0);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(generate).toBeVisible({ timeout: 90_000 });
    expect(mocks.generationCount(), 'studio reload must not generate').toBe(0);
    await page.getByRole('tab', { name: 'Pika Text → Video', exact: true }).click();
    await page.getByLabel('Prompt', { exact: true }).fill(PROMPT);
    await page.getByLabel('Duration', { exact: true }).selectOption('10');
    await expect(page.getByLabel('Duration', { exact: true })).toHaveValue('10');
    expect(mocks.generationCount(), 'form edits must not generate').toBe(0);

    await generate.click();
    await expect.poll(() => mocks.bodies('/media/studio/fal/generate').length).toBe(1);
    expect(mocks.bodies('/media/studio/fal/generate')[0]).toEqual({
      operation: 'video',
      model: 'fal-ai/pika/v2.2/text-to-video',
      input: { prompt: PROMPT, aspect_ratio: '16:9', resolution: '720p', duration: '10' },
    });
    expect(mocks.generationCount(), 'exactly one explicit Generate POST').toBe(1);
    mocks.expectNoExternalProviders();
  });

  test('standalone Pika 2.2 requires source media and submits image-to-video duration as a form string', async ({ page }) => {
    const mocks = new ProviderWorkflowMocks();
    await mocks.install(page);
    await page.goto('/media/pika', { waitUntil: 'domcontentloaded' });
    const generate = page.getByRole('button', { name: 'Generate', exact: true });
    await expect(generate).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText(/pikaffects/i)).toHaveCount(0);
    expect(mocks.generationCount(), 'Pika mount must not generate').toBe(0);

    await page.getByRole('tab', { name: 'Image → Video', exact: true }).click();
    await page.getByLabel('Prompt', { exact: true }).fill(PROMPT);
    await page.getByLabel('Duration', { exact: true }).selectOption('10');
    await expect(generate).toBeDisabled();
    expect(mocks.generationCount(), 'missing source image must not submit').toBe(0);

    await page.getByRole('button', { name: 'Choose image…', exact: true }).click();
    await pickFile(page, 'subject-portrait.png');
    await expect(page.getByTestId('media-picker')).toHaveCount(0);
    await expect(generate).toBeEnabled();
    expect(mocks.generationCount(), 'source selection must not auto-generate').toBe(0);

    await generate.click();
    await expect.poll(() => mocks.bodies('/media/studio/fal/generate').length).toBe(1);
    expect(mocks.bodies('/media/studio/fal/generate')[0]).toEqual({
      operation: 'video',
      model: 'fal-ai/pika/v2.2/image-to-video',
      input: { prompt: PROMPT, resolution: '720p', duration: '10' },
      mediaInputs: { image_url: 'file-subject' },
    });
    expect(mocks.generationCount(), 'exactly one explicit Generate POST').toBe(1);
    mocks.expectNoExternalProviders();
  });

  test('MiniMax generic I2V submits the selected first frame without disturbing S2V', async ({ page }) => {
    const mocks = new ProviderWorkflowMocks();
    await mocks.install(page);
    await openDesigner(page);
    await openVideoDialog(page);

    await page.getByLabel('Provider:').selectOption('minimax');
    await page.getByRole('tab', { name: 'Image → Video', exact: true }).click();
    await expect(page.getByLabel('Model', { exact: true })).toHaveValue('I2V-01');
    await page.getByPlaceholder('Describe the video you want to generate...').fill(PROMPT);
    const generate = page.getByRole('button', { name: 'Generate', exact: true });
    await expect(generate).toBeDisabled();
    await page.getByRole('button', { name: 'Choose image…', exact: true }).click();
    await pickFile(page, 'subject-portrait.png');
    await expect(generate).toBeEnabled();
    expect(mocks.generationCount(), 'first-frame selection must not auto-generate').toBe(0);

    await generate.click();
    await expect.poll(() => mocks.bodies('/media/studio/minimax/generate').length).toBe(1);
    expect(mocks.bodies('/media/studio/minimax/generate')[0]).toEqual({
      operation: 'video',
      model: 'I2V-01',
      input: { model: 'I2V-01', prompt_optimizer: true, prompt: PROMPT },
      mediaInputs: { first_frame_image: 'file-subject' },
    });
    mocks.expectNoExternalProviders();
  });

  for (const scenario of [
    {
      provider: 'fal',
      providerName: 'fal.ai',
      kind: 'quota',
      upstreamStatus: 429,
      message: 'fal.ai rejected the request: fal account quota exhausted',
    },
    {
      provider: 'minimax',
      providerName: 'MiniMax',
      kind: 'quota',
      upstreamStatus: 402,
      message: 'MiniMax rejected the request: account balance is insufficient',
    },
    {
      provider: 'kling',
      providerName: 'Kling AI',
      kind: 'quota',
      upstreamStatus: 402,
      message: 'Kling AI rejected the request: resource pack exhausted',
    },
    {
      provider: 'elevenlabs',
      providerName: 'ElevenLabs',
      kind: 'invalid_request',
      upstreamStatus: 402,
      message: 'ElevenLabs rejected the request: video generation requires a paid plan',
    },
  ]) {
    test(`${scenario.providerName} 502 stays provider-attributed in compact Designer without retry or clip insertion`, async ({ page }) => {
      const mocks = new ProviderWorkflowMocks();
      mocks.failGeneration(scenario.provider, {
        error: 'ProviderUpstreamError',
        provider: scenario.provider,
        providerName: scenario.providerName,
        domain: 'media',
        operation: 'video',
        kind: scenario.kind,
        upstreamStatus: scenario.upstreamStatus,
        retryable: false,
        message: scenario.message,
        settingsUrl: '/settings/content/ai-media',
      });
      await mocks.install(page);
      await openDesigner(page);
      await openVideoDialog(page);
      await page.getByLabel('Provider:').selectOption(scenario.provider);
      if (scenario.provider === 'kling') await chooseKlingModel(page);
      if (scenario.provider === 'fal') await expect(page.getByText(/pikaffects/i)).toHaveCount(0);
      await page.getByPlaceholder('Describe the video you want to generate...').fill(PROMPT);

      await page.getByRole('button', { name: 'Generate', exact: true }).click();
      const alert = page.getByRole('dialog', { name: 'AI Video', exact: true }).getByRole('alert');
      await expect(alert).toContainText(scenario.message);
      await expect(alert).toContainText(scenario.providerName);
      const settings = alert.getByRole('link', { name: 'Open settings', exact: true });
      await expect(settings).toHaveAttribute('href', '/settings/content/ai-media');
      await expect(settings).not.toHaveAttribute('href', /billing/i);
      await expect(page).toHaveURL(/\/media\/designer\?designId=/);
      await expect(page.getByRole('slider', { name: 'Clip', exact: true })).toHaveCount(0);
      await page.waitForTimeout(1_000);
      expect(mocks.bodies(`/media/studio/${scenario.provider}/generate`), 'one POST and no retry storm').toHaveLength(1);
      expect(mocks.generationCount()).toBe(1);
      expect(mocks.savedClips()).toHaveLength(0);
      mocks.expectNoExternalProviders();
    });
  }

  test('full-page immediate quota 502 shows one clear toast and settings action without raw JSON', async ({ page }) => {
    test.setTimeout(120_000);
    const mocks = new ProviderWorkflowMocks();
    const message = "fal.ai reports the account's quota or billing limit was reached (HTTP 402): insufficient credits";
    mocks.failGeneration('fal', {
      error: 'ProviderUpstreamError',
      provider: 'fal',
      providerName: 'fal.ai',
      domain: 'media',
      operation: 'video',
      kind: 'quota',
      upstreamStatus: 402,
      retryable: false,
      message,
      settingsUrl: '/settings/content/ai-media',
      providerSecret: 'never-render-this-secret',
    });
    await mocks.install(page);
    await page.goto('/media/fal', { waitUntil: 'domcontentloaded' });
    const generate = page.getByRole('button', { name: 'Generate', exact: true });
    await expect(generate).toBeVisible({ timeout: 90_000 });
    await page.getByLabel('Prompt', { exact: true }).fill(PROMPT);
    await generate.click();

    const toastText = page.getByText(message, { exact: false });
    await expect(toastText).toBeVisible();
    await expect(toastText).toContainText("The account's quota or billing limit was reached");
    const settings = page.getByRole('link', { name: 'Open settings', exact: true });
    await expect(settings).toHaveAttribute('href', '/settings/content/ai-media');
    await expect(page.getByText(/never-render-this-secret|"providerSecret"|"kind"/)).toHaveCount(0);
    expect(mocks.generationCount()).toBe(1);
    mocks.expectNoExternalProviders();
  });

  test('async quota transition toasts once with settings and does not repeat on polls or historical reload', async ({ page }) => {
    test.setTimeout(120_000);
    const mocks = new ProviderWorkflowMocks();
    const message = "fal.ai reports the account's quota or billing limit was reached (HTTP 402): insufficient credits";
    mocks.failAsyncJob('fal', JSON.stringify({
      message,
      kind: 'quota',
      settingsUrl: '/settings/content/ai-media',
      providerSecret: 'never-render-this-secret',
    }));
    await mocks.install(page);
    await page.goto('/media/fal', { waitUntil: 'domcontentloaded' });
    const generate = page.getByRole('button', { name: 'Generate', exact: true });
    await expect(generate).toBeVisible({ timeout: 90_000 });
    await page.getByLabel('Prompt', { exact: true }).fill(PROMPT);
    await generate.click();
    await expect(page.getByText('Render started', { exact: true })).toBeVisible();

    const failureText = page.getByText(message, { exact: false });
    await expect(failureText).toHaveCount(2, { timeout: 20_000 });
    const toast = failureText.last().locator('..');
    await expect(toast.getByRole('link', { name: 'Open settings', exact: true })).toHaveAttribute(
      'href',
      '/settings/content/ai-media'
    );
    await expect(toast).toContainText("The account's quota or billing limit was reached");
    await expect(page.getByText(/never-render-this-secret|"providerSecret"|"kind"/)).toHaveCount(0);

    await page.waitForTimeout(5_500);
    await expect(failureText).toHaveCount(1);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText(message, { exact: false })).toHaveCount(1, { timeout: 90_000 });
    await expect(page.getByRole('link', { name: 'Open settings', exact: true })).toHaveCount(1);
    expect(mocks.generationCount()).toBe(1);
    mocks.expectNoExternalProviders();
  });

  test('Reel.Farm completed job decodes, plays, seeks, opens in Designer, and reloads without regeneration', async ({ page }) => {
    test.setTimeout(120_000);
    const mocks = new ProviderWorkflowMocks();
    await mocks.install(page);
    await page.goto('/media/reelfarm', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Ready', { exact: true })).toBeVisible({ timeout: 90_000 });
    await expectPreviewPlayback(page);
    expect(mocks.generationCount(), 'completed-job preview must not generate').toBe(0);

    const popup = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Edit in Designer', exact: true }).click();
    const designer = await popup;
    await designer.waitForLoadState('domcontentloaded');
    await expect(designer).toHaveURL(/\/media\/designer\?timeline=1&handoff=[0-9a-f-]{36}$/);
    await expect(designer.getByRole('slider', { name: 'Clip', exact: true })).toHaveCount(1, { timeout: 90_000 });
    await expect(designer.locator('video')).toHaveCount(1);
    await expect.poll(() => mocks.savedClips().length, 'Designer handoff autosaves the real video clip').toBe(1);
    await expect.poll(() => designer.locator('video').evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(2);

    const video = designer.locator('video').first();
    const before = await video.evaluate((element: HTMLVideoElement) => element.currentTime);
    await designer.getByRole('button', { name: 'Play', exact: true }).click();
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(before + 0.25);
    await designer.getByRole('button', { name: 'Pause', exact: true }).click();
    const seek = designer.getByRole('slider', { name: 'Seek timeline', exact: true });
    await seek.press('Home');
    await seek.press('ArrowRight');
    await expect.poll(async () => Number(await seek.getAttribute('aria-valuenow'))).toBeGreaterThan(0);

    await designer.goto(`/media/designer?designId=${DESIGN_ID}`, { waitUntil: 'domcontentloaded' });
    await expect(designer.getByRole('slider', { name: 'Clip', exact: true })).toHaveCount(1, { timeout: 90_000 });
    await designer.reload({ waitUntil: 'domcontentloaded' });
    await expect(designer.getByRole('slider', { name: 'Clip', exact: true })).toHaveCount(1, { timeout: 90_000 });
    await expect(designer.locator('video')).toHaveCount(1);
    expect(mocks.savedClips()).toHaveLength(1);
    expect(mocks.generationCount(), 'handoff, reopen, and reload must not regenerate').toBe(0);
    mocks.expectNoExternalProviders();
  });

  test('direct Kling 2.6 native audio forces 1080p and an empty prompt never POSTs', async ({ page }) => {
    const mocks = new ProviderWorkflowMocks();
    await mocks.install(page);
    await openDesigner(page);
    await openVideoDialog(page);

    await page.getByLabel('Provider:').selectOption('kling');
    const generate = page.getByRole('button', { name: 'Generate', exact: true });
    await expect(generate).toBeDisabled();
    expect(mocks.generationCount(), 'missing prompt must not submit').toBe(0);

    await chooseKlingModel(page);
    await page.getByLabel('Audio', { exact: true }).selectOption('native');
    const resolution = page.getByLabel('Resolution', { exact: true });
    await expect(resolution).toHaveValue('1080p');
    await expect(resolution.locator('option')).toHaveCount(1);
    await expect(resolution.locator('option')).toHaveAttribute('value', '1080p');
    expect(mocks.generationCount(), 'model and option changes must not submit').toBe(0);

    await page.getByPlaceholder('Describe the video you want to generate...').fill(PROMPT);
    await generate.click();
    await expect.poll(() => mocks.bodies('/media/studio/kling/generate').length).toBe(1);
    expect(mocks.bodies('/media/studio/kling/generate')[0]).toEqual({
      operation: 'video',
      model: 'kling-2.6',
      input: {
        model: 'kling-2.6',
        duration: '5',
        aspect_ratio: '16:9',
        resolution: '1080p',
        audio: 'native',
        prompt: PROMPT,
      },
    });
    mocks.expectNoExternalProviders();
  });

  test('MiniMax exposes S2V-01 and submits the selected subject through the real nested request payload', async ({ page }) => {
    const mocks = new ProviderWorkflowMocks();
    await mocks.install(page);
    await openDesigner(page);
    await openVideoDialog(page);

    await page.getByLabel('Provider:').selectOption('minimax');
    await page.getByRole('tab', { name: 'Subject Reference', exact: true }).click();
    await page.getByPlaceholder('Describe the video you want to generate...').fill(PROMPT);
    const generate = page.getByRole('button', { name: 'Generate', exact: true });
    await expect(generate).toBeDisabled();
    expect(mocks.generationCount(), 'missing subject image must not submit').toBe(0);

    await page.getByRole('button', { name: 'Choose image…', exact: true }).click();
    await pickFile(page, 'subject-portrait.png');
    await expect(page.getByTestId('media-picker')).toHaveCount(0);
    await expect(generate).toBeEnabled();
    expect(mocks.generationCount(), 'selecting a subject must not auto-generate').toBe(0);

    await generate.click();
    await expect.poll(() => mocks.bodies('/media/studio/minimax/generate').length).toBe(1);
    expect(mocks.bodies('/media/studio/minimax/generate')[0]).toEqual({
      operation: 'video',
      model: 'S2V-01',
      input: { prompt_optimizer: true, prompt: PROMPT },
      mediaInputs: { subject_image: 'file-subject' },
    });
    mocks.expectNoExternalProviders();
  });

  test('HeyGen is filtered out of ordinary video and available in the avatar dialog', async ({ page }) => {
    const mocks = new ProviderWorkflowMocks();
    await mocks.install(page);
    await openDesigner(page);
    await openVideoDialog(page);

    const videoProvider = page.getByLabel('Provider:');
    await expect(videoProvider.locator('option[value="kling"]')).toHaveCount(1);
    await expect(videoProvider.locator('option[value="heygen"]')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByPlaceholder('Describe the video you want to generate...')).toHaveCount(0);

    await page.getByRole('button', { name: 'Avatar', exact: true }).click();
    const avatarProvider = page.getByLabel('Provider:');
    await expect(avatarProvider.locator('option[value="heygen"]')).toHaveCount(1);
    await avatarProvider.selectOption('heygen');
    await expect(page.getByText('Pick a photo from Files', { exact: true })).toBeVisible();
    await expect(page.getByText('Pick a voice', { exact: true })).toBeVisible();
    expect(mocks.generationCount(), 'opening either dialog must not submit').toBe(0);
    mocks.expectNoExternalProviders();
  });

  test('faceless video loads HeyGen narration choices without auto-generating', async ({ page }) => {
    const mocks = new ProviderWorkflowMocks();
    await mocks.install(page);
    await openDesigner(page);
    await openVideoDialog(page);

    await page.getByLabel('Include voiceover (faceless video)', { exact: true }).check();
    await page.getByPlaceholder('Describe the video you want to generate...').fill(PROMPT);
    await page.getByLabel('Narration script', { exact: true }).fill('A faceless product narration');
    await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeDisabled();
    await page.getByLabel('Voice provider:', { exact: true }).selectOption('heygen');
    await page.getByLabel('Voice', { exact: true }).selectOption('voice-e2e');

    await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeEnabled();
    expect(mocks.generationCount(), 'configuring a faceless video must not submit').toBe(0);
    mocks.expectNoExternalProviders();
  });

  test('Veo submits a real 1–3 reference array at 16:9 and 8s, with no mount, tab, or reload generation', async ({ page }) => {
    test.setTimeout(120_000);
    const mocks = new ProviderWorkflowMocks();
    await mocks.install(page);
    await openDesigner(page);
    expect(mocks.generationCount(), 'designer mount must not generate').toBe(0);
    await openVideoDialog(page);

    await page.getByLabel('Provider:').selectOption('replicate');
    const category = page.getByLabel('Category', { exact: true });
    await category.selectOption('text-to-video');
    const model = page.getByLabel('Model', { exact: true });
    await model.selectOption('google/veo-3.1');
    await expect(page.getByText('Subject/style references (1–3)', { exact: true })).toBeVisible();
    expect(mocks.generationCount(), 'provider and model mount must not generate').toBe(0);

    await category.selectOption('image-to-video');
    await category.selectOption('text-to-video');
    await model.selectOption('google/veo-3.1');
    expect(mocks.generationCount(), 'category switches must not generate').toBe(0);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'AI Video', exact: true })).toBeEnabled({ timeout: 90_000 });
    expect(mocks.generationCount(), 'reload must not generate').toBe(0);
    await openVideoDialog(page);
    await expect(page.getByLabel('Provider:')).toHaveValue('replicate');
    await page.getByLabel('Category', { exact: true }).selectOption('text-to-video');
    await page.getByLabel('Model', { exact: true }).selectOption('google/veo-3.1');
    await page.getByPlaceholder('Describe the video you want to generate...').fill(PROMPT);

    await page.getByRole('button', { name: 'Choose image files...', exact: true }).click();
    for (const name of ['reference-one.png', 'reference-two.png', 'reference-three.png', 'reference-four.png']) {
      await pickFile(page, name);
    }
    const picker = page.getByTestId('media-picker');
    await picker.getByRole('button', { name: 'Confirm (4)', exact: true }).click();
    await expect(page.getByText('Choose up to 3 files.', { exact: true })).toBeVisible();
    await expect(picker).toHaveCount(0);
    expect(mocks.generationCount(), 'more than three references must not submit').toBe(0);

    await page.getByRole('button', { name: 'Choose image files...', exact: true }).click();
    for (const name of ['reference-one.png', 'reference-two.png', 'reference-three.png']) {
      await pickFile(page, name);
    }
    await picker.getByRole('button', { name: 'Confirm (3)', exact: true }).click();
    await expect(picker).toHaveCount(0);
    await expect(page.getByText('3 of 3 selected', { exact: true })).toBeVisible();
    expect(mocks.generationCount(), 'reference selection must not auto-generate').toBe(0);

    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    await expect.poll(() => mocks.bodies('/media/replicate/run/async').length).toBe(1);
    const body = mocks.bodies('/media/replicate/run/async')[0];
    expect(body).toMatchObject({
      modelId: 'google/veo-3.1',
      versionId: 'veo-e2e-version',
      operation: 'video',
      folderId: null,
      input: { prompt: PROMPT, aspect_ratio: '16:9', duration: 8 },
    });
    const input = body.input as Record<string, unknown>;
    expect(Array.isArray(input.reference_images), 'reference_images must remain an array').toBe(true);
    expect(input.reference_images).toEqual([
      { fileId: 'file-reference-1', url: '/mock-storage/reference-one.png', type: 'image' },
      { fileId: 'file-reference-2', url: '/mock-storage/reference-two.png', type: 'image' },
      { fileId: 'file-reference-3', url: '/mock-storage/reference-three.png', type: 'image' },
    ]);
    mocks.expectNoExternalProviders();
  });
});
