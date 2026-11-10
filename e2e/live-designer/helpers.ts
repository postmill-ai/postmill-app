import { readFile } from 'node:fs/promises';
import { expect, type BrowserContext, type Page } from '@playwright/test';

export type JsonRecord = Record<string, unknown>;

export interface LocatedElement {
  element: JsonRecord;
  outputIndex: number;
  pageNumber: number;
  outputName: string;
  pageName: string;
}

export function locateElements(payload: unknown): LocatedElement[] {
  const root = asRecord(payload);
  const doc = asRecord(root?.doc) || root;
  const outputs = Array.isArray(doc?.outputs) ? doc.outputs : [];
  const located: LocatedElement[] = [];
  outputs.forEach((candidate, outputIndex) => {
    const output = asRecord(candidate);
    if (!output) return;
    const outputName = typeof output.name === 'string' ? output.name : `Output ${outputIndex + 1}`;
    const containers = [
      { value: output, pageNumber: 0, pageName: 'Page 1' },
      ...(Array.isArray(output.pages) ? output.pages : []).map((page, index) => ({
        value: page,
        pageNumber: index + 1,
        pageName: typeof asRecord(page)?.name === 'string' ? asRecord(page)!.name as string : `Page ${index + 2}`,
      })),
    ];
    for (const container of containers) {
      const children = asRecord(container.value)?.children;
      if (!Array.isArray(children)) continue;
      for (const value of children) {
        const element = asRecord(value);
        if (element) located.push({ element, outputIndex, pageNumber: container.pageNumber, outputName, pageName: container.pageName });
      }
    }
  });
  return located;
}

export interface LiveImageElement {
  id: string;
  src?: string;
  originalSrc?: string;
  maskSrc?: string;
  maskEnabled?: boolean;
}

export interface LiveDesign {
  payload: unknown;
  image: LiveImageElement;
}

export interface PaidOperationGuard {
  attempts: () => string[];
  blocked: () => string[];
}

const asRecord = (value: unknown): JsonRecord | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : undefined;

const apiPath = (rawUrl: string): string => {
  const pathname = new URL(rawUrl).pathname;
  return pathname.replace(/^\/api(?=\/)/, '');
};

const designPath = (designId: string): string => `/media/designs/${encodeURIComponent(designId)}`;

const isDesignResponse = (url: string, method: string, designId: string, verb: string): boolean =>
  method === verb && apiPath(url) === designPath(designId);

