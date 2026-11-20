import { test, expect, type Page, type Route } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { strToU8, unzipSync, zipSync } from 'fflate';

const SOURCE_ID = 'qr-source-pdesign-e2e';
const IMPORTED_ID = 'imported-pdesign-e2e';
const JOB_ID = 'qr-export-job-pdesign-e2e';
const ARTIFACT_PATH = '/mock-storage/qr-source.pdesign';

const qrDoc = {
  version: 13,
  mode: 'image',
  outputs: [{
    id: 'qr-output',
    width: 400,
    height: 400,
    background: '#ffffff',
    children: [{
      id: 'qr-element',
      type: 'image',
      src: '/mock-storage/qr.png',
      x: 50,
      y: 50,
      width: 300,
      height: 300,
      rotation: 0,
      opacity: 1,
      locked: false,
      hidden: false,
      qr: {
        value: 'https://example.test/qr',
        foreground: '#123456',
        background: '#abcdef',
        errorCorrection: 'M',
        margin: 4,
      },
    }],
  }],
};

const ARTIFACT_BYTES = Buffer.from(zipSync({
  'manifest.json': strToU8(JSON.stringify({
    type: 'postmill-design', formatVersion: 2, docVersion: qrDoc.version,
    mode: 'image', app: 'postmill', exportedAt: '2026-01-01T00:00:00.000Z', name: 'QR source',
  })),
  'doc.json': strToU8(JSON.stringify(qrDoc)),
  'previews/output-1-page-1.jpg': new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
}));

const importedDoc = structuredClone(qrDoc);
importedDoc.outputs[0].id = 'imported-output';
importedDoc.outputs[0].children[0].id = 'imported-qr-element';

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function installMocks(page: Page) {
  const state = { importedReads: 0, exportReads: 0, importPosts: 0 };
  await page.route('**/*', async (route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const pathname = url.pathname.startsWith('/api/') ? url.pathname.slice(4) : url.pathname;

    if (url.hostname.endsWith('.ingest.us.sentry.io')) return json(route, {});
    if (url.hostname === 'www.gravatar.com') return route.fulfill({ status: 204 });
    if (method === 'GET' && pathname === ARTIFACT_PATH) {
      return route.fulfill({ status: 200, contentType: 'application/zip', body: ARTIFACT_BYTES });
    }
    if (method === 'GET' && pathname === '/mock-storage/qr.png') {
      return route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL9WQAAAABJRU5ErkJggg==', 'base64'),
      });
    }
    if (method === 'GET' && pathname === '/user/self') {
      return json(route, {
        id: 'e2e-user', email: 'qa@example.test', orgId: 'e2e-org', role: 'owner',
        isSuperAdmin: true, activated: true, setupCompleted: true, profile: {},
      });
    }
    if (method === 'GET' && pathname === '/settings/roles/me') {
      return json(route, { role: 'owner', permissions: [], isSuperAdmin: true });
    }
    if (method === 'GET' && pathname === '/user/organizations') {
      return json(route, [{ id: 'e2e-org', name: 'E2E Org', users: [{ disabled: false }] }]);
    }
    if (method === 'GET' && ['/announcements', '/notifications', '/integrations/list', '/brands', '/media/fonts'].includes(pathname)) {
      return json(route, []);
    }
    if (method === 'GET' && ['/settings/media/config', '/settings/ai/config', '/settings/storage', '/files/limits'].includes(pathname)) {
      return json(route, {});
    }
    if (method === 'GET' && pathname === '/media/tools/status') {
      return json(route, { operations: {}, tools: {} });
    }
    if (method === 'GET' && pathname === `/media/designs/${SOURCE_ID}`) {
      return json(route, { id: SOURCE_ID, name: 'QR source', doc: qrDoc });
    }
    if (method === 'GET' && pathname === `/media/designs/${SOURCE_ID}/versions`) {
      return json(route, []);
    }
    if (method === 'POST' && pathname === `/media/designs/${SOURCE_ID}/export`) {
      return json(route, { id: JOB_ID, status: 'pending' }, 201);
    }
    if (method === 'GET' && pathname === `/media/designs/export/${JOB_ID}`) {
      state.exportReads++;
      return json(route, {
        id: JOB_ID,
        status: 'completed',
        progress: 100,
        artifactUrl: `https://app.postmill.ai${ARTIFACT_PATH}`,
      });
    }
    if (method === 'POST' && pathname === '/media/designs/import') {
      state.importPosts++;
      return json(route, { id: IMPORTED_ID, name: 'Imported QR copy', doc: importedDoc }, 201);
    }
    if (method === 'GET' && pathname === `/media/designs/${IMPORTED_ID}`) {
      state.importedReads++;
      return json(route, { id: IMPORTED_ID, name: 'Imported QR copy', doc: importedDoc });
    }

    const frontendOrigin = process.env.E2E_FRONTEND_ORIGIN;
    if (frontendOrigin && url.origin === 'https://app.postmill.ai' && !pathname.startsWith('/api/')) {
      const frontend = new URL(frontendOrigin);
      if (frontend.protocol !== 'http:' || !['localhost', '127.0.0.1', '::1'].includes(frontend.hostname)) {
        throw new Error('E2E_FRONTEND_ORIGIN must be a loopback HTTP origin');
      }
      const headers = { ...request.headers() };
      delete headers.host;
      delete headers['content-length'];
      const response = await fetch(`${frontendOrigin}${pathname}${url.search}`, {
        method,
        headers,
        body: request.postDataBuffer() ?? undefined,
      });
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(key)) {
          responseHeaders[key] = value;
        }
      });
      return route.fulfill({
        status: response.status,
        headers: responseHeaders,
        body: Buffer.from(await response.arrayBuffer()),
      });
    }

    if (url.origin === 'https://api.postmill.ai') {
      return method === 'GET' ? json(route, {}) : json(route, { message: 'Unexpected API mutation blocked' }, 503);
    }
    return route.continue();
  });
  return state;
}

test('pdesign export downloads and import opens the returned editable QR design', async ({ page }) => {
  const state = await installMocks(page);
  await page.goto(`/media/designer?designId=${SOURCE_ID}`);
  await expect(page.getByRole('textbox', { name: 'Design name' })).toHaveValue('QR source');

  await page.getByRole('menuitem', { name: 'File', exact: true }).click();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Export .pdesign…', exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('QR source.pdesign');
  expect(await download.failure()).toBeNull();
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  const entries = unzipSync(await readFile(downloadPath!));
  expect(entries['previews/output-1-page-1.jpg']).toEqual(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
  await expect(page.getByText('Design file download started')).toBeVisible();
  expect(state.exportReads).toBe(1);

  await page.locator('input[type="file"][accept*=".pdesign"]').setInputFiles({
    name: 'catalog.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(qrDoc)),
  });
  await expect(page.getByRole('textbox', { name: 'Design name' })).toHaveValue('Imported QR copy');
  await expect(page.getByText('Design imported', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/media/designer\\?designId=${IMPORTED_ID}$`));
  expect(state.importPosts).toBe(1);
  expect(state.importedReads).toBeLessThanOrEqual(1);
});
