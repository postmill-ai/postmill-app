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
  editableFileId?: string;
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

interface BulkFixture {
  source: string;
  textSlot: string;
  imageSlot: string;
}

function bulkFixture(payload: unknown): BulkFixture {
  const elements = locateElements(payload);
  const slotName = (kind: string): string | undefined => {
    const match = elements.find(({ element }) =>
      element.slot && typeof element.slot === 'object' &&
      (element.slot as Record<string, unknown>).kind === kind &&
      typeof (element.slot as Record<string, unknown>).name === 'string' &&
      (element.slot as Record<string, unknown>).name
    );
    return match ? String((match.element.slot as Record<string, unknown>).name) : undefined;
  };
  const textSlot = slotName('text');
  const imageSlot = slotName('image');
  expect(textSlot, 'the Bulk fixture needs a named text slot').toBeTruthy();
  expect(imageSlot, 'the Bulk fixture needs a named image slot').toBeTruthy();
  const image = elements.find(({ element }) =>
    element.slot && typeof element.slot === 'object' &&
    (element.slot as Record<string, unknown>).name === imageSlot
  );
  const source = image!.element.src;
  expect(
    typeof source === 'string' && /^https?:\/\//.test(source),
    'the Bulk fixture image slot needs an existing HTTP(S) source for valid rows'
  ).toBe(true);
  return { source: source as string, textSlot: textSlot!, imageSlot: imageSlot! };
}

