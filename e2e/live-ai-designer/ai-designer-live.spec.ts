import { expect, test, type Locator, type Page } from '@playwright/test';
import { PNG } from 'pngjs';

const enabled = process.env.E2E_LIVE_AI_DESIGNER === '1';
const generationAllowed = process.env.E2E_LIVE_GENERATION === '1';
const productionTarget = process.env.E2E_BASE
  ? new URL(process.env.E2E_BASE).hostname === 'app.postmill.ai'
  : false;
const productionAllowed = process.env.E2E_LIVE_PRODUCTION === '1';

test.skip(!enabled, 'Requires E2E_LIVE_AI_DESIGNER=1');
test.skip(enabled && !generationAllowed, 'Paid AI Designer acceptance requires E2E_LIVE_GENERATION=1');
test.skip(enabled && productionTarget && !productionAllowed, 'Production acceptance requires E2E_LIVE_PRODUCTION=1');

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for live AI Designer acceptance`);
  return value;
}

const mediaRefs = (value: unknown): string[] => {
  const refs: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    for (const [key, child] of Object.entries(node)) {
      if (['src', 'fileId', 'originalSrc', 'originalFileId', 'maskSrc', 'maskFileId'].includes(key)) {
        if (typeof child === 'string' && child) refs.push(`${key}:${child}`);
      } else walk(child);
    }
  };
  walk(value);
  return refs.sort();
};

async function openDesign(
  page: Page,
  button: Locator
): Promise<{ id: string; design: Record<string, unknown> }> {
  const responsePromise = page.waitForResponse((response) => {
    if (response.request().method() !== 'GET') return false;
    const path = new URL(response.url()).pathname.replace(/^\/api(?=\/)/, '');
    return /^\/media\/designs\/[^/]+$/.test(path);
  });
  await button.click();
  const response = await responsePromise;
  expect(response.ok(), 'the delivered design must load in the Designer modal').toBe(true);
  const design = await response.json() as Record<string, unknown>;
  expect(typeof design.id, 'the design response must include its id').toBe('string');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Edit in Designer', exact: true })).toHaveCount(0);
  return { id: design.id as string, design };
}

test('original logo and palette survive generation, and text-only revision preserves media', async ({ page }) => {
  requiredEnv('E2E_BASE');
  const brandHex = (process.env.E2E_LIVE_BRAND_HEX || '#ff0000').toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(brandHex)) throw new Error('E2E_LIVE_BRAND_HEX must be #rrggbb');

  await page.goto('/media/ai-designer');
  const promptMode = page.getByRole('button', { name: 'Prompt', exact: true });
  await expect(async () => {
    await promptMode.click();
    await expect(page.getByLabel('Prompt', { exact: true })).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  const instagramPost = page.getByRole('button', { name: /Instagram Post/ });
  await instagramPost.click();
  await expect(instagramPost).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Variants', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Add reference', exact: true }).click();
  const logo = new PNG({ width: 32, height: 32 });
  for (let y = 0; y < 32; y += 1) {
    for (let x = 0; x < 32; x += 1) {
      const index = (y * 32 + x) * 4;
      logo.data[index] = 255;
      logo.data[index + 1] = 0;
      logo.data[index + 2] = 0;
      logo.data[index + 3] = 255;
    }
  }
  await page.locator('input[type="file"]').setInputFiles({
    name: 'e2e-logo.png',
    mimeType: 'image/png',
    buffer: PNG.sync.write(logo),
  });
  await expect(page.getByText('e2e-logo.png', { exact: true }).last()).toBeVisible({ timeout: 90_000 });
  await page.getByText('e2e-logo.png', { exact: true }).last().click();
  await page.getByRole('button', { name: /Confirm \(\d+\)/ }).click();
  await page.getByRole('button', { name: 'Use reference as logo', exact: true }).click();
  await expect(page.getByLabel('Prompt', { exact: true })).toBeVisible();
  await page.getByLabel('Prompt', { exact: true }).fill(
    `A minimal typographic launch design with no photography. Use ${brandHex} as the dominant brand color.`
  );
  await page.getByRole('button', { name: 'Start designing', exact: true }).click();
  await page.getByRole('button', { name: 'Accept plan', exact: true }).click({ timeout: 180_000 });

  const editDesignButtons = page.getByRole('button', { name: 'Edit in Designer', exact: true });
  await expect(editDesignButtons.first()).toBeVisible({ timeout: 300_000 });
  const original = await openDesign(page, editDesignButtons.first());
  expect(JSON.stringify(original.design).toLowerCase()).toContain(brandHex);
  expect(JSON.stringify(original.design)).toContain('"originId":"logo"');
  const originalRefs = mediaRefs(original.design);

  const message = page.getByLabel('Message', { exact: true });
  await message.fill('Only improve the small text and keep everything else');
  await message.press('Enter');

  await expect.poll(() => editDesignButtons.count(), { timeout: 300_000 }).toBeGreaterThan(1);
  const revised = await openDesign(page, editDesignButtons.last());
  expect(revised.id).not.toBe(original.id);
  expect(mediaRefs(revised.design)).toEqual(originalRefs);
});
