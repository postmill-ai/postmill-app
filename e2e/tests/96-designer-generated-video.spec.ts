import { test, expect, type Page, type Route } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const DESIGN_ID = 'design-generated-video-e2e';
const GENERATED_URL = '/mock-storage/generated.mp4';
const REPLACEMENT_URL = '/mock-storage/replacement.webm';
const GENERATE_PATH = '/media/generate-video';

interface VideoClipSnapshot {
  id: string;
  src?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  naturalWidth?: number;
  naturalHeight?: number;
  startMs: number;
  endMs: number;
  text?: string;
  fontSize?: number;
  shape?: string;
  fill?: string;
  align?: 'left' | 'center' | 'right' | 'justify';
  fillGradient?: {
    type: 'linear' | 'radial';
    stops: Array<{ offset: number; color: string }>;
  };
}

interface DesignerDocSnapshot {
  version: number;
  mode: string;
  outputs: Array<{
    width: number;
    height: number;
    durationMs: number;
    tracks: Array<{ id: string; type: string; clips: VideoClipSnapshot[] }>;
  }>;
}

const blankDoc = (): DesignerDocSnapshot => ({
  version: 9,
  mode: 'video',
  outputs: [
    {
      width: 1080,
      height: 1920,
      durationMs: 10_000,
      tracks: [],
    },
  ],
});

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

class DesignerMocks {
  readonly generatePosts: string[] = [];
  readonly unexpectedProviderPosts: string[] = [];
  readonly httpErrors: string[] = [];
  readonly consoleErrors: string[] = [];
  readonly pageErrors: string[] = [];
  dashboardJobReads = 0;
  studioStatusReads = 0;
  doc = blankDoc();
  name = 'Generated video E2E';
  jobOutcome: 'completed' | 'failed' = 'completed';

  private readonly fixtures = {
    [GENERATED_URL]: {
      file: 'motion-rear-moov.mp4',
      contentType: 'video/mp4',
    },
    [REPLACEMENT_URL]: {
      file: 'replacement.webm',
      contentType: 'video/webm',
    },
  };

