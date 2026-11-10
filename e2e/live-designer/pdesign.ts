import { readFile } from 'node:fs/promises';
import { expect, type Page } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import { collectBrowserFailures, locateElements, openDesign, openMenuAction, requiredEnv } from './helpers';

const apiPath = (url: string): string => new URL(url).pathname.replace(/^\/api(?=\/)/, '');

export async function runPdesignRoundTrip(page: Page): Promise<void> {
  requiredEnv('E2E_BASE');
  const sourceId = requiredEnv('E2E_LIVE_DESIGN_ID');
  const assertNoBrowserFailures = collectBrowserFailures(page);
  const source = await openDesign(page, sourceId);
  const sourceQr = locateElements(source).filter(({ element }) => element.type === 'image' && element.qr);
  expect(sourceQr.length, 'the source design must contain an editable QR element').toBeGreaterThan(0);

  const downloadPromise = page.waitForEvent('download', { timeout: 240_000 });
  await openMenuAction(page, 'File', 'Export .pdesign…');
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.pdesign$/i);
  expect(await download.failure()).toBeNull();
  const downloadPath = await download.path();
  expect(downloadPath, 'the browser must persist the design archive').toBeTruthy();
  const bytes = await readFile(downloadPath!);
  const entries = unzipSync(new Uint8Array(bytes));
  expect(Object.keys(entries)).toContain('manifest.json');
  expect(Object.keys(entries)).toContain('doc.json');
  const exportedDoc = JSON.parse(strFromU8(entries['doc.json'])) as unknown;
  expect(locateElements(exportedDoc).filter(({ element }) => element.qr).length).toBe(sourceQr.length);
  await expect(page.getByText('Design file download started', { exact: true })).toBeVisible();

  const importPromise = page.waitForResponse((response) =>
    response.request().method() === 'POST' && apiPath(response.url()) === '/media/designs/import'
  );
  await page.locator('input[type="file"][accept*=".pdesign"]').setInputFiles(downloadPath!);
  const importResponse = await importPromise;
  expect(importResponse.ok(), 'the downloaded archive must reimport successfully').toBe(true);
  const imported = await importResponse.json() as { id?: string; name?: string; doc?: unknown };
  expect(imported.id, 'import must return a new design id').toBeTruthy();
  expect(imported.id).not.toBe(sourceId);
  await expect(page).toHaveURL(new RegExp(`/media/designer\\?designId=${imported.id}$`));
  await expect(page.getByText('Design imported', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Design name', { exact: true })).toHaveValue(imported.name || '');

  const importedQr = locateElements(imported.doc).filter(({ element }) => element.type === 'image' && element.qr);
  expect(importedQr.length, 'the imported design must retain editable QR elements').toBe(sourceQr.length);
  expect(importedQr.map(({ element }) => element.id)).not.toEqual(sourceQr.map(({ element }) => element.id));
  expect(importedQr.map(({ element }) => element.qr)).toEqual(sourceQr.map(({ element }) => element.qr));

  const reopened = await openDesign(page, imported.id!);
  expect(
    locateElements(reopened).filter(({ element }) => element.type === 'image' && element.qr).length,
    'the imported design must reopen with its editable QR elements'
  ).toBe(sourceQr.length);
  assertNoBrowserFailures();
}
