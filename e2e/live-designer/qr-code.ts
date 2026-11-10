import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { expect, type Locator, type Page } from '@playwright/test';
import {
  collectBrowserFailures,
  exportCurrentOutput,
  locateElements,
  openDesign,
  openMenuAction,
  requiredEnv,
  saveDesign,
  selectImageLayer,
  watchDesignSave,
} from './helpers';

const QR_VALUE = 'https://example.com/live-designer-qr-acceptance';
const FOREGROUND = '#112233';
const BACKGROUND = '#AABBCC';

interface QrSettings {
  value: string;
  foreground: string;
  background: string;
}

function persistedQr(payload: unknown, expectedId?: string): { id: string; settings: QrSettings } {
  const match = locateElements(payload).find(({ element }) => {
    const qr = element.qr;
    return qr && typeof qr === 'object' &&
      (qr as Record<string, unknown>).value === QR_VALUE &&
      (!expectedId || element.id === expectedId);
  });
  expect(match, 'the saved design must retain the inserted QR element').toBeTruthy();
  const settings = match!.element.qr as unknown as QrSettings;
  return { id: match!.element.id as string, settings };
}

function expectSettings(settings: QrSettings): void {
  expect(settings.value).toBe(QR_VALUE);
  expect(settings.foreground).toBe(FOREGROUND);
  expect(settings.background).toBe(BACKGROUND);
}

async function setColor(dialog: Locator, label: string, value: string): Promise<void> {
  const field = dialog.getByText(label, { exact: true }).locator('..');
  await field.getByRole('button').first().click();
  const input = dialog.getByLabel('Hex color', { exact: true });
  await expect(input).toBeVisible();
  await input.fill(value);
  await input.press('Enter');
  await expect(field.getByRole('button').first()).toContainText(value);
}

function hasRgb(png: PNG, hex: string): boolean {
  const expected = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
  for (let index = 0; index < png.data.length; index += 4) {
    if (png.data[index] === expected[0] && png.data[index + 1] === expected[1] && png.data[index + 2] === expected[2]) {
      return true;
    }
  }
  return false;
}

export async function runQrCodeAcceptance(page: Page): Promise<void> {
  requiredEnv('E2E_BASE');
  const designId = requiredEnv('E2E_LIVE_DESIGN_ID');
  const assertNoBrowserFailures = collectBrowserFailures(page);
  const payload = await openDesign(page, designId);
  expect(
    locateElements(payload).some(({ element }) => Boolean(element.qr)),
    'the disposable fixture must not already contain a QR code'
  ).toBe(false);
  await openMenuAction(page, 'Insert', 'QR Code…');
  const dialog = page.getByRole('dialog', { name: 'QR code', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByPlaceholder('https://example.com or plain text', { exact: true }).fill(QR_VALUE);
  await setColor(dialog, 'Code color', FOREGROUND);
  await setColor(dialog, 'Background color', BACKGROUND);
  const preview = dialog.getByRole('img', { name: 'QR code preview', exact: true });
  await expect(preview).toBeVisible();
  await expect.poll(() => preview.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);

  const savePromise = watchDesignSave(page, designId);
  await dialog.getByRole('button', { name: 'Insert QR code', exact: true }).click();
  await expect(dialog).toBeHidden();
  const saved = persistedQr(await saveDesign(page, designId, savePromise));
  expectSettings(saved.settings);

  const reopened = persistedQr(await openDesign(page, designId), saved.id);
  expectSettings(reopened.settings);
  await selectImageLayer(page, reopened.id);
  await expect(page.getByRole('button', { name: 'Update QR code', exact: true })).toBeVisible();

  const exported = await exportCurrentOutput(page, { png: true, scale: 1 });
  expect(exported.filename.endsWith('.png')).toBe(true);
  const png = PNG.sync.read(exported.bytes);
  const decoded = jsQR(
    new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.byteLength),
    png.width,
    png.height,
    { inversionAttempts: 'attemptBoth' }
  );
  expect(decoded?.data, 'the exported PNG must decode to the inserted QR value').toBe(QR_VALUE);
  expect(hasRgb(png, FOREGROUND), 'the export must contain the requested foreground RGB').toBe(true);
  expect(hasRgb(png, BACKGROUND), 'the export must contain the requested background RGB').toBe(true);
  assertNoBrowserFailures();
}