  async install(page: Page) {
    page.on('response', (response) => {
      if (response.status() >= 400 && !/gravatar\.com|ingest\.us\.sentry\.io/.test(response.url())) {
        this.httpErrors.push(`${response.status()} ${response.request().method()} ${response.url()}`);
      }
    });
    page.on('pageerror', (error) => this.pageErrors.push(String(error)));
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const text = message.text();
      if (/Download the React DevTools|\[Fast Refresh\]|ResizeObserver loop|Sentry Logger|Loading the font/i.test(text)) return;
      this.consoleErrors.push(text);
    });

    await page.route('**/*', async (route) => {
      const request = route.request();
      const method = request.method();
      const pathname = apiPath(request.url());
      const hostname = new URL(request.url()).hostname;
      if (hostname === 'www.gravatar.com') {
        await route.fulfill({ status: 204 });
        return;
      }
      if (hostname.endsWith('.ingest.us.sentry.io')) {
        await json(route, {});
        return;
      }

      const fixture = this.fixtures[pathname as keyof typeof this.fixtures];
      if (fixture && method === 'GET') {
        await fulfillVideo(route, fixture.file, fixture.contentType);
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
        this.dashboardJobReads++;
        await json(route, { jobs: [] });
        return;
      }

      if (pathname === '/media/generation-providers' && method === 'GET') {
        await json(route, {
          providers: [{ identifier: 'replicate', name: 'Replicate' }],
          default: { providerId: 'mock-provider', model: 'mock-video' },
        });
        return;
      }

      if (pathname === '/media/studio/replicate/status' && method === 'GET') {
        this.studioStatusReads++;
        await json(route, { configured: true, enabled: true });
        return;
      }

      if (pathname === '/media/studio/replicate/jobs' && method === 'GET') {
        await json(route, []);
        return;
      }

      if (pathname === GENERATE_PATH && method === 'POST') {
        this.generatePosts.push(request.postData() || '');
        await json(route, { id: this.jobOutcome === 'completed' ? 'job-complete' : 'job-failed' });
        return;
      }

      if (pathname === '/media/jobs/job-complete' && method === 'GET') {
        await json(route, {
          status: 'completed',
          artifactUrl: GENERATED_URL,
          fileId: 'file-generated-e2e',
          fileType: 'video',
          metadata: {
            dimensions: { width: 720, height: 1280 },
            durationMs: 4000,
          },
        });
        return;
      }

      if (pathname === '/media/jobs/job-failed' && method === 'GET') {
        await json(route, { status: 'failed', error: 'Mock generation failed' });
        return;
      }

      if (pathname === '/media/upscale-video' && method === 'POST') {
        await json(route, { id: REPLACEMENT_URL });
        return;
      }

      if (pathname === `/media/designs/${DESIGN_ID}` && method === 'GET') {
        await json(route, { id: DESIGN_ID, name: this.name, doc: this.doc });
        return;
      }

      if (pathname === `/media/designs/${DESIGN_ID}` && method === 'PUT') {
        const body = request.postDataJSON() as { name: string; doc: DesignerDocSnapshot };
        this.name = body.name;
        this.doc = body.doc;
        await json(route, { id: DESIGN_ID, name: this.name, doc: this.doc });
        return;
      }

      if (method === 'POST' && /^\/media\/(studio\/[^/]+\/generate|generate-)/.test(pathname)) {
        this.unexpectedProviderPosts.push(`${method} ${pathname}`);
        await json(route, { message: 'Unexpected provider call blocked by E2E' }, 503);
        return;
      }

      const frontendOrigin = process.env.E2E_FRONTEND_ORIGIN;
      const requestUrl = new URL(request.url());
      if (
        frontendOrigin &&
        requestUrl.origin === 'https://app.postmill.ai' &&
        !pathname.startsWith('/api/')
      ) {
        const frontend = new URL(frontendOrigin);
        if (frontend.protocol !== 'http:' || !['localhost', '127.0.0.1', '::1'].includes(frontend.hostname)) {
          throw new Error('E2E_FRONTEND_ORIGIN must be a loopback HTTP origin');
        }
        const headers = { ...request.headers() };
        delete headers.host;
        delete headers['content-length'];
        const response = await fetch(`${frontendOrigin}${pathname}${requestUrl.search}`, {
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
        await route.fulfill({
          status: response.status,
          headers: responseHeaders,
          body: Buffer.from(await response.arrayBuffer()),
        });
        return;
      }

      const backendOrigin = process.env.E2E_BACKEND_ORIGIN;
      const backend = backendOrigin ? new URL(backendOrigin) : null;
      if (backend && (requestUrl.origin === 'https://api.postmill.ai' || requestUrl.origin === backend.origin)) {
        if (backend.protocol !== 'http:' || !['localhost', '127.0.0.1', '::1'].includes(backend.hostname)) {
          throw new Error('E2E_BACKEND_ORIGIN must be a loopback HTTP origin');
        }
        const headers = { ...request.headers() };
        delete headers.host;
        delete headers['content-length'];
        const localCookies = await page.context().cookies(page.url());
        headers.cookie = localCookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
        const response = await fetch(`${backendOrigin}${pathname}${new URL(request.url()).search}`, {
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

  savedClips(): VideoClipSnapshot[] {
    return this.doc.outputs[0].tracks.flatMap((track) => track.clips);
  }

  expectClean() {
    expect(this.unexpectedProviderPosts, 'no unmocked provider generation POSTs').toEqual([]);
    expect(this.httpErrors, 'no HTTP route errors').toEqual([]);
    expect(this.consoleErrors, 'no browser console errors').toEqual([]);
    expect(this.pageErrors, 'no uncaught browser errors').toEqual([]);
  }
}

async function fulfillVideo(route: Route, fixtureFile: string, contentType: string) {
  const body = fs.readFileSync(path.join(__dirname, '../fixtures', fixtureFile));
  const range = route.request().headers()['range'];
  const common = {
    'accept-ranges': 'bytes',
    'content-type': contentType,
    'cache-control': 'no-store',
  };
  if (!range) {
    await route.fulfill({ status: 200, headers: common, body });
    return;
  }

  const match = /^bytes=(\d+)-(\d*)$/.exec(range);
  if (!match) {
    await route.fulfill({ status: 416, headers: { 'content-range': `bytes */${body.length}` } });
    return;
  }
  const start = Number(match[1]);
  const end = Math.min(match[2] ? Number(match[2]) : body.length - 1, body.length - 1);
  if (start >= body.length || end < start) {
    await route.fulfill({ status: 416, headers: { 'content-range': `bytes */${body.length}` } });
    return;
  }
  await route.fulfill({
    status: 206,
    headers: { ...common, 'content-range': `bytes ${start}-${end}/${body.length}` },
    body: body.subarray(start, end + 1),
  });
}

async function openDesigner(page: Page, mocks: DesignerMocks) {
  await page.goto(`/media/designer?designId=${DESIGN_ID}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'AI Video', exact: true })).toBeEnabled({ timeout: 60_000 });
  await expect.poll(() => mocks.dashboardJobReads).toBeGreaterThan(0);
}

async function openGenerationDialog(page: Page) {
  await page.getByRole('button', { name: 'AI Video', exact: true }).click();
  await expect(page.getByPlaceholder('Describe the video you want to generate...')).toBeVisible();
}

async function generateFromDefaultProvider(page: Page, prompt: string) {
  await openGenerationDialog(page);
  await page.getByPlaceholder('Describe the video you want to generate...').fill(prompt);
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
}

async function saveDesign(page: Page) {
  await page.getByRole('button', { name: 'Save (Ctrl+S)' }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
}

async function canvasFingerprint(page: Page): Promise<string> {
  return page.locator('.konvajs-content canvas').evaluateAll((canvases) => {
    let hash = 2166136261;
    let samples = 0;
    for (const canvas of canvases) {
      const context = canvas.getContext('2d');
      if (!context || !canvas.width || !canvas.height) continue;
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const stride = Math.max(4, Math.floor(pixels.length / 12000 / 4) * 4);
      for (let index = 0; index < pixels.length; index += stride) {
        hash ^= pixels[index] + pixels[index + 1] * 3 + pixels[index + 2] * 7 + pixels[index + 3] * 11;
        hash = Math.imul(hash, 16777619);
        samples++;
      }
    }
    return `${samples}:${hash >>> 0}`;
  });
}

async function canvasCenterRgb(page: Page): Promise<number> {
  return page.locator('.konvajs-content canvas').first().evaluate((canvas) => {
    const context = canvas.getContext('2d');
    if (!context || !canvas.width || !canvas.height) return 0;
    const pixel = context.getImageData(
      Math.floor(canvas.width / 2),
      Math.floor(canvas.height / 2),
      1,
      1
    ).data;
    return pixel[0] + pixel[1] + pixel[2];
  });
}

async function expectRealPlayback(page: Page) {
  const video = page.locator('video').first();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(2);
  await expect.poll(() => canvasCenterRgb(page), 'the decoded frame must be visible, not a black artboard').toBeGreaterThan(0);
  const beforeTime = await video.evaluate((element: HTMLVideoElement) => element.currentTime);
  const beforePixels = await canvasFingerprint(page);

  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
    .toBeGreaterThan(beforeTime + 0.25);
  await expect.poll(() => canvasCenterRgb(page), 'playback must keep painting real frames').toBeGreaterThan(0);
  await expect.poll(() => canvasFingerprint(page)).not.toBe(beforePixels);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
}

test.describe('Designer generated video (fully mocked provider and storage)', () => {
  test('explicit generation lands, scales, plays, saves/reopens, and replaces the same clip source', async ({ page }) => {
    const mocks = new DesignerMocks();
    await mocks.install(page);
    await openDesigner(page, mocks);
    expect(mocks.generatePosts, 'mount must not generate').toHaveLength(0);

    await openGenerationDialog(page);
    await page.getByLabel('Provider:').selectOption('replicate');
    await page.getByLabel('Category').selectOption({ label: 'Text to Video' });
    await page.getByLabel('Provider:').selectOption('');
    await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeVisible();
    expect(mocks.generatePosts, 'provider/category switch must not generate').toHaveLength(0);
    await page.getByPlaceholder('Describe the video you want to generate...').fill('A deterministic moving fixture');
    await page.getByRole('button', { name: 'Generate', exact: true }).click();

    await expect(page.getByRole('slider', { name: 'Clip', exact: true })).toHaveCount(1);
    await expect(page.locator('video')).toHaveCount(1);
    await expect.poll(() => mocks.savedClips().length, 'autosave persists the generated clip').toBe(1);
    expect(mocks.generatePosts, 'exactly one explicit Generate POST').toHaveLength(1);
    expect(JSON.parse(mocks.generatePosts[0]).prompt).toBe('A deterministic moving fixture');

    const inserted = mocks.savedClips()[0];
    expect(inserted).toMatchObject({
      src: GENERATED_URL,
      x: 0,
      y: 0,
      width: 1080,
      height: 1920,
      naturalWidth: 720,
      naturalHeight: 1280,
      startMs: 0,
      endMs: 4000,
    });
    expect(inserted.width! / inserted.height!).toBeCloseTo(720 / 1280, 8);
    await expectRealPlayback(page);

    await saveDesign(page);
    const savedId = mocks.savedClips()[0].id;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('slider', { name: 'Clip', exact: true })).toHaveCount(1);
    await expect(page.locator('video')).toHaveCount(1);
    await expect.poll(() => mocks.dashboardJobReads).toBeGreaterThan(1);
    expect(mocks.generatePosts, 'reload must not generate again').toHaveLength(1);
    await expectRealPlayback(page);

    await page.getByRole('slider', { name: 'Seek timeline', exact: true }).press('Home');
    await expect(page.getByRole('slider', { name: 'Seek timeline', exact: true })).toHaveAttribute('aria-valuenow', '0');
    const beforeReplacementPixels = await canvasFingerprint(page);
    await page.getByRole('slider', { name: 'Clip', exact: true }).click({ button: 'right' });
    await page.getByRole('button', { name: 'Upscale', exact: true }).press('Enter');
    await page.getByRole('button', { name: 'Upscale video', exact: true }).press('Enter');
    await expect(page.locator('video')).toHaveAttribute('src', REPLACEMENT_URL);
    await expect.poll(() => page.locator('video').evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(2);
    await expect.poll(() => canvasFingerprint(page)).not.toBe(beforeReplacementPixels);
    await expect(page.getByRole('slider', { name: 'Clip', exact: true })).toHaveCount(1);

    await saveDesign(page);
    await expect.poll(() => mocks.savedClips()[0]?.src).toBe(REPLACEMENT_URL);
    expect(mocks.savedClips()).toHaveLength(1);
    expect(mocks.savedClips()[0].id, 'source replacement preserves clip id').toBe(savedId);
    expect(mocks.generatePosts, 'transform must not re-run text-to-video generation').toHaveLength(1);
    mocks.expectClean();
  });

  test('a terminal failed job creates no clip and no duplicate generation POST', async ({ page }) => {
    const mocks = new DesignerMocks();
    mocks.jobOutcome = 'failed';
    await mocks.install(page);
    await openDesigner(page, mocks);

    await generateFromDefaultProvider(page, 'This job is mocked to fail');
    await expect(page.getByText('Mock generation failed', { exact: true })).toBeVisible();
    await expect(page.getByRole('slider', { name: 'Clip', exact: true })).toHaveCount(0);
    await expect(page.locator('video')).toHaveCount(0);
    expect(mocks.savedClips()).toHaveLength(0);
    expect(mocks.generatePosts).toHaveLength(1);

    await openGenerationDialog(page);
    await page.getByLabel('Provider:').selectOption('replicate');
    await page.getByLabel('Category').selectOption({ label: 'Text to Video' });
    expect(mocks.generatePosts, 'reopening or switching provider must not retry').toHaveLength(1);
    expect(mocks.savedClips()).toHaveLength(0);
    mocks.expectClean();
  });
});


const motionDoc = (): DesignerDocSnapshot => ({
  version: 9,
  mode: 'video',
  outputs: [{
    width: 1080,
    height: 1920,
    durationMs: 12_000,
    tracks: [
      {
        id: 'video-a',
        type: 'video',
        clips: [{
          id: 'clip-a',
          src: GENERATED_URL,
          startMs: 0,
          endMs: 2000,
          x: 0,
          y: 0,
          width: 1080,
          height: 1920,
          naturalWidth: 720,
          naturalHeight: 1280,
        }],
      },
      { id: 'video-b', type: 'video', clips: [] },
      {
        id: 'shape-a',
        type: 'shape',
        clips: [{
          id: 'shape-1',
          shape: 'rect',
          startMs: 0,
          endMs: 8000,
          x: 40,
          y: 40,
          width: 220,
          height: 120,
          fill: '#ff0000',
        }],
      },
      {
        id: 'text-a',
        type: 'text',
        clips: [{
          id: 'text-1',
          text: 'Resize me',
          startMs: 0,
          endMs: 8000,
          x: 60,
          y: 300,
          width: 220,
          height: 50,
          fontSize: 32,
          align: 'left',
          fill: '#ffffff',
        }],
      },
    ],
  }],
});

const clipOnTrack = (page: Page, label: string) =>
  page
    .getByTitle(label.toLowerCase(), { exact: true })
    .first()
    .locator('xpath=ancestor::div[contains(@class,"items-stretch")][1]')
    .getByRole('slider', { name: 'Clip', exact: true });

test.describe('Designer motion graphics editing (mocked local document)', () => {
  test('track drops, keyboard moves, canvas resize/style/duplicate, and reload persistence', async ({ page }) => {
    const mocks = new DesignerMocks();
    mocks.doc = motionDoc();
    await mocks.install(page);
    await openDesigner(page, mocks);
    await expect(page.getByRole('slider', { name: 'Clip', exact: true })).toHaveCount(3);

    await clipOnTrack(page, 'Video 1').first().click();
    await page.getByRole('button', { name: 'Duplicate', exact: true }).click();
    await expect.poll(() => mocks.doc.outputs[0].tracks[0].clips.length).toBe(2);
    const duplicateId = mocks.doc.outputs[0].tracks[0].clips[1].id;
    expect(duplicateId).not.toBe('clip-a');

    let source = await clipOnTrack(page, 'Video 1').nth(1).boundingBox();
    const target = await page.getByTitle('video 2', { exact: true }).boundingBox();
    expect(source).not.toBeNull();
    expect(target).not.toBeNull();
    await page.mouse.move(source!.x + source!.width / 2, source!.y + source!.height / 2);
    await page.mouse.down();
    await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => mocks.doc.outputs[0].tracks[1].clips[0]?.id).toBe(duplicateId);
    expect(mocks.doc.outputs[0].tracks.filter((track) => track.type === 'video')).toHaveLength(2);

    source = await clipOnTrack(page, 'Video 2').first().boundingBox();
    const lastTrack = await page.getByTitle('text', { exact: true }).boundingBox();
    expect(source).not.toBeNull();
    expect(lastTrack).not.toBeNull();
    await page.mouse.move(source!.x + source!.width / 2, source!.y + source!.height / 2);
    await page.mouse.down();
    await page.mouse.move(source!.x + source!.width / 2, lastTrack!.y + 40, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => mocks.doc.outputs[0].tracks.filter((track) => track.type === 'video').length).toBe(3);

    const moved = clipOnTrack(page, 'Video 3').first();
    await moved.focus();
    await moved.press('ArrowRight');
    await expect.poll(() => {
      const clip = mocks.savedClips().find((item) => item.id === duplicateId);
      return clip ? [clip.startMs, clip.endMs] : [];
    }).toEqual([100, 2100]);

    await clipOnTrack(page, 'Text').first().click();
    const stage = await page.locator('.konvajs-content').first().boundingBox();
    expect(stage).not.toBeNull();
    const zoom = Math.min(stage!.width / 1080, stage!.height / 1920) * 0.85;
    const viewportX = (stage!.width - 1080 * zoom) / 2;
    const viewportY = (stage!.height - 1920 * zoom) / 2;
    const handleX = stage!.x + viewportX + 280 * zoom;
    const handleY = stage!.y + viewportY + 350 * zoom;
    await page.mouse.move(handleX, handleY);
    await page.mouse.down();
    await page.mouse.move(handleX + 110 * zoom, handleY + 25 * zoom, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => mocks.savedClips().find((clip) => clip.id === 'text-1')?.fontSize).toBe(48);
    const resizedText = mocks.savedClips().find((clip) => clip.id === 'text-1');
    expect(resizedText?.width).toBeGreaterThan(320);
    expect(resizedText?.width).toBeLessThan(340);
    expect(resizedText?.height).toBeGreaterThan(70);
    expect(resizedText?.height).toBeLessThan(80);

    await clipOnTrack(page, 'Shape').first().click();
    await page.getByRole('radio', { name: 'Gradient', exact: true }).click();
    await expect.poll(() => mocks.savedClips().find((clip) => clip.id === 'shape-1')?.fillGradient?.stops.length).toBe(2);

    await clipOnTrack(page, 'Text').first().click();
    await page.getByRole('radio', { name: 'Justify', exact: true }).click();
    await expect.poll(() => mocks.savedClips().find((clip) => clip.id === 'text-1')?.align).toBe('justify');

    await saveDesign(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('slider', { name: 'Clip', exact: true })).toHaveCount(4);
    expect(mocks.doc.version).toBe(9);
    expect(mocks.doc.outputs[0].tracks.filter((track) => track.type === 'video')).toHaveLength(3);
    expect(mocks.savedClips().find((clip) => clip.id === duplicateId)).toMatchObject({ startMs: 100, endMs: 2100 });
    const persistedText = mocks.savedClips().find((clip) => clip.id === 'text-1');
    expect(persistedText).toMatchObject({ fontSize: 48, align: 'justify' });
    expect(persistedText?.width).toBeGreaterThan(320);
    expect(persistedText?.width).toBeLessThan(340);
    expect(persistedText?.height).toBeGreaterThan(70);
    expect(persistedText?.height).toBeLessThan(80);
    expect(mocks.savedClips().find((clip) => clip.id === 'shape-1')?.fillGradient?.stops).toHaveLength(2);
    expect(mocks.generatePosts).toHaveLength(0);
    mocks.expectClean();
  });
});
