import { writeFile } from 'node:fs/promises';
import { expect, type Page, type TestInfo } from '@playwright/test';
import {
  collectBrowserFailures,
  exportCurrentOutput,
  installPaidOperationGuard,
  locateElements,
  openSavedDesign,
  requiredEnv,
  saveDesign,
  selectImageLayer,
} from './helpers';

const apiPath = (url: string): string => new URL(url).pathname.replace(/^\/api(?=\/)/, '');

export async function runMagicGrabAcceptance(page: Page, testInfo: TestInfo): Promise<void> {
  requiredEnv('E2E_BASE');
  const designId = requiredEnv('E2E_LIVE_DESIGN_ID');
  const paidOperations = await installPaidOperationGuard(page.context());
  const assertNoBrowserFailures = collectBrowserFailures(page);
  let { payload, image } = await openSavedDesign(page, designId);
  expect(image.src).toBeTruthy();
  await selectImageLayer(page, image.id);
  const prepare = process.env.E2E_LIVE_PREPARE_RESIZED;
  if (prepare) {
    const filename = 'magic-grab-chair-source.jpg';
    await page.getByRole('button', { name: 'Replace image…', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Replace image', exact: true });
    await expect(picker).toBeVisible();
    if (prepare === '1') {
      const sourceResponse = await page.request.get(image.src!);
      expect(sourceResponse.ok(), 'the original chair fixture must download').toBe(true);
      const uploadPromise = page.waitForResponse((response) =>
        response.request().method() === 'POST' && apiPath(response.url()) === '/files/upload-simple'
      );
      await picker.locator('input[type="file"]').setInputFiles({
        name: filename,
        mimeType: sourceResponse.headers()['content-type'] || 'image/jpeg',
        buffer: await sourceResponse.body(),
      });
      expect((await uploadPromise).ok(), 'the resized chair fixture must upload').toBe(true);
    }
    const uploaded = picker.getByText(filename, { exact: true }).first();
    await expect(uploaded).toBeVisible({ timeout: 90_000 });
    const tile = uploaded.locator('xpath=ancestor::div[@role="button"][1]');
    await tile.focus();
    await tile.press('Enter');
    await expect(picker).toBeHidden();
    await saveDesign(page, designId);
    ({ payload, image } = await openSavedDesign(page, designId));
    await selectImageLayer(page, image.id);
  }
  const original = locateElements(payload).find(({ element }) => element.id === image.id)!.element;
  const originalX = Number(original.x);

  const generationPromise = page.waitForResponse((response) =>
    response.request().method() === 'POST' && apiPath(response.url()) === '/media/magic-grab',
    { timeout: 240_000 }
  );
  await page.getByRole('button', { name: 'Magic Grab / Select Subject', exact: true }).click();
  const generation = await generationPromise;
  const result = await generation.json().catch(() => undefined) as {
    background?: { url?: string; fileId?: string };
    message?: string;
  } | undefined;
  expect(
    generation.ok(),
    `Magic Grab background reconstruction must succeed (HTTP ${generation.status()}: ${result?.message || 'no error detail'})`
  ).toBe(true);
  expect(result?.background?.url).toBeTruthy();
  expect(result?.background?.fileId).toBeTruthy();
  const backgroundAsset = result!.background!;

  const review = page.getByRole('dialog', { name: 'Magic Grab / Select Subject', exact: true });
  await expect(review).toBeVisible({ timeout: 90_000 });
  const originalPreview = review.getByRole('img', { name: 'Original', exact: true });
  const subjectPreview = review.getByRole('img', { name: 'Movable subject', exact: true });
  const backgroundPreview = review.getByRole('img', { name: 'Reconstructed background', exact: true });
  for (const preview of [originalPreview, subjectPreview, backgroundPreview]) {
    await expect(preview).toBeVisible();
    await expect.poll(() => preview.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
  }
  const pixels = await review.evaluate(async (dialog) => {
    const load = async (selector: string): Promise<HTMLImageElement> => {
      const preview = dialog.querySelector(selector) as HTMLImageElement;
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.src = preview.currentSrc;
      await image.decode();
      return image;
    };
    const [originalImage, subjectImage] = await Promise.all([
      load('img[alt="Original"]'),
      load('img[alt="Movable subject"]'),
    ]);
    const canvas = document.createElement('canvas');
    canvas.width = subjectImage.naturalWidth;
    canvas.height = subjectImage.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    context.drawImage(originalImage, 0, 0, canvas.width, canvas.height);
    const source = context.getImageData(0, 0, canvas.width, canvas.height).data;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(subjectImage, 0, 0);
    const subject = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let opaque = 0;
    let mismatches = 0;
    let maxDelta = 0;
    const colors = new Set<string>();
    for (let index = 0; index < subject.length; index += 4) {
      if (subject[index + 3] < 250) continue;
      opaque++;
      const delta = Math.max(
        Math.abs(source[index] - subject[index]),
        Math.abs(source[index + 1] - subject[index + 1]),
        Math.abs(source[index + 2] - subject[index + 2])
      );
      maxDelta = Math.max(maxDelta, delta);
      if (delta > 12) mismatches++;
      if (opaque % 97 === 0) colors.add(`${subject[index]},${subject[index + 1]},${subject[index + 2]}`);
    }
    return { opaque, mismatches, maxDelta, sampledColors: colors.size };
  });
  await review.screenshot({ path: testInfo.outputPath('magic-grab-review.png') });
  expect(pixels.opaque, 'the extracted subject must contain real pixels').toBeGreaterThan(100);
  expect(pixels.sampledColors, 'the subject must retain original colours, not a silhouette').toBeGreaterThan(20);
  expect(pixels.mismatches, `subject pixels must retain original RGB within canvas color conversion (max delta ${pixels.maxDelta})`).toBe(0);
  const backgroundResponse = await page.request.get(backgroundAsset.url!);
  expect(backgroundResponse.ok()).toBe(true);
  await writeFile(testInfo.outputPath('magic-grab-background.png'), await backgroundResponse.body());

  await review.getByRole('button', { name: 'Apply Magic Grab', exact: true }).click();
  await expect(review).toBeHidden();
  const x = page.getByLabel('X', { exact: true });
  await expect(x).toBeVisible();
  await x.fill(String(originalX + 40));
  await x.press('Enter');
  const savedPayload = await saveDesign(page, designId);
  const savedElements = locateElements(savedPayload);
  const background = savedElements.find(({ element }) => element.id === image.id)?.element;
  const subject = savedElements.find(({ element }) =>
    element.id !== image.id && element.type === 'image' && element.originalSrc === image.src && element.maskEnabled === true
  )?.element;
  expect(background?.src, 'the original layer must become the reconstructed background').toBe(backgroundAsset.url!);
  expect(background?.fileId).toBe(backgroundAsset.fileId!);
  expect(background?.x, 'moving the subject must not move the background').toBe(originalX);
  expect(subject?.src).toBe(image.src);
  expect(subject?.maskSrc).toBeTruthy();
  expect(subject?.x, 'the extracted subject must move independently').toBe(originalX + 40);
  const subjectId = String(subject!.id);

  const reopened = await openSavedDesign(page, designId);
  const reopenedElements = locateElements(reopened.payload);
  expect(reopenedElements.find(({ element }) => element.id === image.id)?.element.src).toBe(backgroundAsset.url!);
  const reopenedSubject = reopenedElements.find(({ element }) => element.id === subjectId)?.element;
  expect(reopenedSubject?.maskEnabled).toBe(true);
  expect(reopenedSubject?.x).toBe(originalX + 40);
  await selectImageLayer(page, subjectId);
  const exported = await exportCurrentOutput(page, { png: true, scale: 1 });
  await writeFile(testInfo.outputPath('magic-grab-export.png'), exported.bytes);
  await page.screenshot({ path: testInfo.outputPath('magic-grab-reopened.png'), fullPage: true });

  expect(paidOperations.blocked()).toEqual([]);
  expect(paidOperations.attempts(), 'exactly one Magic Grab generation is authorized').toEqual([
    '/media/remove-background',
    '/media/magic-grab',
  ]);
  assertNoBrowserFailures();
}