async function openBulkDialog(page: Page, csv: string, fixture: BulkFixture): Promise<void> {
  await openMenuAction(page, 'File', 'Bulk Create…');
  const dialog = page.getByRole('dialog', { name: 'Bulk Create', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.locator('input[type="file"]').setInputFiles({
    name: 'live-designer-five-rows.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  });
  await expect(dialog.getByText('5 data rows loaded', { exact: true })).toBeVisible();
  await dialog.getByRole('combobox', { name: `Column for ${fixture.textSlot}`, exact: true }).selectOption(fixture.textSlot);
  await dialog.getByRole('combobox', { name: `Column for ${fixture.imageSlot}`, exact: true }).selectOption(fixture.imageSlot);
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

async function startBatch(page: Page, rows: Record<string, string>[], fixture: BulkFixture) {
  const startPromise = page.waitForResponse((response) =>
    response.request().method() === 'POST' && apiPath(response.url()) === '/media/designs/bulk-create'
  );
  await page.getByRole('button', { name: 'Create 5 variations', exact: true }).click();
  const response = await startPromise;
  const terminalPromise = response.ok() ? watchTerminalJob(page) : null;
  const payload = response.request().postDataJSON() as { rows?: Record<string, string>[] };
  expect(
    Array.isArray(payload.rows) && payload.rows.length === 5 &&
      payload.rows.every((row, index) =>
        row[fixture.textSlot] === rows[index][fixture.textSlot] &&
        row[fixture.imageSlot] === rows[index][fixture.imageSlot]
      ),
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

async function importArchive(page: Page, name: string, bytes: Uint8Array) {
  const importPromise = page.waitForResponse((response) =>
    response.request().method() === 'POST' && apiPath(response.url()) === '/media/designs/import'
  );
  await page.locator('input[type="file"][accept*=".pdesign"]').setInputFiles({
    name,
    mimeType: 'application/zip',
    buffer: Buffer.from(bytes),
  });
  const response = await importPromise;
  expect(response.ok(), `${name} must reimport successfully`).toBe(true);
  const imported = await response.json() as { id?: string; name?: string; doc?: unknown };
  expect(imported.id, `${name} must create a new editable design`).toBeTruthy();
  await expect(page).toHaveURL(new RegExp(`/media/designer\\?designId=${imported.id}$`));
  await expect(page.getByLabel('Design name', { exact: true })).toHaveValue(imported.name || '');
  return imported;
}

async function uploadMixedAspectSource(page: Page, width: number, height: number, index: number) {
  const png = new PNG({ width, height });
  for (let offset = 0; offset < png.data.length; offset += 4) {
    png.data[offset] = 40 + index * 30;
    png.data[offset + 1] = 80 + index * 20;
    png.data[offset + 2] = 200 - index * 25;
    png.data[offset + 3] = 255;
  }
  const csrf = await page.evaluate(() =>
    document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)?.[1] || ''
  );
  expect(csrf, 'fixture uploads need the authenticated CSRF cookie').toBeTruthy();
  const response = await page.request.post('/api/files/upload-simple', {
    headers: { 'x-csrf-token': csrf },
    multipart: {
      file: {
        name: `bulk-create-mixed-${width}x${height}.png`,
        mimeType: 'image/png',
        buffer: PNG.sync.write(png),
      },
      preventSave: 'true',
    },
  });
  expect(response.ok(), 'the mixed-aspect fixture image must upload').toBe(true);
  const body = await response.json() as { path?: string };
  expect(body.path).toBeTruthy();
  return new URL(body.path!, requiredEnv('E2E_BASE')).toString();
}

export async function runBulkCreateValid(page: Page): Promise<void> {
  requiredEnv('E2E_BASE');
  const designId = requiredEnv('E2E_LIVE_DESIGN_ID');
  const assertNoBrowserFailures = collectBrowserFailures(page);
  const fixture = bulkFixture(await openDesign(page, designId));
  const dimensions = [[64, 32], [32, 64], [80, 40], [40, 80], [96, 48]] as const;
  const sources: string[] = [];
  for (const [index, [width, height]] of dimensions.entries()) {
    sources.push(await uploadMixedAspectSource(page, width, height, index));
  }
  const rows: Record<string, string>[] = dimensions.map((_, index) => ({
    [fixture.textSlot]: `Live QA Product ${index + 1}`,
    [fixture.imageSlot]: sources[index],
  }));
  const headers = `${csvCell(fixture.textSlot)},${csvCell(fixture.imageSlot)}`;
  const csv = [headers, ...rows.map((row) =>
    `${csvCell(row[fixture.textSlot])},${csvCell(row[fixture.imageSlot])}`
  )].join('\n');
  await openBulkDialog(page, csv, fixture);

  const dialog = page.getByRole('dialog', { name: 'Bulk Create', exact: true });
  const previewPromise = page.waitForResponse((response) =>
    response.request().method() === 'POST' && apiPath(response.url()) === '/media/designs/bulk-generate'
  );
  await dialog.getByRole('button', { name: 'Preview first row', exact: true }).click();
  expect((await previewPromise).ok(), 'the first-row preview must render').toBe(true);
  const preview = dialog.getByRole('img', { name: 'First Bulk Create row', exact: true });
  await expect(preview).toBeVisible({ timeout: 90_000 });
  await expect.poll(() => preview.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);

  const { response, terminalPromise } = await startBatch(page, rows, fixture);
  expect(response.ok(), 'the valid batch must be accepted').toBe(true);
  const job = await terminalPromise!;
  expect(job.status, 'all five valid rows must complete').toBe('completed');
  expect(job.progress).toMatchObject({ done: 5, total: 5 });
  const results = job.results || [];
  expect(results.map((result) => result.row)).toEqual([1, 2, 3, 4, 5]);
  expect(
    results.every((result) =>
      !!result.designId && !!result.editableFileId && !result.error && (result.fileIds?.length || 0) > 0
    ),
    'every row must produce an editable design, archive, and rendered file'
  ).toBe(true);
  expect(new Set(results.map((result) => result.designId)).size, 'row designs must be independent').toBe(5);
  await expect(dialog.getByText('Bulk Create complete', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'Open editable design', exact: true })).toHaveCount(5);

  const zipLink = dialog.getByRole('link', { name: 'Download PNG + editable designs (.zip)', exact: true });
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
    zippedResults.every((result) =>
      !!result.designId && !!result.editableFileId && !result.error && (result.fileIds?.length || 0) > 0
    ),
    'the ZIP manifest must not hide a partial or failed row'
  ).toBe(true);
  expect(Object.keys(entries)).toEqual(expect.arrayContaining([
    'source/template.pdesign', 'source/data.csv',
    ...Array.from({ length: 5 }, (_, index) =>
      `editable/row-${String(index + 1).padStart(3, '0')}.pdesign`
    ),
  ]));
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();

  for (const [index, result] of zippedResults.entries()) {
    const name = `editable/row-${String(index + 1).padStart(3, '0')}.pdesign`;
    const archive = entries[name]!;
    expect(archive, `${name} must exist`).toBeDefined();
    const manifest = JSON.parse(strFromU8(archive['manifest.json'])) as {
      assets?: Record<string, { path: string }>;
    };
    const exportedDoc = JSON.parse(strFromU8(archive['doc.json'])) as unknown;
    for (const asset of Object.values(manifest.assets || {})) {
      expect(archive[asset.path], `${name} must contain ${asset.path}`).toBeDefined();
    }
    const originalImage = locateElements(exportedDoc).find(({ element }) =>
      (element.slot as Record<string, unknown> | undefined)?.name === fixture.imageSlot
    );
    expect(originalImage?.element).toMatchObject({
      naturalWidth: dimensions[index][0],
      naturalHeight: dimensions[index][1],
      fitMode: 'cover',
    });
    const imported = await importArchive(page, name.split('/').pop()!, archive);
    const importedElements = locateElements(imported.doc);
    const importedText = importedElements.find(({ element }) =>
      (element.slot as Record<string, unknown> | undefined)?.name === fixture.textSlot
    );
    const importedImage = importedElements.find(({ element }) =>
      (element.slot as Record<string, unknown> | undefined)?.name === fixture.imageSlot
    );
    expect(importedText?.element.text).toBe(rows[index][fixture.textSlot]);
    expect(importedImage?.element.fileId, 'imported image bytes must belong to the new design').toBeTruthy();
    expect(importedImage?.element.fileId).not.toBe(originalImage?.element.fileId);
    expect(imported.id).not.toBe(result.designId);
  }

  expect(strFromU8(entries['source/data.csv'])).toBe(csv.replaceAll('\n', '\r\n'));
  const template = await importArchive(page, 'template.pdesign', entries['source/template.pdesign']);
  expect(locateElements(template.doc).some(({ element }) =>
    (element.slot as Record<string, unknown> | undefined)?.name === fixture.textSlot
  )).toBe(true);
  await openBulkDialog(page, strFromU8(entries['source/data.csv']), fixture);
  const rerun = await startBatch(page, rows, fixture);
  expect(rerun.response.ok(), 'the exported source template and CSV must rerun').toBe(true);
  const rerunJob = await rerun.terminalPromise!;
  expect(rerunJob.status).toBe('completed');
  expect(
    (rerunJob.results || []).every((result) => !!result.designId && !!result.editableFileId && !result.error),
    'the source rerun must produce five editable rows'
  ).toBe(true);
  assertNoBrowserFailures();
}

export async function runBulkCreateInvalidAtomic(page: Page): Promise<void> {
  const base = requiredEnv('E2E_BASE');
  const designId = requiredEnv('E2E_LIVE_DESIGN_ID');
  const fixture = bulkFixture(await openDesign(page, designId));
  const missing = new URL('/e2e-live-designer/missing-row-5.png', base).toString();
  const rows: Record<string, string>[] = Array.from({ length: 5 }, (_, index) => ({
    [fixture.textSlot]: `Atomic QA Product ${index + 1}`,
    [fixture.imageSlot]: index === 4 ? missing : fixture.source,
  }));
  const headers = `${csvCell(fixture.textSlot)},${csvCell(fixture.imageSlot)}`;
  const csv = [headers, ...rows.map((row) =>
    `${csvCell(row[fixture.textSlot])},${csvCell(row[fixture.imageSlot])}`
  )].join('\n');
  await openBulkDialog(page, csv, fixture);
  const dialog = page.getByRole('dialog', { name: 'Bulk Create', exact: true });
  const { response, terminalPromise } = await startBatch(page, rows, fixture);

  if (!response.ok()) {
    expect(response.status(), 'an invalid row must be rejected as a client data error').toBe(400);
    const body = await response.json().catch(() => ({})) as { message?: string };
    const detail = body.message || '';
    expectRowAndSchemaDetail(detail);
    await expect(dialog.getByRole('alert')).toContainText('Row 5');
    await expect(dialog.getByRole('alert')).toContainText('.src');
    expectRowAndSchemaDetail(await dialog.innerText());
    await expect(dialog.getByRole('link', { name: 'Download PNG + editable designs (.zip)' })).toHaveCount(0);
    await expect(dialog.getByRole('link', { name: 'Open editable design' })).toHaveCount(0);
    return;
  }

  const job = await terminalPromise!;
  const results = job.results || [];
  expect(job.status, 'one invalid row must fail the whole batch, never complete a partial ZIP').toBe('failed');
  expect(Boolean(job.artifactUrl), 'an atomic failure must not create a ZIP').toBe(false);
  expect(
    results.every((result) =>
      !result.designId && !result.editableFileId && (result.fileIds || []).length === 0
    ),
    'an atomic failure must not leave editable designs, archives, or rendered files from valid prefix rows'
  ).toBe(true);
  const detail = [job.error, ...results.map((result) => result.error)].filter(Boolean).join('\n');
  expectRowAndSchemaDetail(detail);
  const dialogText = await dialog.innerText();
  expectRowAndSchemaDetail(dialogText);
  await expect(dialog.getByText('Bulk Create failed', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'Download PNG + editable designs (.zip)' })).toHaveCount(0);
  await expect(dialog.getByRole('link', { name: 'Open editable design' })).toHaveCount(0);
}
