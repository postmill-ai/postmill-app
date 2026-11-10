import { expect, type Page } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import { PNG } from 'pngjs';
import {
  collectBrowserFailures,
  locateElements,
  openDesign,
  openMenuAction,
  requiredEnv,
} from './helpers';

interface BulkRowResult {
  row: number;
  designId?: string;
  fileIds?: string[];
  error?: string;
}

interface BulkJob {
  id: string;
  status: string;
  artifactUrl?: string;
  error?: string | null;
  progress?: { done: number; total: number };
  results?: BulkRowResult[];
}

const apiPath = (url: string): string => new URL(url).pathname.replace(/^\/api(?=\/)/, '');
const csvCell = (value: string): string => `"${value.replaceAll('"', '""')}"`;

function bulkImageSource(payload: unknown): string {
  const elements = locateElements(payload);
  const headline = elements.some(({ element }) =>
    element.slot && typeof element.slot === 'object' &&
    (element.slot as Record<string, unknown>).name === 'headline' &&
    (element.slot as Record<string, unknown>).kind === 'text'
  );
  const hero = elements.find(({ element }) =>
    element.slot && typeof element.slot === 'object' &&
    (element.slot as Record<string, unknown>).name === 'hero' &&
    (element.slot as Record<string, unknown>).kind === 'image'
  );
  expect(headline, 'the Bulk fixture needs a headline text slot').toBe(true);
  expect(hero, 'the Bulk fixture needs a hero image slot').toBeTruthy();
  const source = hero!.element.src;
  expect(
    typeof source === 'string' && /^https?:\/\//.test(source),
    'the Bulk fixture hero slot needs an existing HTTP(S) source for valid rows'
  ).toBe(true);
  return source as string;
}

