import { expect, type Page } from '@playwright/test';
import {
  collectBrowserFailures,
  expectSelectedLayer,
  locateElements,
  openDesign,
  openMenuAction,
  requiredEnv,
} from './helpers';

export async function runExactDesignSharing(page: Page): Promise<void> {
  const base = requiredEnv('E2E_BASE');
  const designId = requiredEnv('E2E_LIVE_DESIGN_ID');
  const assertNoBrowserFailures = collectBrowserFailures(page);
  await openDesign(page, designId);
  await page.getByTitle(/^(?:Enable real-time collaboration|\d+ connected)$/).click();
  const dialog = page.getByRole('dialog', { name: 'Share design', exact: true });
  await expect(dialog).toBeVisible();
  const expected = new URL('/media/designer', new URL(base).origin);
  expected.searchParams.set('designId', designId);
  await expect(dialog.getByLabel('Design link', { exact: true })).toHaveValue(expected.toString());
  const shared = new URL(await dialog.getByLabel('Design link', { exact: true }).inputValue());
  expect(shared.searchParams.get('designId')).toBe(designId);
  expect([...shared.searchParams.keys()]).toEqual(['designId']);
  assertNoBrowserFailures();
}

export async function runPreflightNavigation(page: Page): Promise<void> {
  requiredEnv('E2E_BASE');
  const designId = requiredEnv('E2E_LIVE_DESIGN_ID');
  const elementId = requiredEnv('E2E_LIVE_ELEMENT_ID');
  const assertNoBrowserFailures = collectBrowserFailures(page);
  const payload = await openDesign(page, designId);
  const target = locateElements(payload).find(({ element }) => element.id === elementId && element.type === 'text');
  expect(target, 'E2E_LIVE_ELEMENT_ID must identify a text element in the preflight fixture').toBeTruthy();
  expect(target!.outputIndex, 'the fixture target must be on a non-initial output').toBeGreaterThan(0);
  expect(target!.pageNumber, 'the fixture target must be on a non-initial page').toBeGreaterThan(0);

  await openMenuAction(page, 'File', 'Export…');
  await expect(page.getByText('Export Design', { exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: /^Export all \d+ outputs$/ }).check();
  const preflight = page.getByLabel('Preflight', { exact: true });
  await expect(preflight).toBeVisible();
  const finding = preflight.getByRole('button')
    .filter({ hasText: 'Low contrast' })
    .filter({ hasText: target!.outputName })
    .filter({ hasText: target!.pageName });
  await expect(finding).toHaveCount(1);
  await finding.click();
  await expect(page.getByText('Export Design', { exact: true })).toBeHidden();

  const output = page.getByRole('button').filter({ hasText: target!.outputName }).first();
  await expect(output).toHaveClass(/bg-designerAccent/);
  await expect(page.getByRole('button', { name: target!.pageName, exact: true })).toHaveAttribute('aria-current', 'true');
  await expectSelectedLayer(page, elementId);
  assertNoBrowserFailures();
}
