import { writeFile } from 'node:fs/promises';
import { expect, type Page, type TestInfo } from '@playwright/test';
import { PNG } from 'pngjs';
import sharp from 'sharp';
import {
  collectBrowserFailures,
  exportCurrentOutput,
  installPaidOperationGuard,
  locateElements,
  openSavedDesign,
  openMenuAction,
  requiredEnv,
  saveDesign,
  selectImageLayer,
} from './helpers';

const apiPath = (url: string): string => new URL(url).pathname.replace(/^\/api(?=\/)/, '');
const pngResponse = async (page: Page, url: string): Promise<PNG> => {
  const response = await page.request.get(url);
  expect(response.ok(), 'the generated expansion asset must be readable').toBe(true);
  return PNG.sync.read(await response.body());
};

async function openOutpaintDialog(page: Page, elementId: string): Promise<void> {
  await selectImageLayer(page, elementId);
  await openMenuAction(page, 'Tools', 'Expand Image (AI)…');
  const dialog = page.getByRole('dialog', { name: 'Expand Image (AI)', exact: true });
  await expect(dialog).toBeVisible();
}

async function expandAndUpload(page: Page, operation: '/media/outpaint' | '/media/inpaint') {
  const generationPromise = page.waitForResponse((response) =>
    response.request().method() === 'POST' && apiPath(response.url()) === operation,
    { timeout: 240_000 }
  );
  const uploadPromise = page.waitForResponse((response) =>
    response.request().method() === 'POST' && /^\/files\/upload-(simple|server)$/.test(apiPath(response.url())),
    { timeout: 240_000 }
  );
  await page.getByRole('button', { name: 'Expand', exact: true }).click();
  const generation = await generationPromise;
  const detail = await generation.json().catch(() => undefined) as { message?: string };
  expect(generation.ok(), `expansion must succeed: ${detail?.message || `HTTP ${generation.status()}`}`).toBe(true);
  const upload = await uploadPromise;
  expect(upload.ok(), 'the composited expansion must upload').toBe(true);
  const requestBody = upload.request().postDataBuffer();
  expect(requestBody?.includes(Buffer.from('name="internal"'))).toBe(true);
  expect(requestBody?.includes(Buffer.from('design-asset'))).toBe(true);
  const asset = await upload.json() as { id?: string; path?: string; url?: string };
  expect(asset.id).toBeTruthy();
  expect(asset.path || asset.url).toBeTruthy();
  const dialog = page.getByRole('dialog', { name: 'Expand Image (AI)', exact: true });
  const after = dialog.getByRole('img', { name: 'After', exact: true });
  await expect(after).toBeVisible({ timeout: 90_000 });
  await expect.poll(() => after.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  return {
    asset: { id: asset.id!, url: (asset.path || asset.url)! },
    apiOrigin: new URL(upload.url()).origin,
    dialog,
  };
}

async function expectInternalAssetHidden(page: Page, apiOrigin: string, fileId: string): Promise<void> {
  const response = await page.request.get(`${apiOrigin}/files?limit=100&sort=createdAt&order=desc`);
  expect(response.ok()).toBe(true);
  const payload = await response.json() as { results?: { id: string }[] };
  expect(payload.results?.some((file) => file.id === fileId), 'generated expansion assets must stay out of All Files root').toBe(false);
}

async function applySaveReopenExport(page: Page, designId: string, testInfo: TestInfo, name: string, original: unknown) {
  await page.getByRole('button', { name: 'Apply result', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Expand Image (AI)', exact: true })).toBeHidden();
  await saveDesign(page, designId);
  await page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true }).click();
  const undone = await saveDesign(page, designId);
  expect(locateElements(undone).map(({ element }) => element)).toEqual(locateElements(original).map(({ element }) => element));
  await page.getByRole('button', { name: 'Redo (Ctrl+Shift+Z)', exact: true }).click();
  const saved = await saveDesign(page, designId);
  const reopened = await openSavedDesign(page, designId);
  const exported = await exportCurrentOutput(page, { png: true, scale: 1 });
  await writeFile(testInfo.outputPath(`${name}-export.png`), exported.bytes);
  const exportDialog = page.getByRole('dialog').filter({ has: page.getByText('Export Design', { exact: true }) });
  await exportDialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(exportDialog).toBeHidden();
  return { saved, reopened, exported };
}

export async function runDirectionalOutpaintAcceptance(page: Page, testInfo: TestInfo): Promise<void> {
  requiredEnv('E2E_BASE');
  let designId = requiredEnv('E2E_LIVE_DESIGN_ID');
  const paidOperations = await installPaidOperationGuard(page.context());
  const assertNoBrowserFailures = collectBrowserFailures(page);
  let { payload, image } = await openSavedDesign(page, designId);
  if (process.env.E2E_LIVE_PREPARE_FIXTURE === '1') {
    const apiOrigin = requiredEnv('E2E_API_ORIGIN').replace(/\/$/, '');
    const filesResponse = await page.request.get(`${apiOrigin}/files?limit=1&search=magic-grab-chair-source.jpg`);
    const files = await filesResponse.json() as { results?: { id: string; path: string }[] };
    const source = files.results?.[0];
    expect(source, 'the resized chair source must exist').toBeTruthy();
    const doc = structuredClone((payload as { doc?: unknown }).doc || payload) as Record<string, unknown>;
    const target = locateElements(doc).find(({ element }) => element.id === image.id)!.element;
    target.src = source!.path;
    target.fileId = source!.id;
    target.naturalWidth = 1431;
    target.naturalHeight = 2048;
    target.width = 604;
    target.height = 864;
    target.fitMode = 'cover';
    target.focalPoint = { x: 0.1, y: 0.15 };
    for (const key of ['crop', 'originalSrc', 'originalFileId', 'maskSrc', 'maskFileId', 'maskEnabled']) delete target[key];
    const importPromise = page.waitForResponse((response) =>
      response.request().method() === 'POST' && apiPath(response.url()) === '/media/designs/import'
    );
    await page.locator('input[type="file"][accept*=".pdesign"]').setInputFiles({
      name: 'directional-expansion-fixture.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(doc)),
    });
    const importedResponse = await importPromise;
    expect(importedResponse.ok(), 'the fresh directional fixture must import').toBe(true);
    const imported = await importedResponse.json() as { id: string };
    designId = imported.id;
    ({ payload, image } = await openSavedDesign(page, designId));
  }
  const before = locateElements(payload).find(({ element }) => element.id === image.id)!.element;
  await openOutpaintDialog(page, image.id);
  const dialog = page.getByRole('dialog', { name: 'Expand Image (AI)', exact: true });
  await dialog.locator('select').nth(1).selectOption('right');
  const generationPromise = page.waitForResponse((response) =>
    response.request().method() === 'POST' && apiPath(response.url()) === '/media/outpaint'
  );
  await dialog.getByRole('button', { name: 'Expand', exact: true }).click();
  const generation = await generationPromise;
  const generationDetail = await generation.json().catch(() => undefined) as { message?: string };
  expect(generation.ok(), `directional expansion must succeed: ${generationDetail?.message || `HTTP ${generation.status()}`}`).toBe(true);
  const sourceData = generation.request().postDataJSON().imageUrl as string;
  expect(sourceData.startsWith('data:image/png')).toBe(true);
  const uploadPromise = page.waitForResponse((response) =>
    response.request().method() === 'POST' && /^\/files\/upload-(simple|server)$/.test(apiPath(response.url()))
  );
  const upload = await uploadPromise;
  const uploadText = await upload.text();
  expect(upload.ok(), `the composited expansion must upload (HTTP ${upload.status()}: ${uploadText.slice(0, 300)})`).toBe(true);
  const uploadBody = upload.request().postDataBuffer();
  expect(uploadBody?.includes(Buffer.from('name="internal"'))).toBe(true);
  expect(uploadBody?.includes(Buffer.from('design-asset'))).toBe(true);
  const asset = JSON.parse(uploadText) as { id: string; path?: string; url?: string };
  const after = dialog.getByRole('img', { name: 'After', exact: true });
  await expect(after).toBeVisible({ timeout: 90_000 });
  await expect.poll(() => after.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
  await dialog.screenshot({ path: testInfo.outputPath('outpaint-directional-review.png') });

  const [sourcePng, expandedPng] = await Promise.all([
    Promise.resolve(PNG.sync.read(Buffer.from(sourceData.split(',')[1], 'base64'))),
    pngResponse(page, asset.path || asset.url!),
  ]);
  expect(expandedPng.width, 'provider dimensions must not drive the output geometry').toBe(sourcePng.width * 2);
  expect(expandedPng.height).toBe(sourcePng.height);
  await Promise.all([
    writeFile(testInfo.outputPath('outpaint-directional-source.png'), PNG.sync.write(sourcePng)),
    writeFile(testInfo.outputPath('outpaint-directional-expanded.png'), PNG.sync.write(expandedPng)),
  ]);
  const structuralHeight = Math.round(sourcePng.height * 360 / sourcePng.width);
  const [structuralSource, structuralExpanded] = await Promise.all([
    sharp(sourcePng.data, { raw: { width: sourcePng.width, height: sourcePng.height, channels: 4 } })
      .resize(360, structuralHeight, { fit: 'fill' }).png().toBuffer(),
    sharp(expandedPng.data, { raw: { width: expandedPng.width, height: expandedPng.height, channels: 4 } })
      .extract({ left: 0, top: 0, width: sourcePng.width, height: sourcePng.height })
      .resize(360, structuralHeight, { fit: 'fill' }).png().toBuffer(),
  ]);
  expect(
    structuralSource.equals(structuralExpanded),
    'the original crop, focal geometry, and visible composition must survive without distortion'
  ).toBe(true);
  await expectInternalAssetHidden(page, new URL(upload.url()).origin, asset.id);

  const { saved, reopened } = await applySaveReopenExport(page, designId, testInfo, 'outpaint-directional', payload);
  for (const document of [saved, reopened.payload]) {
    const expanded = locateElements(document).find(({ element }) => element.id === image.id)!.element;
    expect(expanded.src).toBe(asset.path || asset.url!);
    expect(expanded.x).toBe(before.x);
    expect(expanded.y).toBe(before.y);
    expect(Number(expanded.width)).toBeCloseTo(Number(before.width) * 2, 8);
    expect(Number(expanded.height)).toBeCloseTo(Number(before.height), 8);
    expect(expanded.naturalWidth).toBe(expandedPng.width);
    expect(expanded.naturalHeight).toBe(expandedPng.height);
  }
  expect(paidOperations.attempts()).toEqual(['/media/outpaint']);
  expect(paidOperations.blocked()).toEqual([]);
  assertNoBrowserFailures();
}

export async function runWholePageOutpaintAcceptance(page: Page, testInfo: TestInfo): Promise<void> {
  requiredEnv('E2E_BASE');
  const designId = requiredEnv('E2E_LIVE_DESIGN_ID');
  const paidOperations = await installPaidOperationGuard(page.context());
  const assertNoBrowserFailures = collectBrowserFailures(page);
  const { payload, image } = await openSavedDesign(page, designId);
  const originalElements = locateElements(payload);
  const root = (payload as { doc?: { outputs?: Record<string, unknown>[] } }).doc || payload as { outputs?: Record<string, unknown>[] };
  const output = root.outputs![0] as { width: number; height: number; background?: unknown };
  const targetWidth = Math.round(output.width * 1.5);
  const targetHeight = Math.round(output.height * 1.5);
  await openOutpaintDialog(page, image.id);
  const dialog = page.getByRole('dialog', { name: 'Expand Image (AI)', exact: true });
  await dialog.locator('select').first().selectOption('page');
  await dialog.locator('input[type="number"]').first().fill(String(targetWidth));
  await dialog.locator('input[type="number"]').nth(1).fill(String(targetHeight));
  const { asset, apiOrigin } = await expandAndUpload(page, '/media/inpaint');
  await dialog.screenshot({ path: testInfo.outputPath('outpaint-page-review.png') });
  const extension = await pngResponse(page, asset.url);
  expect(extension.width).toBe(targetWidth);
  expect(extension.height).toBe(targetHeight);
  const offsetX = (targetWidth - output.width) / 2;
  const offsetY = (targetHeight - output.height) / 2;
  let originalAreaAlpha = 0;
  let generatedAreaPixels = 0;
  for (let y = 0; y < extension.height; y += 4) {
    for (let x = 0; x < extension.width; x += 4) {
      const alpha = extension.data[(y * extension.width + x) * 4 + 3];
      const inOriginal = x >= offsetX && x < offsetX + output.width && y >= offsetY && y < offsetY + output.height;
      if (inOriginal) originalAreaAlpha += alpha;
      else if (alpha > 0) generatedAreaPixels++;
    }
  }
  expect(originalAreaAlpha, 'the generated extension must be transparent behind every original layer').toBe(0);
  expect(generatedAreaPixels, 'the extension must contain generated pixels outside the original page').toBeGreaterThan(0);
  await expectInternalAssetHidden(page, apiOrigin, asset.id);

  const { saved, reopened } = await applySaveReopenExport(page, designId, testInfo, 'outpaint-page', payload);
  for (const document of [saved, reopened.payload]) {
    const rootDocument = (document as { doc?: { outputs?: Record<string, unknown>[] } }).doc || document as { outputs?: Record<string, unknown>[] };
    const expandedOutput = rootDocument.outputs![0] as { width: number; height: number; background?: unknown };
    expect(expandedOutput.width).toBe(targetWidth);
    expect(expandedOutput.height).toBe(targetHeight);
    expect(expandedOutput.background).toEqual(output.background);
    const elements = locateElements(document);
    const extensionLayer = elements.find(({ element }) => element.name === 'Generated page extension')?.element;
    expect(extensionLayer?.src).toBe(asset.url);
    expect(extensionLayer?.width).toBe(targetWidth);
    expect(extensionLayer?.height).toBe(targetHeight);
    for (const original of originalElements) {
      const preserved = elements.find(({ element }) => element.id === original.element.id)?.element;
      expect(preserved, `original layer ${String(original.element.id)} must remain editable`).toBeTruthy();
      expect(preserved?.x).toBe(Number(original.element.x) + offsetX);
      expect(preserved?.y).toBe(Number(original.element.y) + offsetY);
      expect(preserved?.src).toEqual(original.element.src);
    }
  }
  expect(paidOperations.attempts()).toEqual(['/media/inpaint']);
  expect(paidOperations.blocked()).toEqual([]);
  assertNoBrowserFailures();
}