async function openBulkDialog(page: Page, csv: string): Promise<void> {
  await openMenuAction(page, 'File', 'Bulk Create…');
  const dialog = page.getByRole('dialog', { name: 'Bulk Create', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.locator('input[type="file"]').setInputFiles({
    name: 'live-designer-five-rows.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  });
  await expect(dialog.getByText('5 data rows loaded', { exact: true })).toBeVisible();
  await dialog.getByRole('combobox', { name: 'Column for headline', exact: true }).selectOption('headline');
  await dialog.getByRole('combobox', { name: 'Column for hero', exact: true }).selectOption('hero');
}

function watchTerminalJob(page: Page): Promise<BulkJob> {
  const responsePromise = page.waitForResponse(async (response) => {
    if (response.request().method() !== 'GET' || !/^\/media\/designs\/bulk-create\/[^/]+$/.test(apiPath(response.url()))) {
      return false;
    }
    const body = await response.json().catch(() => undefined) as BulkJob | undefined;
    return body?.status === 'completed' || body?.status === 'failed';
  }, { timeout: 240_000 });
  void responsePromise.catch(() => undefined);
  return responsePromise.then(async (response) => {
    expect(response.ok(), 'the Bulk terminal-status request must succeed').toBe(true);
    return response.json() as Promise<BulkJob>;
  });
}

async function startBatch(page: Page, rows: Record<string, string>[]) {
  const terminalPromise = watchTerminalJob(page);
  const startPromise = page.waitForResponse((response) =>
    response.request().method() === 'POST' && apiPath(response.url()) === '/media/designs/bulk-create'
  );
  await page.getByRole('button', { name: 'Create 5 variations', exact: true }).click();
  const response = await startPromise;
  const payload = response.request().postDataJSON() as { rows?: Record<string, string>[] };
  expect(
    Array.isArray(payload.rows) && payload.rows.length === 5 &&
      payload.rows.every((row, index) => row.headline === rows[index].headline && row.hero === rows[index].hero),
    'the UI must submit all five mapped rows without truncation'
  ).toBe(true);
  return { response, terminalPromise };
}

function expectRowAndSchemaDetail(detail: string): void {
  expect(detail, 'the failure must identify the invalid data row').toContain('Row 5');
  expect(
    /outputs(?:\.\d+|\[\d+\])(?:\.pages(?:\.\d+|\[\d+\]))?\.children(?:\.\d+|\[\d+\])\.src\b/.test(detail),
    'the failure must include the transformed image src schema path'
  ).toBe(true);
}

export async function runBulkCreateValid(page: Page): Promise<void> {
  requiredEnv('E2E_BASE');
  const designId = requiredEnv('E2E_LIVE_DESIGN_ID');
  const assertNoBrowserFailures = collectBrowserFailures(page);
  const source = bulkImageSource(await openDesign(page, designId));
  const rows = Array.from({ length: 5 }, (_, index) => ({
    headline: `Live QA Product ${index + 1}`,
    hero: source,
  }));
  const csv = ['headline,hero', ...rows.map((row) => `${csvCell(row.headline)},${csvCell(row.hero)}`)].join('\n');
  await openBulkDialog(page, csv);

  const dialog = page.getByRole('dialog', { name: 'Bulk Create', exact: true });
  const previewPromise = page.waitForResponse((response) =>
    response.request().method() === 'POST' && apiPath(response.url()) === '/media/designs/bulk-generate'
  );
  await dialog.getByRole('button', { name: 'Preview first row', exact: true }).click();
  expect((await previewPromise).ok(), 'the first-row preview must render').toBe(true);
  const preview = dialog.getByRole('img', { name: 'First Bulk Create row', exact: true });
  await expect(preview).toBeVisible({ timeout: 90_000 });
  await expect.poll(() => preview.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);

  const { response, terminalPromise } = await startBatch(page, rows);
  expect(response.ok(), 'the valid batch must be accepted').toBe(true);
  const job = await terminalPromise;
  expect(job.status, 'all five valid rows must complete').toBe('completed');
  expect(job.progress).toMatchObject({ done: 5, total: 5 });
  const results = job.results || [];
  expect(results.map((result) => result.row)).toEqual([1, 2, 3, 4, 5]);
  expect(
    results.every((result) => !!result.designId && !result.error && (result.fileIds?.length || 0) > 0),
    'every row must produce an editable design and a rendered file'
  ).toBe(true);
  expect(new Set(results.map((result) => result.designId)).size, 'row designs must be independent').toBe(5);
  await expect(dialog.getByText('Bulk Create complete', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'Open editable design', exact: true })).toHaveCount(5);

  const zipLink = dialog.getByRole('link', { name: 'Download PNG bundle (.zip)', exact: true });
  await expect(zipLink).toBeVisible();
  const href = await zipLink.getAttribute('href');
  expect(href, 'the completed batch must expose its ZIP artifact').toBeTruthy();
  const zipResponse = await page.request.get(href!);
  expect(zipResponse.ok(), 'the ZIP artifact must be readable').toBe(true);
  const entries = unzipSync(new Uint8Array(await zipResponse.body()));
  const pngNames = Object.keys(entries).filter((name) => name.endsWith('.png')).sort();
  expect(pngNames).toEqual(Array.from({ length: 5 }, (_, index) =>
    `row-${String(index + 1).padStart(3, '0')}-output-1-page-1.png`
  ));
  expect(Object.keys(entries)).toContain('results.json');
  for (const name of pngNames) {
    const png = PNG.sync.read(Buffer.from(entries[name]));
    expect(png.width, `${name} must decode`).toBeGreaterThan(0);
    expect(png.height, `${name} must decode`).toBeGreaterThan(0);
  }
  const zippedResults = JSON.parse(strFromU8(entries['results.json'])) as BulkRowResult[];
  expect(zippedResults.map((result) => result.row)).toEqual([1, 2, 3, 4, 5]);
  expect(
    zippedResults.every((result) => !!result.designId && !result.error && (result.fileIds?.length || 0) > 0),
    'the ZIP manifest must not hide a partial or failed row'
  ).toBe(true);
  assertNoBrowserFailures();
}

export async function runBulkCreateInvalidAtomic(page: Page): Promise<void> {
  const base = requiredEnv('E2E_BASE');
  const designId = requiredEnv('E2E_LIVE_DESIGN_ID');
  const source = bulkImageSource(await openDesign(page, designId));
  const missing = new URL('/e2e-live-designer/missing-row-5.png', base).toString();
  const rows = Array.from({ length: 5 }, (_, index) => ({
    headline: `Atomic QA Product ${index + 1}`,
    hero: index === 4 ? missing : source,
  }));
  const csv = ['headline,hero', ...rows.map((row) => `${csvCell(row.headline)},${csvCell(row.hero)}`)].join('\n');
  await openBulkDialog(page, csv);
  const dialog = page.getByRole('dialog', { name: 'Bulk Create', exact: true });
  const { response, terminalPromise } = await startBatch(page, rows);

  if (!response.ok()) {
    expect(response.status(), 'an invalid row must be rejected as a client data error').toBe(400);
    const body = await response.json().catch(() => ({})) as { message?: string };
    const detail = body.message || '';
    expectRowAndSchemaDetail(detail);
    await expect(dialog.getByRole('alert')).toContainText('Row 5');
    await expect(dialog.getByRole('alert')).toContainText('.src');
    expectRowAndSchemaDetail(await dialog.innerText());
    await expect(dialog.getByRole('link', { name: 'Download PNG bundle (.zip)' })).toHaveCount(0);
    await expect(dialog.getByRole('link', { name: 'Open editable design' })).toHaveCount(0);
    return;
  }

  const job = await terminalPromise;
  const results = job.results || [];
  expect(job.status, 'one invalid row must fail the whole batch, never complete a partial ZIP').toBe('failed');
  expect(Boolean(job.artifactUrl), 'an atomic failure must not create a ZIP').toBe(false);
  expect(
    results.every((result) => !result.designId && (result.fileIds || []).length === 0),
    'an atomic failure must not leave editable designs or rendered files from valid prefix rows'
  ).toBe(true);
  const detail = [job.error, ...results.map((result) => result.error)].filter(Boolean).join('\n');
  expectRowAndSchemaDetail(detail);
  const dialogText = await dialog.innerText();
  expectRowAndSchemaDetail(dialogText);
  await expect(dialog.getByText('Bulk Create failed', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'Download PNG bundle (.zip)' })).toHaveCount(0);
  await expect(dialog.getByRole('link', { name: 'Open editable design' })).toHaveCount(0);
}
