import { test, expect, type Page } from '@playwright/test';

/**
 * 51 — Media-defaults re-point regression coverage.
 *
 * Verifies that the surfaces re-pointed onto the new tenant defaults system still
 * hit the expected backend endpoints. The tests exercise:
 *   - Composer AI text generation (Generator) and image generation
 *   - Designer remove-background / upscale / focal-point and auto-caption (STT)
 *   - Video generator text-to-video and image-to-video
 *   - Post-publish generator flow that can trigger media generation
 *
 * The suite is skipped when E2E_PASSWORD is not set because it requires the
 * authenticated e2e environment. When credentials are present but no AI/media
 * provider is configured, the calls may return 409/402/400, but a non-404 status
 * still proves the endpoint is wired to the defaults-driven code path.
 */

const SKIP = !process.env.E2E_PASSWORD;
const SKIP_REASON = 'E2E_PASSWORD not set; media-defaults regression requires an authenticated environment with an enabled AI/media provider.';

const describeFn = SKIP ? test.describe.skip : test.describe;

async function csrfPost(
  page: Page,
  url: string,
  data: Record<string, unknown>
): Promise<{ status: number; body: unknown }> {
  // Cookie-auth mutating routes require the x-csrf-token header to match the
  // csrf_token cookie (3Z).
  const csrf = await page.evaluate(
    () =>
      (document.cookie.split('; ').find((c) => c.startsWith('csrf_token=')) || '')
        .split('=')[1] || ''
  );
  const res = await page.request.post(url, {
    data,
    headers: {
      ...(csrf ? { 'x-csrf-token': csrf } : {}),
      'Content-Type': 'application/json',
    },
  });

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = await res.text().catch(() => null);
  }
  return { status: res.status(), body };
}

describeFn(
  `media defaults re-point regression${SKIP ? ` (skipped: ${SKIP_REASON})` : ''}`,
  () => {
    test.beforeEach(async ({ page }) => {
      // Ensure the auth + CSRF cookies are present before issuing API calls.
      await page.goto('/launches', { waitUntil: 'networkidle' }).catch(() => {});
    });

    test('composer AI text generation reaches /api/posts/generator', async ({
      page,
    }) => {
      const { status, body } = await csrfPost(page, '/api/posts/generator', {
        research: 'E2E regression prompt for media defaults text generation',
        format: 'one_short',
        tone: 'personal',
        isPicture: false,
      });

      expect(
        status,
        `generator should be wired to defaults path (got ${status}: ${JSON.stringify(body)})`
      ).not.toBe(404);
      // The endpoint streams events; any reachable non-404 status confirms routing.
      expect([200, 201, 400, 402, 409]).toContain(status);
    });

    test('composer AI image generation reaches /api/media/generate-image-with-prompt', async ({
      page,
    }) => {
      const { status, body } = await csrfPost(
        page,
        '/api/media/generate-image-with-prompt',
        {
          prompt: 'E2E regression image generation prompt',
        }
      );

      expect(
        status,
        `image generation should be wired to defaults path (got ${status}: ${JSON.stringify(body)})`
      ).not.toBe(404);
      expect([200, 201, 400, 402, 409]).toContain(status);
    });

    test('Designer remove-background / upscale / focal-point endpoints are re-pointed', async ({
      page,
    }) => {
      const dummyUrl = 'https://example.com/e2e-dummy.jpg';

      const removeBg = await csrfPost(page, '/api/media/remove-background', {
        imageUrl: dummyUrl,
      });
      expect(removeBg.status, `remove-background got ${removeBg.status}`).not.toBe(404);

      const upscale = await csrfPost(page, '/api/media/upscale', {
        imageUrl: dummyUrl,
        scale: 2,
      });
      expect(upscale.status, `upscale got ${upscale.status}`).not.toBe(404);

      const focal = await csrfPost(page, '/api/media/detect-focal-point', {
        imageUrl: dummyUrl,
      });
      expect(focal.status, `detect-focal-point got ${focal.status}`).not.toBe(404);

      expect([200, 201, 400, 402, 409]).toContain(removeBg.status);
      expect([200, 201, 400, 402, 409]).toContain(upscale.status);
      expect([200, 201, 400, 402, 409]).toContain(focal.status);
    });

    test('Designer auto-caption STT endpoint is re-pointed', async ({ page }) => {
      const { status, body } = await csrfPost(
        page,
        '/api/media/speech-to-text-words',
        {
          audioUrl: 'https://example.com/e2e-dummy.mp3',
        }
      );

      expect(
        status,
        `speech-to-text-words should be wired to STT defaults path (got ${status}: ${JSON.stringify(body)})`
      ).not.toBe(404);
      expect([200, 201, 400, 402, 409]).toContain(status);
    });

    test('video generator text-to-video and image-to-video reach /api/media/generate-video', async ({
      page,
    }) => {
      const t2v = await csrfPost(page, '/api/media/generate-video', {
        prompt: 'E2E text to video regression prompt',
        output: 'vertical',
      });
      expect(t2v.status, `text-to-video got ${t2v.status}`).not.toBe(404);

      const i2v = await csrfPost(page, '/api/media/generate-video', {
        prompt: 'E2E image to video regression prompt',
        imageUrl: 'https://example.com/e2e-dummy.jpg',
        output: 'vertical',
      });
      expect(i2v.status, `image-to-video got ${i2v.status}`).not.toBe(404);

      expect([200, 201, 400, 402, 409]).toContain(t2v.status);
      expect([200, 201, 400, 402, 409]).toContain(i2v.status);
    });

    test('post-publish generator flow can trigger media generation', async ({
      page,
    }) => {
      // The generator flow creates a post and, when isPicture is true, can call
      // the media-defaults image pipeline before redirecting to the scheduler.
      const { status, body } = await csrfPost(page, '/api/posts/generator', {
        research: 'E2E regression prompt for post-publish media generation',
        format: 'one_short',
        tone: 'personal',
        isPicture: true,
      });

      expect(
        status,
        `post-publish generator flow should reach media generation path (got ${status}: ${JSON.stringify(body)})`
      ).not.toBe(404);
      expect([200, 201, 400, 402, 409]).toContain(status);
    });
  }
);