export function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the selected live Designer case`);
  return value;
}

function readImage(payload: unknown, elementId?: string): LiveImageElement | undefined {
  const root = asRecord(payload);
  const doc = asRecord(root?.doc) || root;
  const outputs = Array.isArray(doc?.outputs) ? doc.outputs : [];
  for (const candidate of outputs) {
    const output = asRecord(candidate);
    const containers = [output, ...(Array.isArray(output?.pages) ? output.pages : [])];
    for (const container of containers) {
      const children = asRecord(container)?.children;
      if (!Array.isArray(children)) continue;
      for (const value of children) {
        const element = asRecord(value);
        if (element?.type !== 'image' || typeof element.id !== 'string') continue;
        if (elementId && element.id !== elementId) continue;
        return {
          id: element.id,
          ...(typeof element.src === 'string' ? { src: element.src } : {}),
          ...(typeof element.originalSrc === 'string' ? { originalSrc: element.originalSrc } : {}),
          ...(typeof element.maskSrc === 'string' ? { maskSrc: element.maskSrc } : {}),
          ...(typeof element.maskEnabled === 'boolean' ? { maskEnabled: element.maskEnabled } : {}),
        };
      }
    }
  }
  return undefined;
}

export function persistedImage(payload: unknown, elementId: string): LiveImageElement {
  const image = readImage(payload, elementId);
  expect(image, 'the saved design must retain the selected image layer').toBeTruthy();
  return image!;
}

export function backgroundResultApplied(
  image: LiveImageElement,
  resultUrl: string,
  originalUrl: string
): boolean {
  const maskedOriginal = image.src === originalUrl &&
    image.originalSrc === originalUrl &&
    typeof image.maskSrc === 'string' &&
    image.maskSrc.length > 0 &&
    image.maskEnabled === true;
  const flattenedCutout = image.src === resultUrl && !image.maskSrc && !image.originalSrc;
  return maskedOriginal || flattenedCutout;
}

export async function openDesign(page: Page, designId: string): Promise<unknown> {
  const responsePromise = page.waitForResponse(
    (response) => isDesignResponse(response.url(), response.request().method(), designId, 'GET')
  );
  await page.goto(`/media/designer?designId=${encodeURIComponent(designId)}`, {
    waitUntil: 'domcontentloaded',
  });
  const response = await responsePromise;
  expect(response.status(), 'the saved design must load').toBe(200);
  const payload: unknown = await response.json();
  await expect(page.getByLabel('Design name', { exact: true })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 90_000 });
  return payload;
}

export async function openSavedDesign(page: Page, designId: string): Promise<LiveDesign> {
  const payload = await openDesign(page, designId);
  const image = readImage(payload, process.env.E2E_LIVE_ELEMENT_ID?.trim());
  expect(
    image,
    'the QA design must contain a static image on its first output (or match E2E_LIVE_ELEMENT_ID)'
  ).toBeTruthy();
  return { payload, image: image! };
}

export async function openMenuAction(page: Page, menu: string, action: string | RegExp): Promise<void> {
  await page.getByRole('menuitem', { name: menu, exact: true }).click();
  await page.getByRole('menuitem', { name: action, exact: typeof action === 'string' }).click();
}

export async function selectImageLayer(page: Page, elementId: string): Promise<void> {
  let panel = page.getByRole('dialog', { name: 'Layers', exact: true });
  if (!await panel.isVisible()) {
    await openMenuAction(page, 'View', 'Layers');
  }
  panel = page.getByRole('dialog', { name: 'Layers', exact: true });
  await expect(panel).toBeVisible();
  const row = panel.locator(`[data-element-id=${JSON.stringify(elementId)}]`);
  await expect(row).toBeVisible();
  await row.click();
  await expect(row).toHaveAttribute('aria-selected', 'true');
  await panel.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(panel).toBeHidden();
}

export async function expectSelectedLayer(page: Page, elementId: string): Promise<void> {
  let panel = page.getByRole('dialog', { name: 'Layers', exact: true });
  if (!await panel.isVisible()) {
    await openMenuAction(page, 'View', 'Layers');
  }
  panel = page.getByRole('dialog', { name: 'Layers', exact: true });
  await expect(panel).toBeVisible();
  const row = panel.locator(`[data-element-id=${JSON.stringify(elementId)}]`);
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute('aria-selected', 'true');
  await panel.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(panel).toBeHidden();
}

export function watchDesignSave(page: Page, designId: string) {
  return page.waitForResponse(
    (response) => isDesignResponse(response.url(), response.request().method(), designId, 'PUT')
  );
}

export async function saveDesign(
  page: Page,
  designId: string,
  responsePromise = watchDesignSave(page, designId)
): Promise<unknown> {
  await page.getByRole('button', { name: 'Save (Ctrl+S)', exact: true }).click();
  const response = await responsePromise;
  expect(response.status(), 'the design save must succeed').toBe(200);
  const payload: unknown = response.request().postDataJSON();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  return payload;
}

export interface ExportedDownload {
  bytes: Buffer;
  filename: string;
}

export async function exportCurrentOutput(
  page: Page,
  options: { png?: boolean; scale?: 1 | 2 | 3 } = {}
): Promise<ExportedDownload> {
  await openMenuAction(page, 'File', 'Export…');
  const dialog = page.getByRole('dialog').filter({
    has: page.getByText('Export Design', { exact: true }),
  });
  await expect(dialog).toBeVisible();
  if (options.png) await dialog.locator('select').first().selectOption('png');
  if (options.scale) await dialog.getByRole('button', { name: `${options.scale}x`, exact: true }).click();
  await dialog.getByRole('button', { name: 'Next: Choose Folder', exact: true }).click();
  await dialog.getByRole('button', { name: 'All Files (root)', exact: true }).click();
  await dialog.getByRole('button', { name: /^Next: Export \d+ files?$/ }).click();

  const uploadPromise = page.waitForResponse((response) =>
    response.request().method() === 'POST' &&
    /^\/files\/upload-(simple|server)$/.test(apiPath(response.url()))
  );
  await dialog.getByRole('button', { name: /^Export \d+ files?$/ }).click();
  const upload = await uploadPromise;
  expect(upload.ok(), 'the rendered export must upload successfully').toBe(true);
  await expect(dialog.getByText('Saved to /files', { exact: true })).toBeVisible({ timeout: 90_000 });

  const downloadPromise = page.waitForEvent('download');
  await dialog.locator('a[download]').first().click();
  const download = await downloadPromise;
  const filename = download.suggestedFilename();
  expect(filename).toMatch(/\.(png|jpe?g|webp|pdf|svg)$/i);
  expect(await download.failure()).toBeNull();
  const path = await download.path();
  expect(path, 'the browser must persist the downloaded export').toBeTruthy();
  return { bytes: await readFile(path!), filename };
}

export async function installPaidOperationGuard(context: BrowserContext): Promise<PaidOperationGuard> {
  const attempts: string[] = [];
  const blocked: string[] = [];
  const paidPattern = /^\/media\/(remove-background|magic-grab|select-subject|outpaint|expand-image|upscale|inpaint|image-to-image|generate(?:-|$)|text-to-speech$|heygen\/talking-photo$)/;
  const paidStudioPattern = /^\/media\/(studio\/[^/]+\/generate$|replicate\/run\/)/;
  await context.route('**/*', async (route) => {
    const request = route.request();
    const pathname = apiPath(request.url());
    if (request.method() !== 'POST' || (!paidPattern.test(pathname) && !paidStudioPattern.test(pathname))) {
      await route.continue();
      return;
    }
    attempts.push(pathname);
    if (process.env.E2E_LIVE_GENERATION !== '1') {
      blocked.push(pathname);
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Paid Designer generation requires E2E_LIVE_GENERATION=1' }),
      });
      return;
    }
    await route.continue();
  });
  return { attempts: () => [...attempts], blocked: () => [...blocked] };
}

function sanitizedMessage(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value);
  return text
    .replace(/https?:\/\/\S+/gi, '[redacted-url]')
    .replace(/\b(?:blob|data):\S+/gi, '[redacted-data]')
    .replace(/\b(bearer|authorization|api[_-]?key|token)\b\s*[:=]?\s*\S+/gi, '$1 [redacted]')
    .slice(0, 300);
}

export function collectBrowserFailures(page: Page): () => void {
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(`page: ${sanitizedMessage(error)}`));
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(`console: ${sanitizedMessage(message.text())}`);
  });
  page.on('response', (response) => {
    const pathname = apiPath(response.url());
    if (response.status() >= 400 && /^\/(media|files)\//.test(pathname)) {
      failures.push(`network: ${response.status()} ${response.request().method()} ${pathname}`);
    }
  });
  return () => expect(failures, 'live Designer browser and API failures').toEqual([]);
}
