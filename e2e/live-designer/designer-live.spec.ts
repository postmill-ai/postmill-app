import { expect, test } from '@playwright/test';
import {
  backgroundResultApplied,
  collectBrowserFailures,
  exportCurrentOutput,
  installPaidOperationGuard,
  openMenuAction,
  openSavedDesign,
  persistedImage,
  requiredEnv,
  saveDesign,
  selectImageLayer,
  watchDesignSave,
} from './helpers';
import { runBulkCreateInvalidAtomic, runBulkCreateValid } from './bulk-create';
import { runExactDesignSharing, runPreflightNavigation } from './navigation';
import { runQrCodeAcceptance } from './qr-code';

const LIVE_CASES = [
  'background-removal',
  'magic-grab',
  'outpaint',
  'bulk-create',
  'bulk-create-invalid',
  'qr-code',
  'sharing',
  'preflight',
] as const;

const liveDesigner = process.env.E2E_LIVE_DESIGNER === '1';
const liveCase = process.env.E2E_LIVE_CASE;
const generationAllowed = process.env.E2E_LIVE_GENERATION === '1';

if (liveDesigner && liveCase && !LIVE_CASES.includes(liveCase as (typeof LIVE_CASES)[number])) {
  throw new Error(`Unknown E2E_LIVE_CASE. Expected one of: ${LIVE_CASES.join(', ')}`);
}

test.skip(!liveDesigner || !liveCase, 'Requires E2E_LIVE_DESIGNER=1 and one explicit E2E_LIVE_CASE');
test.skip(
  liveDesigner &&
    (liveCase === 'background-removal' || liveCase === 'magic-grab' || liveCase === 'outpaint') &&
    !generationAllowed,
  'The selected paid case requires explicit E2E_LIVE_GENERATION=1 before browser fixtures start'
);
test.skip(
  liveDesigner && (liveCase === 'magic-grab' || liveCase === 'outpaint'),
  'Magic Grab and outpaint remain scaffolds until their active fixes land'
);

test.describe('Opt-in live Designer acceptance', () => {
  test('background removal applies, saves, reopens, and exports', async ({ page, context }) => {
    test.skip(liveCase !== 'background-removal', 'Select with E2E_LIVE_CASE=background-removal');

    requiredEnv('E2E_BASE');
    const designId = requiredEnv('E2E_LIVE_DESIGN_ID');
    const paidOperations = await installPaidOperationGuard(context);
    const assertNoBrowserFailures = collectBrowserFailures(page);
    const { image } = await openSavedDesign(page, designId);
    expect(Boolean(image.src), 'the selected image must have a source').toBe(true);
    expect(Boolean(image.maskSrc), 'the disposable fixture image must start without a mask').toBe(false);
    await selectImageLayer(page, image.id);

    const generationResponsePromise = page.waitForResponse((response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname.replace(/^\/api(?=\/)/, '') === '/media/remove-background'
    );
    await expect(page.getByRole('button', { name: 'AI: Remove background', exact: true })).toBeVisible();
    await openMenuAction(page, 'Tools', 'Remove Background');
    const generationResponse = await generationResponsePromise;
    expect(generationResponse.ok(), 'background removal must succeed').toBe(true);
    const generationPayload = await generationResponse.json() as { url?: unknown };
    expect(typeof generationPayload.url, 'background removal must return an artifact').toBe('string');
    const resultUrl = generationPayload.url as string;

    const review = page.getByRole('dialog', { name: 'Review background removal', exact: true });
    await expect(review).toBeVisible({ timeout: 90_000 });
    const after = review.getByRole('img', { name: 'After', exact: true });
    await expect(after).toBeVisible();
    await expect.poll(() => after.evaluate((imageElement: HTMLImageElement) => imageElement.naturalWidth)).toBeGreaterThan(0);
    const saveResponsePromise = watchDesignSave(page, designId);
    await review.getByRole('button', { name: 'Apply result', exact: true }).click();
    await expect(review).toBeHidden();

    const savePayload = await saveDesign(page, designId, saveResponsePromise);
    const savedImage = persistedImage(savePayload, image.id);
    expect(
      backgroundResultApplied(savedImage, resultUrl, image.src!),
      'the explicit save must contain the reviewed background-removal result'
    ).toBe(true);

    const reopened = await openSavedDesign(page, designId);
    const reopenedImage = persistedImage(reopened.payload, image.id);
    expect(
      backgroundResultApplied(reopenedImage, resultUrl, image.src!),
      'the background-removal result must survive save and reopen'
    ).toBe(true);
    await selectImageLayer(page, image.id);
    await expect(page.getByRole('button', { name: 'AI: Remove background', exact: true })).toBeVisible();

    await exportCurrentOutput(page);
    expect(paidOperations.blocked(), 'the paid-operation guard must not block the authorized case').toEqual([]);
    expect(paidOperations.attempts(), 'exactly one background-removal generation is authorized').toEqual([
      '/media/remove-background',
    ]);
    assertNoBrowserFailures();
  });

  test('Magic Grab preserves original-RGB subject pixels and independent layers [scaffold]', () => {
    test.skip(liveCase !== 'magic-grab', 'Select with E2E_LIVE_CASE=magic-grab');
    test.skip(true, 'Not implemented: compare original-RGB subject pixels and independently movable layers');
  });

  test('outpaint preserves the original frame without an orphan artifact [scaffold]', () => {
    test.skip(liveCase !== 'outpaint', 'Select with E2E_LIVE_CASE=outpaint');
    test.skip(true, 'Not implemented: assert original-frame pixels and absence of an orphan generated layer/artifact');
  });

  test('Bulk Create produces five editable rows and five valid PNGs', async ({ page }) => {
    test.skip(liveCase !== 'bulk-create', 'Select with E2E_LIVE_CASE=bulk-create');
    await runBulkCreateValid(page);
  });

  test('Bulk Create rejects an invalid row without a partial batch or side effects', async ({ page }) => {
    test.skip(liveCase !== 'bulk-create-invalid', 'Select with E2E_LIVE_CASE=bulk-create-invalid');
    await runBulkCreateInvalidAtomic(page);
  });

  test('QR colors persist through save and the exported PNG decodes', async ({ page }) => {
    test.skip(liveCase !== 'qr-code', 'Select with E2E_LIVE_CASE=qr-code');
    await runQrCodeAcceptance(page);
  });

  test('sharing links to the exact designId', async ({ page }) => {
    test.skip(liveCase !== 'sharing', 'Select with E2E_LIVE_CASE=sharing');
    await runExactDesignSharing(page);
  });

  test('preflight findings navigate to their output, page, and element', async ({ page }) => {
    test.skip(liveCase !== 'preflight', 'Select with E2E_LIVE_CASE=preflight');
    await runPreflightNavigation(page);
  });
});
