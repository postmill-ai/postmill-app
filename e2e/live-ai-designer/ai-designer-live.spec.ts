import { expect, test, type Page } from '@playwright/test';

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

async function readDesign(page: Page, href: string): Promise<Record<string, unknown>> {
  const designId = new URL(href, 'https://app.postmill.ai').searchParams.get('designId')!;
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === 'GET' &&
    new URL(response.url()).pathname.replace(/^\/api(?=\/)/, '') === `/media/designs/${designId}`
  );
  await page.goto(href, { waitUntil: 'domcontentloaded' });
  const response = await responsePromise;
  expect(response.ok(), 'the delivered design must load in the Designer').toBe(true);
  return response.json() as Promise<Record<string, unknown>>;
}

test('original logo and palette survive generation, and text-only revision preserves media', async ({ page }) => {
  requiredEnv('E2E_BASE');
  const brandHex = (process.env.E2E_LIVE_BRAND_HEX || '#ff0000').toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(brandHex)) throw new Error('E2E_LIVE_BRAND_HEX must be #rrggbb');

  await page.goto('/media/ai-designer');
  await page.getByRole('button', { name: 'Prompt', exact: true }).click();
  await page.getByText('Instagram Post', { exact: true }).click();
  await page.getByLabel('Variants', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Add reference', exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: 'e2e-logo.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL9WQAAAABJRU5ErkJggg==', 'base64'),
  });
  await expect(page.getByText('e2e-logo.png', { exact: true }).last()).toBeVisible({ timeout: 90_000 });
  await page.getByText('e2e-logo.png', { exact: true }).last().click();
  await page.getByRole('button', { name: /Confirm \(\d+\)/ }).click();
  await page.getByRole('button', { name: 'Use reference as logo', exact: true }).click();
  await page.getByLabel('Prompt', { exact: true }).fill(
    `A minimal typographic launch design with no photography. Use ${brandHex} as the dominant brand color.`
  );
  await page.getByRole('button', { name: 'Start designing', exact: true }).click();
  await page.getByRole('button', { name: 'Accept plan', exact: true }).click({ timeout: 180_000 });

  const designLinks = page.locator('a[href*="/media/designer?designId="]');
  await expect(designLinks.first()).toBeVisible({ timeout: 300_000 });
  const originalHref = await designLinks.first().getAttribute('href');
  expect(originalHref).toBeTruthy();
  const original = await readDesign(page, originalHref!);
  expect(JSON.stringify(original).toLowerCase()).toContain(brandHex);
  expect(JSON.stringify(original)).toContain('"originId":"logo"');
  const originalRefs = mediaRefs(original);

  await page.goBack({ waitUntil: 'domcontentloaded' });
  const message = page.getByLabel('Message', { exact: true });
  await message.fill('Only improve the small text and keep everything else');
  await message.press('Enter');

  await expect.poll(() => designLinks.count(), { timeout: 300_000 }).toBeGreaterThan(1);
  const revisedHref = await designLinks.last().getAttribute('href');
  expect(revisedHref).toBeTruthy();
  expect(revisedHref).not.toBe(originalHref);
  const revised = await readDesign(page, revisedHref!);
  expect(mediaRefs(revised)).toEqual(originalRefs);
});
