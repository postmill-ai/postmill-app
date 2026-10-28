import { test, expect, type BrowserContext, type Locator, type Page } from '@playwright/test';

const LIVE_CASES = ['studio-completed-video', 'designer-saved-video'] as const;
const liveMedia = process.env.E2E_LIVE_MEDIA === '1';
const liveCase = process.env.E2E_LIVE_CASE;

if (liveMedia && liveCase && !LIVE_CASES.includes(liveCase as (typeof LIVE_CASES)[number])) {
  throw new Error(`Unknown E2E_LIVE_CASE. Expected one of: ${LIVE_CASES.join(', ')}`);
}

test.skip(!liveMedia || !liveCase, 'Requires both E2E_LIVE_MEDIA=1 and a per-case E2E_LIVE_CASE');

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for E2E_LIVE_CASE=${liveCase}`);
  return value;
}

function sanitizedError(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  return value
    .replace(/https?:\/\/\S+/gi, '[redacted-url]')
    .replace(/\b(bearer|authorization|api[_-]?key|token)\b\s*[:=]?\s*\S+/gi, '$1 [redacted]')
    .slice(0, 300);
}

async function blockPaidGeneration(context: BrowserContext): Promise<string[]> {
  const blocked: string[] = [];
  await context.route('**/*', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (
      request.method() === 'POST' &&
      (/^\/(api\/)?media\/studio\/[^/]+\/generate$/.test(pathname) ||
        /^\/(api\/)?media\/generate-/.test(pathname) ||
        /^\/(api\/)?media\/replicate\/run\//.test(pathname) ||
        /^\/(api\/)?media\/(text-to-speech|heygen\/talking-photo)$/.test(pathname))
    ) {
      blocked.push(pathname);
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Generation is blocked in the live playback suite' }),
      });
      return;
    }
    await route.continue();
  });
  return blocked;
}

async function artifactMetadata(video: Locator) {
  return video.evaluate((element: HTMLVideoElement) => ({
    width: element.videoWidth,
    height: element.videoHeight,
    durationMs: Math.round(element.duration * 1000),
  }));
}

function logArtifact(
  provider: string,
  model: string | null,
  status: string | null,
  artifact?: { width: number; height: number; durationMs: number },
  error?: string
) {
  console.log(
    `[live-media] ${JSON.stringify({ provider, model, ...(status ? { status } : {}), ...(artifact ? { artifact } : {}), ...(error ? { error } : {}) })}`
  );
}

async function expectDecodeAdvanceAndSeek(page: Page | Locator, designer = false) {
  const video = page.locator('video').first();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(2);
  const metadata = await artifactMetadata(video);
  expect(metadata.width).toBeGreaterThan(0);
  expect(metadata.height).toBeGreaterThan(0);
  expect(metadata.durationMs).toBeGreaterThan(0);

  const before = await video.evaluate((element: HTMLVideoElement) => element.currentTime);
  if (designer) {
    await page.getByRole('button', { name: 'Play', exact: true }).click();
  } else {
    await video.click();
    await video.evaluate((element: HTMLVideoElement) => element.play());
  }
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(before + 0.25);

  if (designer) {
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    const seek = page.getByRole('slider', { name: 'Seek timeline', exact: true });
    await seek.press('Home');
    await seek.press('ArrowRight');
  } else {
    await video.evaluate((element: HTMLVideoElement) => {
      element.pause();
      element.currentTime = Math.min(1, element.duration / 2);
    });
  }
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0);
  return metadata;
}

test.describe('Opt-in live provider media playback', () => {
  test('an existing completed studio job plays and opens in Designer without generation', async ({ page, context }) => {
    test.skip(liveCase !== 'studio-completed-video', 'Select with E2E_LIVE_CASE=studio-completed-video');
    const provider = requiredEnv('E2E_LIVE_PROVIDER');
    if (!/^[a-z0-9-]+$/.test(provider)) throw new Error('E2E_LIVE_PROVIDER must be a studio identifier');
    const jobId = requiredEnv('E2E_LIVE_JOB_ID');
    const blocked = await blockPaidGeneration(context);
    const jobsResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        /\/media\/studio\/[^/]+\/jobs$/.test(new URL(response.url()).pathname) &&
        response.status() === 200
    );

    await page.goto(`/media/${provider}`, { waitUntil: 'domcontentloaded' });
    const payload: unknown = await (await jobsResponse).json();
    const jobs = Array.isArray(payload) ? (payload as Array<Record<string, unknown>>) : [];
    const job = jobs.find((candidate) => candidate.id === jobId);
    expect(job, 'the selected job must be visible in this provider studio').toBeTruthy();
    const status = typeof job.status === 'string' ? job.status : 'unknown';
    const model = typeof job.model === 'string' ? job.model : null;
    logArtifact(provider, model, status, undefined, sanitizedError(job.error));
    expect(status).toBe('completed');
    expect(Boolean(job.artifactUrl), 'the completed job must have a stored artifact').toBe(true);

    const card = page.locator(`[id=${JSON.stringify(`media-job-${jobId}`)}]`);
    await expect(card.getByLabel('Generated video preview', { exact: true })).toBeVisible();
    const queueMetadata = await expectDecodeAdvanceAndSeek(card);
    logArtifact(provider, model, status, queueMetadata);

    const popup = page.waitForEvent('popup');
    await card.getByRole('button', { name: 'Edit in Designer', exact: true }).click();
    const designer = await popup;
    await designer.waitForLoadState('domcontentloaded');
    await expect(designer.getByRole('slider', { name: 'Clip', exact: true })).toHaveCount(1, { timeout: 90_000 });
    const designerMetadata = await expectDecodeAdvanceAndSeek(designer, true);
    logArtifact(provider, model, status, designerMetadata);
    expect(blocked, 'the live playback suite must never submit generation').toEqual([]);
  });

  test('an existing saved Designer video plays and seeks without generation', async ({ page, context }) => {
    test.skip(liveCase !== 'designer-saved-video', 'Select with E2E_LIVE_CASE=designer-saved-video');
    const designId = requiredEnv('E2E_LIVE_DESIGN_ID');
    const blocked = await blockPaidGeneration(context);
    await page.goto(`/media/designer?designId=${encodeURIComponent(designId)}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('slider', { name: 'Clip', exact: true }).first()).toBeVisible({ timeout: 90_000 });
    const metadata = await expectDecodeAdvanceAndSeek(page, true);
    logArtifact('designer', null, null, metadata);
    expect(blocked, 'Designer playback must not submit generation').toEqual([]);
  });
});
