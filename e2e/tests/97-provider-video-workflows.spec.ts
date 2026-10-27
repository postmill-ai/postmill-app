import { test, expect, type Page, type Route } from '@playwright/test';

const DESIGN_ID = 'provider-video-workflows-e2e';
const PROMPT = 'A presenter walks through a sunlit studio';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwAEhgGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

interface StudioJob {
  id: string;
  operation: string;
  model: string;
  status: 'processing';
  artifactUrl: null;
  fileId: null;
  fileType: null;
  error: null;
  createdAt: string;
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
  private readonly jobs: Record<string, StudioJob[]> = { kling: [], minimax: [] };
  readonly unexpectedGenerationPosts: string[] = [];
  readonly externalProviderCalls: string[] = [];

  async install(page: Page) {
    await page.route('**/*', async (route) => {
      const request = route.request();
      const method = request.method();
      const url = new URL(request.url());
      const pathname = apiPath(request.url());

      if (/^(api\.minimax\.io|api\.replicate\.com|api\.heygen\.com|api\.klingai\.com)$/.test(url.hostname)) {
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
      if (pathname.startsWith('/mock-storage/') && method === 'GET') {
        await route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
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
      if (pathname === `/media/designs/${DESIGN_ID}` && method === 'GET') {
        await json(route, {
          id: DESIGN_ID,
          name: 'Provider video workflows E2E',
          doc: {
            version: 8,
            mode: 'video',
            outputs: [{ width: 1080, height: 1920, durationMs: 10_000, tracks: [] }],
          },
        });
        return;
      }
      if (pathname === `/media/designs/${DESIGN_ID}` && method === 'PUT') {
        await json(route, request.postDataJSON());
        return;
      }
      if (pathname === '/media/generation-providers' && method === 'GET') {
        const avatar = url.searchParams.get('operation') === 'avatar';
        await json(route, {
          providers: avatar
            ? [{ identifier: 'heygen', name: 'HeyGen' }]
            : [
                { identifier: 'kling', name: 'Kling AI' },
                { identifier: 'minimax', name: 'MiniMax' },
                { identifier: 'replicate', name: 'Replicate' },
                { identifier: 'heygen', name: 'HeyGen' },
              ],
          default: { providerId: 'fal', model: 'kling-2.1' },
        });
        return;
      }

      const studioStatus = /^\/media\/studio\/(kling|minimax)\/status$/.exec(pathname);
      if (studioStatus && method === 'GET') {
        await json(route, { configured: true, enabled: true });
        return;
      }
      if (pathname === '/media/studio/kling/models' && method === 'GET') {
        await json(route, []);
        return;
      }
      const studioJobs = /^\/media\/studio\/(kling|minimax)\/jobs$/.exec(pathname);
      if (studioJobs && method === 'GET') {
        await json(route, this.jobs[studioJobs[1]]);
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

      if (
        method === 'POST' &&
        ['/media/studio/kling/generate', '/media/studio/minimax/generate', '/media/replicate/run/async'].includes(pathname)
      ) {
        const body = request.postDataJSON() as Record<string, unknown>;
        const bodies = this.posts.get(pathname) ?? [];
        bodies.push(body);
        this.posts.set(pathname, bodies);
        if (pathname === '/media/replicate/run/async') {
          await json(route, { jobId: 'replicate-e2e-job' });
          return;
        }
        const provider = pathname.split('/')[3];
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

      await route.continue();
    });
  }

  bodies(pathname: string): Record<string, unknown>[] {
    return this.posts.get(pathname) ?? [];
  }

  generationCount(): number {
    return [...this.posts.values()].reduce((count, bodies) => count + bodies.length, 0) + this.unexpectedGenerationPosts.length;
  }

  expectNoExternalProviders() {
    expect(this.externalProviderCalls, 'no browser-to-provider calls').toEqual([]);
    expect(this.unexpectedGenerationPosts, 'no unmocked generation POSTs').toEqual([]);
  }
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
